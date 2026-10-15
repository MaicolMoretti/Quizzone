/**
 * Verifica le decisioni esplicite del conduttore sulla classifica e sui passaggi
 * di fase, assicurando che punteggi e risposte non vengano conteggiati due volte.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, snapshot } = require('../lib/engine');
const { fixture } = require('./helpers');
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);

test('Scelta host: classifica esplicita, salto diretto e finale cumulativo senza ricalcoli', async () => {
  const f = await fixture(3);
  const p = await f.engine.join(f.code, 'Anna', 's');
  await f.command('start');
  for (let i = 0; i < 3; i++) {
    await f.command(); // Termina la fase di anteprima.
    const q = f.engine.get(f.code).questions[i];
    f.advance(2500);
    await f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id);
    assert.equal(f.engine.get(f.code).status, 'QUESTION_LOCKED');
    assert.equal(f.engine.get(f.code).players[0].score, (i + 1) * 50);
    assert.equal(snapshot(f.engine.get(f.code)).leaderboard, undefined);
    await f.engine.tick();
    assert.equal(f.engine.get(f.code).status, 'QUESTION_LOCKED');
    if (i === 1) {
      await f.command(); // La soluzione può essere mostrata senza pubblicare la classifica.
      assert.equal(snapshot(f.engine.get(f.code)).leaderboard, undefined);
      await f.command('show_leaderboard');
      assert.equal(snapshot(f.engine.get(f.code)).leaderboard[0].score, 100);
      await f.engine.tick();
      assert.equal(f.engine.get(f.code).players[0].score, 100);
    }
    const before = f.events.length;
    await f.command('next_question');
    assert.equal(f.engine.get(f.code).status, i === 2 ? 'FINAL_RESULTS' : 'QUESTION_PREVIEW');
    assert.ok(f.events.slice(before).every(s => s.status !== 'LEADERBOARD' && s.status !== 'NEXT_QUESTION'));
  }
  await f.command();
  assert.equal(f.repo.archived[0].players[0].score, 150);
  assert.deepEqual(f.repo.archived[0].submissions.map(a => a.points_awarded), [50, 50, 50]);
});

test('Solo host autorizzato, fase valida e una sola scelta per revisione', async () => {
  const f = await fixture();
  await rejects(f.command('show_leaderboard'), 'INVALID_STATE');
  await rejects(f.command('next_question'), 'INVALID_STATE');
  await f.command('start'); await f.command(); await f.command();
  for (const command of ['show_leaderboard', 'next_question']) {
    await rejects(f.engine.command(f.code, 'intruder', command, f.engine.get(f.code).revision), 'FORBIDDEN');
  }
  const revision = f.engine.get(f.code).revision;
  const choices = await Promise.allSettled([
    f.engine.command(f.code, 'owner', 'next_question', revision),
    f.engine.command(f.code, 'owner', 'show_leaderboard', revision),
    f.engine.command(f.code, 'owner', 'next_question', revision),
  ]);
  assert.equal(choices[0].status, 'fulfilled');
  assert.ok(choices.slice(1).every(r => r.reason.code === 'STALE_STATE'));
  assert.equal(f.engine.get(f.code).currentQuestionIndex, 1);
});

test('Tempo server, errori, invalidi, ritardi, duplicati e riconnessioni', async () => {
  const f = await fixture(1);
  const players = [];
  for (let i = 0; i < 5; i++) players.push(await f.engine.join(f.code, `P${i}`, `s${i}`));
  await f.command('start'); await f.command();
  const q = f.engine.get(f.code).questions[0];
  const answer = (i, id = q.answers[0].id) => f.engine.answer(f.code, players[i].playerId, `s${i}`, q.id, id);
  await rejects(answer(0, 'invalid'), 'INVALID_ANSWER');
  assert.equal(f.engine.get(f.code).submissions.length, 0);
  await answer(0);
  f.advance(2500); await answer(1);
  f.advance(2499); await answer(2);
  await answer(3, q.answers[1].id);
  f.advance(1);
  await rejects(answer(4), 'ANSWERS_CLOSED');
  assert.deepEqual(f.engine.get(f.code).submissions.map(a => a.points_awarded), [100, 50, 1, -20]);
  await f.engine.reconnect(f.code, players[0].playerId, players[0].sessionToken, 'new');
  await rejects(f.engine.answer(f.code, players[0].playerId, 'new', q.id, q.answers[0].id), 'ALREADY_ANSWERED');
  await f.command('show_leaderboard');
  assert.deepEqual(snapshot(f.engine.get(f.code)).leaderboard.map(p => p.score), [100, 50, 1, 0, -20]);
  await f.command('next_question'); await f.command();
  assert.deepEqual(f.repo.archived[0].players.map(p => p.score), [100, 50, 1, -20, 0]);
});

test('Risposta ricevuta in tempo resta valida con coda e persistenza oltre scadenza', async () => {
  const f = await fixture(1);
  const p = await f.engine.join(f.code, 'Anna', 's');
  await f.command('start'); await f.command();
  const q = f.engine.get(f.code).questions[0];
  let release;
  const blocker = f.engine.serial(f.code, () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  f.advance(2500);
  const response = f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id);
  f.advance(10000);
  const tick = f.engine.tick();
  release(); await blocker; await response; await tick;
  assert.equal(f.engine.get(f.code).submissions[0].response_time, 2500);
  assert.equal(f.engine.get(f.code).players[0].score, 50);
});

test('Ripristino della decisione host e dei punti senza nuova assegnazione', async () => {
  const f = await fixture(1);
  const p = await f.engine.join(f.code, 'Anna', 's');
  await f.command('start'); await f.command();
  const q = f.engine.get(f.code).questions[0];
  await f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id);
  const restored = new GameEngine({ store: f.store, repository: f.repo, now: f.now });
  await restored.restore();
  assert.equal(restored.get(f.code).status, 'QUESTION_LOCKED');
  assert.equal(snapshot(restored.get(f.code)).leaderboard, undefined);
  await restored.reconnect(f.code, p.playerId, p.sessionToken, 'new');
  await restored.command(f.code, 'owner', 'show_leaderboard', restored.get(f.code).revision);
  assert.equal(snapshot(restored.get(f.code)).leaderboard[0].score, 100);
  const again = new GameEngine({ store: f.store, repository: f.repo, now: f.now });
  await again.restore();
  assert.equal(again.get(f.code).status, 'LEADERBOARD');
  assert.equal(again.get(f.code).players[0].score, 100);
});

test('Disconnessi attesi fino alla scadenza, espulsione chiude se restano solo risposte complete', async () => {
  const f = await fixture();
  const p = await f.engine.join(f.code, 'Anna', 's');
  const other = await f.engine.join(f.code, 'Bruno', 'other');
  await f.command('start'); await f.command();
  await f.engine.disconnect(f.code, other.playerId, 'other');
  const q = f.engine.get(f.code).questions[0];
  await f.engine.answer(f.code, p.playerId, 's', q.id, q.answers[0].id);
  assert.equal(f.engine.get(f.code).status, 'QUESTION_ACTIVE');
  await f.command('kick', other.playerId);
  assert.equal(f.engine.get(f.code).status, 'QUESTION_LOCKED');
  assert.equal(f.engine.get(f.code).players[0].score, 100);
});
