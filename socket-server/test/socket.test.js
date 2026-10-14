/**
 * Prove con client Socket.IO reali su porta locale temporanea e repository
 * simulato. Verificano ruoli, isolamento delle room, ripristino della sessione,
 * espulsione, archivio e avanzamento automatico dei timer.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { once } = require('node:events');
const { createGameServer } = require('../lib/server');
const { MemoryStore } = require('../lib/store');
const { repository } = require('./helpers');

const emit = (socket, event, payload = {}) => socket.timeout(3000).emitWithAck(event, payload);

test('Client Socket.IO reali: ruoli, isolamento, invii, sostituzione sessione e archivio', async t => {
  const repo = repository();
  const server = await createGameServer({ store: new MemoryStore(), repository: repo, tickMs: 10000 });
  t.after(() => server.close());
  const address = await server.listen(0, '127.0.0.1');
  const connect = async (token) => {
    const socket = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { accessToken: token } });
    t.after(() => socket.disconnect());
    await once(socket, 'connect');
    return socket;
  };
  const admin = await connect('valid-token');
  const intruder = await connect();
  const rejected = await emit(intruder, 'admin:create_game', { quizId: repo.data.id });
  assert.equal(rejected.error.code, 'UNAUTHORIZED');
  const created = await emit(admin, 'admin:create_game', { quizId: repo.data.id });
  assert.equal(created.ok, true);
  const { gameCode, gameId } = created.data.state;
  assert.ok(server.io.sockets.adapter.rooms.has(gameId));
  assert.ok(!server.io.sockets.adapter.rooms.has(gameCode));
  assert.equal((await emit(intruder, 'admin:join', { gameCode })).error.code, 'UNAUTHORIZED');
  const player = await connect();
  const joined = await emit(player, 'player:join', { gameCode, nickname: 'Anna' });
  assert.equal(joined.ok, true);
  const { playerId, sessionToken } = joined.data;
  assert.equal((await emit(player, 'admin:start_game', { revision: 2 })).error.code, 'FORBIDDEN');
  const screen = await connect();
  assert.equal((await emit(screen, 'presentation:join', { gameId })).ok, true);
  assert.equal((await emit(screen, 'player:answer', {})).error.code, 'FORBIDDEN');
  const otherAdmin = await connect('valid-token');
  const other = await emit(otherAdmin, 'admin:create_game', { quizId: repo.data.id });
  const outsider = await connect();
  await emit(outsider, 'presentation:join', { gameCode: other.data.state.gameCode });
  const wrongRoomEvents = [];
  outsider.on('game:state_update', state => { if (state.gameId === gameId) wrongRoomEvents.push(state); });
  const next = async event => {
    const sync = await emit(admin, 'game:sync');
    const response = await emit(admin, event, { revision: sync.data.state.revision });
    assert.equal(response.ok, true, JSON.stringify(response));
    return response;
  };
  await next('admin:start_game');
  await next('admin:next_state');
  const q = repo.data.questions[0];
  const answer = await emit(player, 'player:answer', { questionId: q.id, answerId: q.answers[0].id, nickname: 'Spoofed', timeTaken: -1, gameCode: other.data.state.gameCode });
  assert.deepEqual(answer, { ok: true, data: { answerId: q.answers[0].id } });
  assert.equal((await emit(player, 'player:answer', { questionId: q.id, answerId: q.answers[1].id })).error.code, 'ALREADY_ANSWERED');
  const newPlayer = await connect();
  const disconnected = once(player, 'disconnect');
  const resumed = await emit(newPlayer, 'player:reconnect', { gameCode, playerId, sessionToken });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.data.answerId, q.answers[0].id);
  assert.equal((await emit(newPlayer, 'game:sync')).data.answerId, q.answers[0].id);
  await disconnected;
  const reveal = await next('admin:show_leaderboard');
  assert.ok(reveal.data.state.leaderboard[0].score >= 1 && reveal.data.state.leaderboard[0].score <= 100);
  const revision = (await emit(admin, 'game:sync')).data.state.revision;
  const kicked = once(newPlayer, 'player:kicked');
  assert.equal((await emit(admin, 'admin:kick_player', { revision, playerId })).ok, true);
  await kicked;
  const blocked = await connect();
  assert.equal((await emit(blocked, 'player:reconnect', { gameCode, playerId, sessionToken })).error.code, 'INVALID_SESSION');
  const ended = once(screen, 'game:ended');
  await next('admin:end_game');
  assert.equal((await ended)[0].status, 'ENDED');
  assert.equal(repo.archived.length, 1);
  assert.equal(wrongRoomEvents.length, 0);
  assert.equal((await emit(intruder, 'player:join', null)).error.code, 'INVALID_PAYLOAD');
});

test('I timer pubblicano le scadenze e chiudono gli invii senza comandi del conduttore', async t => {
  let time = 100000;
  const repo = repository();
  repo.data.questions[0].preview_seconds = 1;
  repo.data.questions[0].answer_seconds = 1;
  const server = await createGameServer({ store: new MemoryStore(), repository: repo, now: () => time, tickMs: 10 });
  t.after(() => server.close());
  const address = await server.listen(0, '127.0.0.1');
  const admin = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, auth: { accessToken: 'valid-token' } });
  t.after(() => admin.disconnect());
  await once(admin, 'connect');
  const created = await emit(admin, 'admin:create_game', { quizId: repo.data.id });
  const tick = once(admin, 'game:timer_update');
  const started = await emit(admin, 'admin:start_game', { revision: created.data.state.revision });
  assert.equal(started.data.state.status, 'QUESTION_PREVIEW');
  assert.equal((await tick)[0].deadline, 101000);
  let changed = once(admin, 'game:state_update');
  time = 101000;
  assert.equal((await changed)[0].status, 'QUESTION_ACTIVE');
  changed = once(admin, 'game:state_update');
  time = 102000;
  assert.equal((await changed)[0].status, 'QUESTION_LOCKED');
});

test('Scelta classifica sincronizzata nelle tre viste, autorizzazione e doppio comando', async t => {
  let time = 100000;
  const repo = repository();
  const server = await createGameServer({ store: new MemoryStore(), repository: repo, now: () => time, tickMs: 10000 });
  t.after(() => server.close());
  const address = await server.listen(0, '127.0.0.1');
  const connect = async token => {
    const socket = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, auth: { accessToken: token } });
    t.after(() => socket.disconnect()); await once(socket, 'connect'); return socket;
  };
  const admin = await connect('valid-token'), player = await connect(), screen = await connect();
  const { data: { state: created } } = await emit(admin, 'admin:create_game', { quizId: repo.data.id });
  await emit(screen, 'presentation:join', { gameId: created.gameId });
  await emit(player, 'player:join', { gameCode: created.gameCode, nickname: 'Anna' });
  const command = async event => {
    const { data: { state } } = await emit(admin, 'game:sync');
    const result = await emit(admin, event, { revision: state.revision });
    assert.equal(result.ok, true, JSON.stringify(result)); return result.data.state;
  };
  const observed = [];
  screen.on('game:state_update', s => observed.push(s.status));
  await command('admin:start_game');
  for (let i = 0; i < 2; i++) {
    await command('admin:next_state');
    time += 2500;
    const q = repo.data.questions[i];
    assert.equal((await emit(player, 'player:answer', { questionId: q.id, answerId: q.answers[0].id, points: 999999, receivedAt: 0 })).ok, true);
    for (const socket of [admin, player, screen]) {
      const { data: { state } } = await emit(socket, 'game:sync');
      assert.equal(state.status, 'QUESTION_LOCKED'); assert.equal(state.leaderboard, undefined);
    }
    for (const event of ['admin:show_leaderboard', 'admin:next_question']) {
      assert.equal((await emit(player, event, { revision: 0 })).error.code, 'FORBIDDEN');
      assert.equal((await emit(screen, event, { revision: 0 })).error.code, 'FORBIDDEN');
    }
    if (i === 1) {
      await command('admin:show_leaderboard');
      for (const socket of [admin, player, screen]) {
        const { data: { state } } = await emit(socket, 'game:sync');
        assert.equal(state.status, 'LEADERBOARD'); assert.equal(state.leaderboard[0].score, 100);
      }
    }
    const revision = (await emit(admin, 'game:sync')).data.state.revision;
    const outcomes = await Promise.all([
      emit(admin, 'admin:next_question', { revision }), emit(admin, 'admin:next_question', { revision }),
    ]);
    assert.equal(outcomes[0].ok, true); assert.equal(outcomes[1].error.code, 'STALE_STATE');
    for (const socket of [admin, player, screen]) {
      assert.equal((await emit(socket, 'game:sync')).data.state.status, i ? 'FINAL_RESULTS' : 'QUESTION_PREVIEW');
    }
    if (!i) assert.ok(!observed.includes('LEADERBOARD'));
  }
  await command('admin:next_state');
  assert.equal(repo.archived[0].players[0].score, 100);
  assert.deepEqual(repo.archived[0].submissions.map(a => a.points_awarded), [50, 50]);
});
