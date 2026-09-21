import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const owner = randomUUID(), editor = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
const quizId = randomUUID();
const question = () => ({ id: randomUUID(), question_text: 'Quanto fa 2 + 2?', preview_seconds: 0, answer_seconds: 10, correct_points: 100, wrong_points: -10,
  answers: [{ id: randomUUID(), answer_text: '4', is_correct: true }, { id: randomUUID(), answer_text: '5', is_correct: false }] });

test('PostgreSQL migrations: atomic editor save, RLS, conflicts, live-game protection and historical IDs', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  try {
    await db.exec(`create schema auth;
      create role anon; create role authenticated; create role service_role bypassrls;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
    `);
    const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
    await db.exec(schema);
    await db.exec('grant all on all tables in schema public to anon, authenticated, service_role');
    const engineSQL = await readFile(new URL('../database/game-engine.sql', import.meta.url), 'utf8');
    const editorSQL = await readFile(new URL('../database/editor.sql', import.meta.url), 'utf8');
    await db.exec(engineSQL); await db.exec(editorSQL);
    await db.exec(engineSQL); await db.exec(editorSQL); // Migration re-application.
    for (const id of [owner, editor, viewer, outsider]) await db.query('insert into auth.users(id) values($1)', [id]);
    // Match the real browser INSERT ... RETURNING under the authenticated role.
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    const result = await db.query('insert into quizzes(id, title, owner_id) values($1, $2, $3) returning updated_at::text', [quizId, 'Prima versione', owner]);
    let version = result.rows[0].updated_at;
    await assert.rejects(db.query('insert into quizzes(title, owner_id) values($1,$2) returning id', ['Impersonation', outsider]), /row-level security/);
    await db.exec('reset role');
    await db.query("insert into quiz_collaborators(quiz_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')", [quizId, editor, viewer]);
    const login = async (user = owner, role = 'authenticated') => {
      await db.exec(`reset role; set role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    };
    const save = async (questions, timestamp = version) => {
      const saved = await db.query('select save_quiz($1, $2::timestamptz, $3, $4, $5::jsonb)::text as version', [quizId, timestamp, 'Quiz aggiornato', 'Descrizione', JSON.stringify(questions)]);
      return saved.rows[0].version;
    };
    const first = question(), second = question();
    await login();
    version = await save([first, second]);
    assert.equal((await db.query('select count(*)::int as n from questions where not retired')).rows[0].n, 2);
    const invalid = structuredClone(first); invalid.answers[0].is_correct = false;
    await assert.rejects(save([invalid]), /almeno una risposta corretta/);
    assert.equal((await db.query('select count(*)::int as n from questions where not retired')).rows[0].n, 2, 'failed save rolls back retirement');
    await assert.rejects(save([first], '2000-01-01T00:00:00Z'), /altra sessione/);
    await login(viewer);
    assert.equal((await db.query('select * from questions')).rows.length, 2);
    await assert.rejects(save([first]), /permesso/);
    await assert.rejects(db.query('update quizzes set owner_id=$1 where id=$2', [viewer, quizId]), /permission denied/);
    await login(outsider);
    assert.equal((await db.query('select * from quizzes')).rows.length, 0);
    assert.equal((await db.query('select * from questions')).rows.length, 0);
    assert.equal((await db.query('select * from answers')).rows.length, 0);
    await assert.rejects(save([first]), /permesso/);
    await assert.rejects(db.query("insert into quiz_collaborators(quiz_id,user_id,role) values($1,$2,'editor')", [quizId, outsider]), /row-level security/);
    await login('', 'anon');
    assert.equal((await db.query('select * from answers')).rows.length, 0);
    await assert.rejects(save([first]), /permission denied/);
    await login(editor);
    version = await save([second, first]);
    assert.equal((await db.query('select id from questions where not retired order by question_order')).rows[0].id, second.id);
    await assert.rejects(db.query('delete from questions where id=$1', [first.id]), /permission denied/);
    await login(owner, 'service_role');
    const gameId = randomUUID(), playerId = randomUUID(), answerId = randomUUID();
    await db.query("insert into games(id, quiz_id,game_code,created_by) values($1,$2,'123456',$3)", [gameId, quizId, owner]);
    await login(owner);
    await assert.rejects(save([first]), /Concludi le partite/);
    await assert.rejects(db.query('select archive_game($1)', ['{}']), /permission denied/);
    await login(owner, 'service_role');
    const archive = { id: gameId, status: 'finished', started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
      players: [{ id: playerId, nickname: 'Anna', score: 100, joined_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }],
      answers: [{ id: answerId, question_id: first.id, player_id: playerId, answer_id: first.answers[0].id, is_correct: true, points_awarded: 100, response_time: 200, created_at: new Date().toISOString() }] };
    await db.query('select archive_game($1)', [JSON.stringify(archive)]);
    await db.query('select archive_game($1)', [JSON.stringify(archive)]);
    await login(owner);
    version = await save([second]);
    assert.equal((await db.query('select retired from questions where id=$1', [first.id])).rows[0].retired, true);
    assert.equal((await db.query('select * from player_answers')).rows.length, 1, 'removing questions keeps history; repeated archive does not duplicate answers');
    await login(outsider);
    assert.equal((await db.query('select * from player_answers')).rows.length, 0);
    assert.equal((await db.query('select * from game_players')).rows.length, 0);
  } finally { await db.close(); }
});
