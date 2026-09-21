const { randomUUID } = require('node:crypto');
const Redis = require('ioredis');

class MemoryStore {
  constructor() { this.data = new Map(); }
  async connect() {}
  async loadAll() { return [...this.data.values()].map(g => structuredClone(g)); }
  async save(game) { this.data.set(game.code, structuredClone(game)); }
  async remove(code) { this.data.delete(code); }
  async close() {}
}

// One engine owns a Redis namespace. The lease prevents accidental competing timers.
class RedisStore {
  constructor(url, prefix = 'quizzone:') {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on('error', () => {}); // Request failures are propagated; never log credential-bearing URLs.
    this.prefix = prefix;
    this.leaseKey = `${prefix}engine-lease`;
    this.token = randomUUID();
    this.ready = false;
  }
  async connect(onLeaseLost = () => {}) {
    try { await this.redis.connect(); } catch (error) { this.redis.disconnect(); throw error; }
    if (await this.redis.set(this.leaseKey, this.token, 'PX', 30000, 'NX') !== 'OK') {
      await this.redis.quit();
      throw new Error('Un altro Game Engine gestisce già questo namespace Redis.');
    }
    this.ready = true;
    this.heartbeat = setInterval(async () => {
      try {
        const ok = await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], 30000) else return 0 end", 1, this.leaseKey, this.token);
        if (!ok) throw new Error('Lease persa');
      } catch {
        this.ready = false;
        clearInterval(this.heartbeat);
        onLeaseLost();
      }
    }, 5000);
    this.heartbeat.unref();
  }
  async loadAll() {
    const games = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${this.prefix}game:*`, 'COUNT', 100);
      cursor = next;
      if (keys.length) {
        const values = await this.redis.mget(...keys);
        games.push(...values.filter(Boolean).map(v => JSON.parse(v)));
      }
    } while (cursor !== '0');
    return games;
  }
  async write(code, value) {
    if (!this.ready) throw new Error('Redis non disponibile');
    const ok = await this.redis.eval(`
      if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
      if ARGV[2] == '' then redis.call('del', KEYS[2]) else redis.call('set', KEYS[2], ARGV[2]) end
      return 1`, 2, this.leaseKey, `${this.prefix}game:${code}`, this.token, value);
    if (!ok) throw new Error('Lease Redis persa');
  }
  async save(game) { await this.write(game.code, JSON.stringify(game)); }
  async remove(code) { await this.write(code, ''); }
  async close() {
    clearInterval(this.heartbeat);
    this.ready = false;
    try {
      await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, this.leaseKey, this.token);
    } finally { this.redis.disconnect(); }
  }
}
module.exports = { MemoryStore, RedisStore };
