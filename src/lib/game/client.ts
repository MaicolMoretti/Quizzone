/**
 * Trasporto Socket.IO condiviso dal browser. Le richieste attendono una
 * conferma esplicita del server; un timeout non dimostra che il comando sia
 * fallito, quindi il chiamante deve sincronizzare lo stato prima di riprovare.
 */
import { io, type Socket } from 'socket.io-client';
import type { GameReply, GameState } from './types';

export class GameClientError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
/**
 * Crea un socket inizialmente fermo, così il chiamante può registrare tutti
 * i gestori prima della connessione. Il token è presente solo per il conduttore.
 */
export function gameSocket(accessToken?: string): Socket {
  return io(process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3001', {
    autoConnect: false, auth: { accessToken }, reconnection: true, timeout: 10000,
  });
}
/**
 * Uniforma gli errori di rete e gli errori applicativi restituiti nell’ack.
 * Non ripete automaticamente i comandi, per evitare operazioni duplicate.
 */
export async function request(socket: Socket, event: string, payload: object = {}): Promise<GameReply> {
  if (!socket.connected) throw new GameClientError('DISCONNECTED', 'Connessione interrotta. Attendi la riconnessione.');
  let reply;
  try { reply = await socket.timeout(15000).emitWithAck(event, payload); }
  catch { throw new GameClientError('TIMEOUT', 'Il server non ha risposto. Sincronizza la partita prima di riprovare.'); }
  if (!reply.ok) throw new GameClientError(reply.error.code, reply.error.message);
  return reply.data;
}
/**
 * Usa una connessione temporanea per creare la lobby dalla dashboard.
 * La vista del conduttore aprirà il proprio socket; finally chiude questo.
 */
export async function launchGame(quizId: string, accessToken: string): Promise<GameState> {
  const socket = gameSocket(accessToken);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server di gioco non raggiungibile.')), 10000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', () => { clearTimeout(timer); reject(new Error('Server di gioco non raggiungibile.')); });
      socket.connect();
    });
    const result = await request(socket, 'admin:create_game', { quizId });
    if (!result.state) throw new Error('Risposta del server non valida.');
    return result.state;
  } finally { socket.disconnect(); }
}
