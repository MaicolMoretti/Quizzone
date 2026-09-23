/**
 * Persistenza dello stato privato durante la partita. Entrambi gli store
 * espongono connect/loadAll/save/remove/close; Redis aggiunge una proprietà
 * esclusiva temporanea (lease) per impedire che due motori gestiscano gli stessi
 * timer. Il rinnovo e le scritture controllano sempre il token del proprietario.
 */
const { randomUUID } = require('node:crypto');
const Redis = require('ioredis');

/**
 * Store per sviluppo e test: clona gli oggetti per evitare che una mutazione
 * esterna modifichi in anticipo lo stato salvato. Non sopravvive al riavvio.
 */
class MemoryStore {
  constructor() { this.data = new Map(); }
  async connect() {}
  async loadAll() { return [...this.data.values()].map(g => structuredClone(g)); }
  async save(game) { this.data.set(game.code, structuredClone(game)); }
  async remove(code) { this.data.delete(code); }
  async close() {}
}

// Un solo motore possiede il namespace Redis: la lease impedisce timer concorrenti.
class RedisStore {
  constructor(url, prefix = 'quizzone:') {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on('error', () => {}); // Gli errori risalgono dalle richieste; non registrare URL che contengono credenziali.
    this.prefix = prefix;
    this.leaseKey = `${prefix}engine-lease`;
    this.token = randomUUID();
    this.ready = false;
  }
  /**
   * Acquisisce una lease di 30 secondi e la rinnova ogni 5 secondi. Se perde
   * il possesso, avvisa il server e interrompe i rinnovi: serve un riavvio.
   */
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
  /**
   * Legge gli snapshot con SCAN a blocchi, evitando un KEYS sull’intero Redis.
   * Non usa TTL automatiche: il motore deve archiviare prima di eliminare.
   */
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
  /**
   * Lo script Lua verifica il token e scrive/elimina atomicamente.
   * Il semplice controllo locale di ready non basterebbe contro lease scadute.
   */
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
  /**
   * Rilascia soltanto la propria lease; non elimina quella eventualmente
   * acquisita nel frattempo da un altro processo.
   */
  async close() {
    clearInterval(this.heartbeat);
    this.ready = false;
    try {
      await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, this.leaseKey, this.token);
    } finally { this.redis.disconnect(); }
  }
}
module.exports = { MemoryStore, RedisStore };
