require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
const { createGameServer } = require('./lib/server');
const { MemoryStore, RedisStore } = require('./lib/store');
const { SupabaseRepository } = require('./lib/repository');

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REDIS_URL, NODE_ENV } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configura SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY in socket-server/.env.');
  const memory = process.env.GAME_STORE === 'memory';
  if (memory && NODE_ENV === 'production') throw new Error('La modalità memory è consentita solo in sviluppo.');
  if (!memory && !REDIS_URL) throw new Error('Configura REDIS_URL oppure GAME_STORE=memory per lo sviluppo.');
  const origins = (process.env.FRONTEND_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()).filter(Boolean);
  if (origins.includes('*') || !origins.length) throw new Error('FRONTEND_ORIGINS deve elencare origini esplicite.');
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT non valida.');
  const server = await createGameServer({
    store: memory ? new MemoryStore() : new RedisStore(REDIS_URL),
    repository: new SupabaseRepository(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), origins,
  });
  try { await server.listen(port); } catch (error) { await server.close(); throw error; }
  console.log(`Game Engine in ascolto sulla porta ${port} (${memory ? 'memoria, solo sviluppo' : 'Redis'}).`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 15000);
    timeout.unref();
    try { await server.close(); clearTimeout(timeout); } catch { process.exitCode = 1; }
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
