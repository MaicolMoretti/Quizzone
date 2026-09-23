/**
 * Prove del confine Supabase con fetch simulato: validazione del JWT,
 * controllo del ruolo editor prima di leggere soluzioni e invio dello storico
 * tramite una sola RPC, priva delle credenziali delle sessioni giocatore.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SupabaseRepository } = require('../lib/repository');
const { quiz, fixture } = require('./helpers');

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Supabase valida il JWT con Auth e distingue credenziali rifiutate da indisponibilità', async t => {
  const repo = new SupabaseRepository('https://example.supabase.co/', 'server-secret');
  const calls = [];
  const fetchMock = t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url, options }); return response({ id: 'user-id' });
  });
  assert.equal(await repo.authenticate('user-token'), 'user-id');
  assert.equal(calls[0].url, 'https://example.supabase.co/auth/v1/user');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer user-token');
  assert.equal(calls[0].options.headers.apikey, 'server-secret');
  fetchMock.mock.mockImplementation(async () => response({}, 401));
  await assert.rejects(repo.authenticate('bad'), e => e.code === 'UNAUTHORIZED');
  fetchMock.mock.mockImplementation(async () => response({}, 503));
  await assert.rejects(repo.authenticate('token'), e => e.status === 503 && !e.code);
});

test('Il caricamento verifica il permesso editor prima di leggere le soluzioni', async t => {
  const repo = new SupabaseRepository('https://example.supabase.co', 'secret');
  const data = quiz();
  let editor = false;
  const calls = [];
  t.mock.method(global, 'fetch', async url => {
    calls.push(url);
    if (url.includes('/quizzes?')) return response([{ id: data.id, owner_id: 'owner', title: data.title }]);
    if (url.includes('/quiz_collaborators?')) return response(editor ? [{ id: 'membership' }] : []);
    if (url.includes('/questions?')) return response(data.questions);
    throw new Error('Unexpected URL');
  });
  await assert.rejects(repo.loadQuiz('other', data.id), e => e.code === 'FORBIDDEN');
  assert.equal(calls.filter(url => url.includes('/questions?')).length, 0);
  editor = true;
  const loaded = await repo.loadQuiz('other', data.id);
  assert.equal(loaded.questions.length, 2);
  assert.ok(calls.some(url => url.includes('role=eq.editor')));
});

test('Archivio con una RPC per punti e risposte, senza credenziali delle sessioni', async t => {
  const f = await fixture();
  const session = await f.engine.join(f.code, 'Anna', 'socket');
  await f.command('end');
  const repo = new SupabaseRepository('https://example.supabase.co', 'secret');
  let sent;
  t.mock.method(global, 'fetch', async (url, options) => { sent = { url, options }; return new Response(null, { status: 204 }); });
  await repo.archive(f.engine.get(f.code));
  assert.equal(sent.url, 'https://example.supabase.co/rest/v1/rpc/archive_game');
  const body = JSON.parse(sent.options.body).p_game;
  assert.equal(body.players[0].id, session.playerId);
  assert.equal(body.status, 'finished');
  assert.equal(body.started_at, null);
  assert.ok(!sent.options.body.includes('tokenHash'));
  assert.ok(!sent.options.body.includes(session.sessionToken));
  assert.ok(!sent.options.body.includes('socketId'));
});
