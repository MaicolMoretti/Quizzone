/**
 * Prova facoltativa su Redis reale, abilitata solo con TEST_REDIS_URL.
 * Un namespace casuale isola i dati dalle partite effettive; verifica proprietà
 * esclusiva, ripristino e rifiuto delle scritture dopo la perdita della lease.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { RedisStore } = require('../lib/store');
const { GameEngine } = require('../lib/engine');
const { repository } = require('./helpers');

test('Redis reale: proprietà esclusiva del motore e recupero dopo riavvio', { skip: !process.env.TEST_REDIS_URL }, async () => {
  const prefix = `quizzone:test:${randomUUID()}:`;
  const first = new RedisStore(process.env.TEST_REDIS_URL, prefix);
  const repo = repository();
  let code;
  let session;
  await first.connect();
  try {
    const engine = new GameEngine({ store: first, repository: repo });
    code = await engine.create('owner', repo.data.id);
    session = await engine.join(code, 'Anna', 'old');
    const competitor = new RedisStore(process.env.TEST_REDIS_URL, prefix);
    await assert.rejects(competitor.connect(), /altro Game Engine/);
  } finally { await first.close(); }
  const second = new RedisStore(process.env.TEST_REDIS_URL, prefix);
  await second.connect();
  try {
    const engine = new GameEngine({ store: second, repository: repo });
    await engine.restore();
    assert.equal(engine.get(code).players[0].socketId, null);
    await engine.reconnect(code, session.playerId, session.sessionToken, 'new');
    assert.equal(engine.get(code).players[0].socketId, 'new');
    // Un motore che ha perso la lease non può sovrascrivere lo stato con una copia obsoleta.
    await second.redis.set(second.leaseKey, 'other-owner');
    await assert.rejects(second.save(engine.get(code)), /Lease Redis persa/);
    await second.redis.set(second.leaseKey, second.token);
    await second.remove(code);
  } finally { await second.close(); }
});
