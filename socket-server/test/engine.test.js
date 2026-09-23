/**
 * Prove della macchina a stati senza rete: punteggi, parità, scadenze,
 * autorizzazioni, invii duplicati, riconnessione e fallimenti della persistenza.
 * Le verifiche sugli snapshot controllano che le informazioni private non escano.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, snapshot } = require('../lib/engine');
const { fixture, quiz } = require('./helpers');
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);

test('Partita completa con due domande: punteggi, percentuali, parità e archivio', async () => {
  const f = await fixture();
  const a = await f.engine.join(f.code, 'Anna', 's1');
  const b = await f.engine.join(f.code, 'Bruno', 's2');
  await f.command('start');
  assert.equal(f.engine.get(f.code).status, 'QUESTION_PREVIEW');
  assert.equal(snapshot(f.engine.get(f.code)).question.answers, undefined);
  for (let i = 0; i < 2; i++) {
    f.advance(2000); await f.engine.tick();
    const q = f.engine.get(f.code).questions[i];
    f.advance(250);
    await f.engine.answer(f.code, a.playerId, 's1', q.id, q.answers[i].id);
    await f.engine.answer(f.code, b.playerId, 's2', q.id, q.answers[1-i].id);
    assert.equal(snapshot(f.engine.get(f.code)).question.answers[0].is_correct, undefined);
    f.advance(4750); await f.engine.tick();
    assert.equal(f.engine.get(f.code).status, 'QUESTION_LOCKED');
    const locked = snapshot(f.engine.get(f.code));
    assert.equal(locked.leaderboard, undefined);
    assert.equal(locked.players[0].score, undefined);
    await f.command();
    const revealed = snapshot(f.engine.get(f.code));
    assert.equal(revealed.question.answers[0].is_correct, true);
    assert.deepEqual(revealed.statistics.map(s => s.percentage), [50, 50]);
    await f.command();
    assert.equal(f.engine.get(f.code).status, 'LEADERBOARD');
    await f.command();
    if (!i) { assert.equal(f.engine.get(f.code).status, 'NEXT_QUESTION'); await f.engine.tick(); }
  }
  assert.equal(f.engine.get(f.code).status, 'FINAL_RESULTS');
  assert.deepEqual(snapshot(f.engine.get(f.code)).leaderboard.map(p => [p.score, p.rank]), [[80,1],[80,1]]);
  await f.command();
  assert.equal(f.engine.get(f.code).status, 'ENDED');
  assert.equal(f.repo.archived[0].submissions.length, 4);
  assert.equal(f.repo.archived[0].submissions[0].response_time, 250);
  assert.equal(f.repo.started.length, 1);
});

test('Rifiuta partite assenti, nickname non validi o duplicati e ingressi tardivi', async () => {
  const f = await fixture();
  await rejects(f.engine.join('000000', 'A', 's'), 'GAME_NOT_FOUND');
  await rejects(f.engine.join(f.code, '\n', 's'), 'INVALID_NICKNAME');
  await f.engine.join(f.code, ' Anna ', 's');
  await rejects(f.engine.join(f.code, 'ANNA', 's2'), 'NICKNAME_TAKEN');
  await f.command('start');
  await rejects(f.engine.join(f.code, 'B', 's2'), 'GAME_STARTED');
});

test('Invii duplicati e obsoleti non alterano i punti; le scadenze valgono anche senza tick', async () => {
  const f = await fixture();
  const p = await f.engine.join(f.code, 'A', 's');
  const q = f.engine.get(f.code).questions[0];
  await rejects(f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id), 'ANSWERS_CLOSED');
  await f.command('start'); await f.command();
  await rejects(f.engine.answer(f.code, p.playerId, 'other', q.id, q.answers[0].id), 'INVALID_SESSION');
  await rejects(f.engine.answer(f.code, p.playerId, 's', 'stale', q.answers[0].id), 'INVALID_QUESTION');
  await rejects(f.engine.answer(f.code, p.playerId, 's', q.id, 'invalid'), 'INVALID_ANSWER');
  const results = await Promise.allSettled([
    f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id),
    f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[1].id),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.code, 'ALREADY_ANSWERED');
  f.advance(5000);
  await rejects(f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id), 'ANSWERS_CLOSED');
  await f.engine.tick(); await f.engine.tick();
  assert.equal(f.engine.get(f.code).players[0].score, 100);
});

test('Autorizzazione e revisione impediscono impersonificazione e transizioni ripetute', async () => {
  const f = await fixture();
  await rejects(f.engine.command(f.code, 'intruder', 'start', 1), 'FORBIDDEN');
  await rejects(f.command(), 'INVALID_STATE');
  const revision = f.engine.get(f.code).revision;
  await f.command('start');
  await rejects(f.engine.command(f.code, 'owner', 'next', revision), 'STALE_STATE');
  await rejects(f.command('start'), 'INVALID_STATE');
});

test('Riconnessione: autentica, sostituisce il socket, conserva la risposta e rifiuta gli espulsi', async () => {
  const f = await fixture();
  const p = await f.engine.join(f.code, 'A', 's');
  const q = f.engine.get(f.code).questions[0];
  await f.command('start'); await f.command();
  await f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id);
  await rejects(f.engine.reconnect(f.code, p.playerId, '0'.repeat(64), 'new'), 'INVALID_SESSION');
  const reconnected = await f.engine.reconnect(f.code, p.playerId, p.sessionToken, 'new');
  assert.equal(reconnected.previousSocketId, 's');
  assert.equal(reconnected.answerId, q.answers[0].id);
  await f.engine.disconnect(f.code, p.playerId, 's');
  assert.equal(f.engine.get(f.code).players[0].socketId, 'new');
  await f.command('kick', p.playerId);
  await rejects(f.engine.reconnect(f.code, p.playerId, p.sessionToken, 'new2'), 'INVALID_SESSION');
  assert.equal(snapshot(f.engine.get(f.code)).playersCount, 0);
});

test('Il riavvio recupera le scadenze e conteggia i punti una sola volta', async () => {
  const f = await fixture();
  const p = await f.engine.join(f.code, 'A', 's');
  await f.command('start'); await f.command();
  const q = f.engine.get(f.code).questions[0];
  await f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id);
  f.advance(15000);
  const restored = new GameEngine({ store: f.store, repository: f.repo, now: f.now });
  await restored.restore();
  assert.equal(restored.get(f.code).status, 'QUESTION_LOCKED');
  assert.equal(restored.get(f.code).players[0].score, 100);
  assert.equal(restored.get(f.code).players[0].socketId, null);
  await restored.tick();
  assert.equal(restored.get(f.code).players[0].score, 100);
  await restored.reconnect(f.code, p.playerId, p.sessionToken, 'new');
});

test('Gestisce lettura nulla, nessun invio, chiusura anticipata e scadenza', async () => {
  const f = await fixture(1);
  f.engine.get(f.code).questions[0].preview_seconds = 0;
  await f.command('start'); await f.engine.tick();
  assert.equal(f.engine.get(f.code).status, 'QUESTION_ACTIVE');
  await f.command(); await f.command();
  assert.deepEqual(snapshot(f.engine.get(f.code)).statistics.map(s => s.percentage), [0,0]);
  await f.command('end');
  assert.equal(f.repo.archived.length, 1);
  f.advance(3600001); await f.engine.tick();
  assert.throws(() => f.engine.get(f.code), e => e.code === 'GAME_NOT_FOUND');
  const other = await fixture();
  other.advance(86400001); await other.engine.tick();
  assert.equal(other.repo.archived[0].endReason, 'expired');
});

test('Errori di archivio o Redis consentono un nuovo tentativo senza alterare lo stato confermato', async () => {
  const f = await fixture();
  const save = f.store.save.bind(f.store);
  f.store.save = async () => { throw new Error('Redis down'); };
  await assert.rejects(f.engine.join(f.code, 'A', 's'));
  assert.equal(f.engine.get(f.code).players.length, 0);
  f.store.save = save;
  await f.command('start');
  const archive = f.repo.archive.bind(f.repo);
  f.repo.archive = async () => { throw new Error('DB down'); };
  await assert.rejects(f.command('end'));
  assert.equal(f.engine.get(f.code).status, 'QUESTION_PREVIEW');
  f.repo.archive = archive;
  await f.command('end');
  assert.equal(f.engine.get(f.code).status, 'ENDED');
});

test('Rifiuta quiz non validi prima della creazione e non pubblica segreti delle sessioni', async () => {
  const f = await fixture();
  const p = await f.engine.join(f.code, 'A', 's');
  const data = JSON.stringify(snapshot(f.engine.get(f.code)));
  assert.ok(!data.includes(p.sessionToken));
  assert.ok(!data.includes('tokenHash'));
  const invalid = quiz(); invalid.questions[0].answers[0].is_correct = false;
  f.repo.loadQuiz = async () => invalid;
  await rejects(f.engine.create('owner', invalid.id), 'INVALID_QUIZ');
  assert.equal(f.repo.created.length, 1);
});
