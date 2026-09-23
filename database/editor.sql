-- Applicare dopo schema.sql e game-engine.sql. La migrazione è riapplicabile.
begin;
alter table public.questions add column if not exists retired boolean not null default false;
alter table public.answers add column if not exists retired boolean not null default false;

-- Le funzioni SECURITY DEFINER evitano ricorsione RLS tra quiz e collaboratori.
-- Il search_path vuoto e gli schemi espliciti evitano risoluzioni ambigue degli oggetti.
create or replace function public.quiz_access(p_id uuid, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.quizzes q where q.id = p_id and
    (q.owner_id = auth.uid() or exists(select 1 from public.quiz_collaborators c
      where c.quiz_id = q.id and c.user_id = auth.uid() and (not p_edit or c.role = 'editor'))));
$$;
create or replace function public.quiz_owner(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.quizzes where id = p_id and owner_id = auth.uid());
$$;
revoke all on function public.quiz_access(uuid, boolean), public.quiz_owner(uuid) from public;
grant execute on function public.quiz_access(uuid, boolean), public.quiz_owner(uuid) to authenticated;

alter table public.quiz_collaborators enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
drop policy if exists "Users can view their own quizzes or collaborated quizzes" on public.quizzes;
create policy "Users can view their own quizzes or collaborated quizzes" on public.quizzes
  for select to authenticated using (owner_id = (select auth.uid()) or public.quiz_access(id));
drop policy if exists "Users can update their own quizzes or if editor" on public.quizzes;
create policy "Users can update their own quizzes or if editor" on public.quizzes
  for update to authenticated using (public.quiz_access(id, true)) with check (public.quiz_access(id, true));
drop policy if exists "Collaborator visibility" on public.quiz_collaborators;
create policy "Collaborator visibility" on public.quiz_collaborators for select to authenticated
  using (user_id = auth.uid() or public.quiz_owner(quiz_id));
drop policy if exists "Owner manages collaborators" on public.quiz_collaborators;
create policy "Owner manages collaborators" on public.quiz_collaborators for all to authenticated
  using (public.quiz_owner(quiz_id)) with check (public.quiz_owner(quiz_id));
drop policy if exists "Quiz readers see questions" on public.questions;
create policy "Quiz readers see questions" on public.questions for select to authenticated
  using (public.quiz_access(quiz_id));
drop policy if exists "Quiz readers see answers" on public.answers;
create policy "Quiz readers see answers" on public.answers for select to authenticated
  using (exists(select 1 from public.questions q where q.id = question_id and public.quiz_access(q.quiz_id)));

-- Le modifiche dell’editor passano da un’unica RPC atomica.
-- Si revocano scritture dirette e riassegnazione del proprietario dal browser.
revoke insert, update, delete on public.questions, public.answers from anon, authenticated;
revoke update, delete on public.quizzes from anon, authenticated;
revoke all on public.quiz_collaborators from anon;

-- Salva l’intero quiz in una transazione: verifica identità, versione e partite aperte.
-- Qualunque eccezione annulla anche le rimozioni logiche e gli upsert già eseguiti.
-- Restituisce updated_at, da inviare come versione attesa al salvataggio successivo.
create or replace function public.save_quiz(p_quiz_id uuid, p_expected_updated_at timestamptz, p_title text, p_description text, p_questions jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_updated timestamptz;
  v_now timestamptz := clock_timestamp();
  q jsonb; a jsonb; qid uuid; aid uuid; qi integer := 0; ai integer;
  seen_q uuid[] := '{}'; seen_a uuid[] := '{}';
begin
  if auth.uid() is null or not public.quiz_access(p_quiz_id, true) then
    raise exception 'Non hai il permesso di modificare questo quiz.' using errcode = '42501';
  end if;
  -- Il blocco FOR UPDATE coordina editor concorrenti e inserimenti di nuove partite.
  select updated_at into v_updated from public.quizzes where id = p_quiz_id for update;
  if p_expected_updated_at is distinct from v_updated then
    raise exception 'Il quiz è stato modificato in un’altra sessione. Ricarica prima di salvare.';
  end if;
  if exists(select 1 from public.games where quiz_id = p_quiz_id and status in ('waiting', 'active')) then
    raise exception 'Concludi le partite aperte prima di modificare il quiz.';
  end if;
  if p_title is null or length(trim(p_title)) not between 1 and 200
    or jsonb_typeof(p_questions) is distinct from 'array'
    or jsonb_array_length(p_questions) not between 1 and 200 then
    raise exception 'Inserisci un titolo e da 1 a 200 domande.';
  end if;
  -- La rimozione logica conserva i riferimenti dello storico: gli elementi inviati
  -- vengono riattivati durante gli upsert, quelli omessi rimangono retired.
  update public.questions set retired = true where quiz_id = p_quiz_id;
  update public.answers set retired = true where question_id in (select id from public.questions where quiz_id = p_quiz_id);
  for q in select value from jsonb_array_elements(p_questions) loop
    qi := qi + 1;
    qid := (q->>'id')::uuid;
    if qid is null or qid = any(seen_q) or
      coalesce(length(trim(q->>'question_text')), 0) not between 1 and 2000 or
      coalesce((q->>'preview_seconds')::integer, -1) not between 0 and 300 or
      coalesce((q->>'answer_seconds')::integer, -1) not between 1 and 600 or
      coalesce((q->>'correct_points')::integer, -1) not between 0 and 100000 or
      coalesce((q->>'wrong_points')::integer, 1) not between -100000 and 0 or
      jsonb_typeof(q->'answers') is distinct from 'array' or
      jsonb_array_length(q->'answers') not between 2 and 8 then
      raise exception 'Domanda % non valida: controlla testo, tempi, punti e risposte.', qi;
    end if;
    -- Un UUID esistente non può essere spostato da un altro quiz tramite il payload.
    if exists(select 1 from public.questions where id = qid and quiz_id <> p_quiz_id) then
      raise exception 'Identificativo domanda non valido.';
    end if;
    seen_q := array_append(seen_q, qid);
    insert into public.questions(id, quiz_id, question_text, image_url, question_order, preview_seconds, answer_seconds, correct_points, wrong_points, retired, updated_at)
    values(qid, p_quiz_id, trim(q->>'question_text'), nullif(q->>'image_url', ''), qi,
      (q->>'preview_seconds')::integer, (q->>'answer_seconds')::integer, (q->>'correct_points')::integer, (q->>'wrong_points')::integer, false, v_now)
    on conflict(id) do update set question_text = excluded.question_text, image_url = excluded.image_url,
      question_order = excluded.question_order, preview_seconds = excluded.preview_seconds, answer_seconds = excluded.answer_seconds,
      correct_points = excluded.correct_points, wrong_points = excluded.wrong_points, retired = false, updated_at = v_now;
    if not exists(select 1 from jsonb_array_elements(q->'answers') x where x->'is_correct' = 'true'::jsonb) then
      raise exception 'Seleziona almeno una risposta corretta per la domanda %.', qi;
    end if;
    ai := 0;
    for a in select value from jsonb_array_elements(q->'answers') loop
      ai := ai + 1; aid := (a->>'id')::uuid;
      if aid is null or aid = any(seen_a) or
        coalesce(length(trim(a->>'answer_text')), 0) not between 1 and 500 or
        jsonb_typeof(a->'is_correct') is distinct from 'boolean' then
        raise exception 'Risposta % della domanda % non valida.', ai, qi;
      end if;
      -- Ogni opzione mantiene la propria domanda, anche in presenza di UUID manipolati.
      if exists(select 1 from public.answers where id = aid and question_id <> qid) then
        raise exception 'Identificativo risposta non valido.';
      end if;
      seen_a := array_append(seen_a, aid);
      insert into public.answers(id, question_id, answer_text, answer_order, is_correct, retired)
      values(aid, qid, trim(a->>'answer_text'), ai, (a->>'is_correct')::boolean, false)
      on conflict(id) do update set answer_text = excluded.answer_text, answer_order = excluded.answer_order,
        is_correct = excluded.is_correct, retired = false;
    end loop;
  end loop;
  update public.quizzes set title = trim(p_title), description = p_description, updated_at = v_now where id = p_quiz_id;
  return v_now;
end;
$$;
revoke all on function public.save_quiz(uuid, timestamptz, text, text, jsonb) from public;
grant execute on function public.save_quiz(uuid, timestamptz, text, text, jsonb) to authenticated;

-- La creazione di una partita e il salvataggio acquisiscono lo stesso blocco
-- sulla riga quiz: il controllo delle partite aperte avviene in ordine seriale.
create or replace function public.lock_game_quiz() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.quizzes where id = new.quiz_id for update;
  return new;
end;
$$;
revoke all on function public.lock_game_quiz() from public;
drop trigger if exists lock_game_quiz on public.games;
create trigger lock_game_quiz before insert on public.games for each row execute function public.lock_game_quiz();
commit;
