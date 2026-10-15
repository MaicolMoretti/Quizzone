/**
 * Verifica il percorso di errore quando Redis chiude la connessione.
 * Il client deve essere rilasciato e lo store non deve risultare pronto.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { RedisStore } = require('../lib/store');

test('Redis che chiude la connessione produce una diagnosi e rilascia il client', async () => {
  const endpoint = net.createServer(socket => socket.destroy());
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const store = new RedisStore(`redis://127.0.0.1:${endpoint.address().port}`);
  try {
    await assert.rejects(store.connect(), /Redis non raggiungibile.*docker start quizzone-redis/);
    assert.equal(store.redis.manuallyClosing, true);
    assert.equal(store.redis.reconnectTimeout, null);
    assert.equal(store.ready, false);
  } finally {
    store.redis.disconnect();
    await new Promise(resolve => endpoint.close(resolve));
  }
});
