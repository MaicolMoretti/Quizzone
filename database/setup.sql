-- Quizzone: first installation, adapted from schema.sql, game-engine.sql, editor.sql.
-- Run the entire file in the Supabase SQL Editor. Existing application tables cause
-- an error before any changes; this script never drops tables or user data.
begin;
set local search_path = public, extensions;
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public'
    and table_name in ('quizzes','quiz_collaborators','questions','answers','games','game_players','player_answers')) then
    raise exception 'Esistono già tabelle Quizzone. Non eseguire il setup iniziale: verificare le migrazioni da applicare.';
  end if;
end;
$$;
-- SOURCE: schema.sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Quizzes Table
create table public.quizzes (
    id uuid primary key default uuid_generate_v4(),
    title text not null,
    description text,
    cover_image text,
    owner_id uuid references auth.users(id) not null,
    status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.quizzes enable row level security;

-- 2. Quiz Collaborators
create table public.quiz_collaborators (
    id uuid primary key default uuid_generate_v4(),
    quiz_id uuid references quizzes(id) on delete cascade not null,
    user_id uuid references auth.users(id) on delete cascade not null,
    role text not null check (role in ('editor', 'viewer')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(quiz_id, user_id)
);
alter table public.quiz_collaborators enable row level security;

-- 3. Questions
create table public.questions (
    id uuid primary key default uuid_generate_v4(),
    quiz_id uuid references quizzes(id) on delete cascade not null,
    question_text text not null,
    image_url text,
    question_order integer not null,
    preview_seconds integer not null default 5,
    answer_seconds integer not null default 15,
    correct_points integer not null default 100,
    wrong_points integer not null default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.questions enable row level security;

-- 4. Answers
create table public.answers (
    id uuid primary key default uuid_generate_v4(),
    question_id uuid references questions(id) on delete cascade not null,
    answer_text text not null,
    answer_order integer not null,
    is_correct boolean not null default false
);
alter table public.answers enable row level security;

-- 5. Games (Sessions)
create table public.games (
    id uuid primary key default uuid_generate_v4(),
    quiz_id uuid references quizzes(id) on delete cascade not null,
    game_code text not null unique,
    status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'expired')),
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_by uuid references auth.users(id) not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.games enable row level security;

-- 6. Game Players
create table public.game_players (
    id uuid primary key default uuid_generate_v4(),
    game_id uuid references games(id) on delete cascade not null,
    nickname text not null,
    socket_session_id text,
    score integer not null default 0,
    joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
    last_seen_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(game_id, nickname)
);
alter table public.game_players enable row level security;

-- 7. Player Answers (History)
create table public.player_answers (
    id uuid primary key default uuid_generate_v4(),
    game_id uuid references games(id) on delete cascade not null,
    question_id uuid references questions(id) on delete cascade not null,
    player_id uuid references game_players(id) on delete cascade not null,
    answer_id uuid references answers(id) on delete cascade not null,
    is_correct boolean not null,
    points_awarded integer not null,
    response_time integer not null, -- ms taken to respond
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.player_answers enable row level security;

-- RLS (Row Level Security) setup

-- Quizzes

create policy "Users can insert their own quizzes" on quizzes
    for insert with check (auth.uid() = owner_id);

create policy "Users can delete their own quizzes" on quizzes
    for delete using (auth.uid() = owner_id);

-- Every application table has RLS enabled immediately after creation.

-- SOURCE: game-engine.sql
-- Run AFTER schema.sql, using the Supabase SQL editor / migration administrator.
-- The Node server alone writes game history, with its server-only service_role key.


-- Read-only history for the conductor. Players use Socket.IO, not direct DB access.
create policy "Conductor reads games" on public.games for select to authenticated
  using (created_by = auth.uid());
create policy "Conductor reads players" on public.game_players for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.created_by = auth.uid()));
create policy "Conductor reads answers" on public.player_answers for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.created_by = auth.uid()));

create function public.archive_game(p_game jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game_id uuid := (p_game->>'id')::uuid;
begin
  if p_game->>'status' is null or p_game->>'status' not in ('finished', 'expired') then
    raise exception 'Invalid final game status';
  end if;
  -- Serialize retries and commit players, answers and final status together.
  perform 1 from public.games where id = v_game_id for update;
  if not found then raise exception 'Game not found'; end if;

  insert into public.game_players (id, game_id, nickname, score, joined_at, last_seen_at)
  select p.id, v_game_id, p.nickname, p.score, p.joined_at, p.last_seen_at
  from jsonb_to_recordset(p_game->'players') as p(
    id uuid, nickname text, score integer, joined_at timestamptz, last_seen_at timestamptz
  )
  on conflict (id) do update set score = excluded.score, last_seen_at = excluded.last_seen_at;

  insert into public.player_answers (
    id, game_id, question_id, player_id, answer_id, is_correct, points_awarded, response_time, created_at
  )
  select a.id, v_game_id, a.question_id, a.player_id, a.answer_id,
    a.is_correct, a.points_awarded, a.response_time, a.created_at
  from jsonb_to_recordset(p_game->'answers') as a(
    id uuid, question_id uuid, player_id uuid, answer_id uuid,
    is_correct boolean, points_awarded integer, response_time integer, created_at timestamptz
  )
  on conflict (id) do nothing;

  update public.games set status = p_game->>'status',
    started_at = (p_game->>'started_at')::timestamptz,
    ended_at = (p_game->>'ended_at')::timestamptz
  where id = v_game_id;
end;
$$;
revoke all on function public.archive_game(jsonb) from public, anon, authenticated;
grant execute on function public.archive_game(jsonb) to service_role;

-- SOURCE: editor.sql
-- Apply after schema.sql and game-engine.sql. Re-runnable migration.

alter table public.questions add column if not exists retired boolean not null default false;
alter table public.answers add column if not exists retired boolean not null default false;

-- Security-definer predicates avoid recursive RLS between quizzes and collaborators.
create function public.quiz_access(p_id uuid, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.quizzes q where q.id = p_id and
    (q.owner_id = auth.uid() or exists(select 1 from public.quiz_collaborators c
      where c.quiz_id = q.id and c.user_id = auth.uid() and (not p_edit or c.role = 'editor'))));
$$;
create function public.quiz_owner(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.quizzes where id = p_id and owner_id = auth.uid());
$$;
revoke all on function public.quiz_access(uuid, boolean), public.quiz_owner(uuid) from public;
grant execute on function public.quiz_access(uuid, boolean), public.quiz_owner(uuid) to authenticated;

create policy "Users can view their own quizzes or collaborated quizzes" on public.quizzes
  for select to authenticated using (public.quiz_access(id));
create policy "Users can update their own quizzes or if editor" on public.quizzes
  for update to authenticated using (public.quiz_access(id, true)) with check (public.quiz_access(id, true));
create policy "Collaborator visibility" on public.quiz_collaborators for select to authenticated
  using (user_id = auth.uid() or public.quiz_owner(quiz_id));
create policy "Owner manages collaborators" on public.quiz_collaborators for all to authenticated
  using (public.quiz_owner(quiz_id)) with check (public.quiz_owner(quiz_id));
create policy "Quiz readers see questions" on public.questions for select to authenticated
  using (public.quiz_access(quiz_id));
create policy "Quiz readers see answers" on public.answers for select to authenticated
  using (exists(select 1 from public.questions q where q.id = question_id and public.quiz_access(q.quiz_id)));

-- All editor writes go through one atomic RPC. No direct writes or owner reassignment.
revoke insert, update, delete on public.questions, public.answers from anon, authenticated;
revoke update, delete on public.quizzes from anon, authenticated;
revoke all on public.quiz_collaborators from anon;

create function public.save_quiz(p_quiz_id uuid, p_expected_updated_at timestamptz, p_title text, p_description text, p_questions jsonb)
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
  -- Soft deletion keeps every historical foreign key intact.
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

-- Serialize game creation against editor saves using the same quiz row lock.
create function public.lock_game_quiz() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.quizzes where id = new.quiz_id for update;
  return new;
end;
$$;
revoke all on function public.lock_game_quiz() from public;
create trigger lock_game_quiz before insert on public.games for each row execute function public.lock_game_quiz();

notify pgrst, 'reload schema';
commit;

-- Expected: seven rows, each with rls_enabled = true.
select c.relname as tabella, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('quizzes','quiz_collaborators','questions','answers','games','game_players','player_answers')
order by c.relname;
