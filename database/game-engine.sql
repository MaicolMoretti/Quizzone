-- Applicare DOPO schema.sql tramite SQL Editor Supabase o utenza amministrativa.
-- Solo il server Node scrive lo storico tramite la chiave service_role riservata.
begin;

alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.player_answers enable row level security;

-- Il conduttore legge lo storico; i giocatori comunicano via Socket.IO, senza accesso SQL.
drop policy if exists "Conductor reads games" on public.games;
create policy "Conductor reads games" on public.games for select to authenticated
  using (created_by = auth.uid());
drop policy if exists "Conductor reads players" on public.game_players;
create policy "Conductor reads players" on public.game_players for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.created_by = auth.uid()));
drop policy if exists "Conductor reads answers" on public.player_answers;
create policy "Conductor reads answers" on public.player_answers for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.created_by = auth.uid()));

-- RPC riservata al motore: salva l’esito finale senza duplicare invii nei tentativi ripetuti.
-- SECURITY INVOKER conserva i privilegi del chiamante; EXECUTE è concesso solo a service_role.
create or replace function public.archive_game(p_game jsonb)
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
  -- Serializza i tentativi con un blocco sulla partita e salva giocatori, invii e stato insieme.
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
  -- Lo stesso invio, identificato dal suo UUID, non deve essere archiviato due volte.
  on conflict (id) do nothing;

  update public.games set status = p_game->>'status',
    started_at = (p_game->>'started_at')::timestamptz,
    ended_at = (p_game->>'ended_at')::timestamptz
  where id = v_game_id;
end;
$$;
revoke all on function public.archive_game(jsonb) from public, anon, authenticated;
grant execute on function public.archive_game(jsonb) to service_role;
commit;
