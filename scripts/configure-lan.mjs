/**
 * Configura gli indirizzi raggiungibili da telefoni nella rete locale.
 * Seleziona un IPv4 privato del computer, oppure quello passato come argomento,
 * e aggiorna soltanto URL pubblici e origini consentite nei due file .env.
 * Non crea credenziali e non stampa il contenuto dei file riservati.
 */
import { networkInterfaces } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
  (entries || []).filter(e => e.family === 'IPv4' && !e.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(e.address)).map(e => ({ name, address: e.address })));
const requested = process.argv[2];
// Preferisce en0 su macOS; con più alternative richiede un IP esplicito, senza indovinare.
const preferred = addresses.find(e => e.name === 'en0') || (addresses.length === 1 ? addresses[0] : undefined);
const selected = requested ? addresses.find(e => e.address === requested) : preferred;
if (!selected) {
  console.error('Indica un indirizzo IPv4 della tua rete: npm run configure:lan -- <IP>');
  console.error(addresses.map(e => `${e.name}: ${e.address}`).join('\n') || 'Nessuna interfaccia di rete privata disponibile.');
  process.exit(1);
}
const frontendPath = resolve(root, '.env.local');
const backendPath = resolve(root, 'socket-server/.env');
// Legge entrambi i file prima di modificarli, preservando credenziali e altre impostazioni.
let frontend = readFileSync(frontendPath, 'utf8');
let backend = readFileSync(backendPath, 'utf8');
const backendEnv = parseEnv(backend);
const frontendPort = process.env.FRONTEND_PORT || '3000';
const backendPort = backendEnv.PORT || '3001';
for (const port of [frontendPort, backendPort]) {
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Porta non valida.');
}
const appUrl = `http://${selected.address}:${frontendPort}`;
// Sostituisce la singola assegnazione, anche con export, preservando il resto del file.
function setValue(content, key, value) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm');
  return pattern.test(content) ? content.replace(pattern, () => `${key}=${value}`) : `${content.trimEnd()}\n${key}=${value}\n`;
}
frontend = setValue(frontend, 'NEXT_PUBLIC_APP_URL', appUrl);
frontend = setValue(frontend, 'NEXT_PUBLIC_GAME_SERVER_URL', `http://${selected.address}:${backendPort}`);
// Mantiene localhost e le origini già configurate; aggiunge quella raggiungibile in LAN.
const origins = new Set((backendEnv.FRONTEND_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
for (const origin of [`http://localhost:${frontendPort}`, `http://127.0.0.1:${frontendPort}`, appUrl]) origins.add(origin);
backend = setValue(backend, 'FRONTEND_ORIGINS', [...origins].join(','));
writeFileSync(frontendPath, frontend);
writeFileSync(backendPath, backend, { mode: 0o600 });
console.log(`Indirizzo per computer e telefoni sulla stessa rete: ${appUrl}`);
console.log('QR, Game Engine e origini consentite configurati. Riavvia frontend e Game Engine.');
