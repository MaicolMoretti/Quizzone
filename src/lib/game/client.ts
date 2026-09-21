import { io, type Socket } from 'socket.io-client';
import type { GameReply, GameState } from './types';

export class GameClientError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function gameSocket(accessToken?: string): Socket {
  return io(process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3001', {
    autoConnect: false, auth: { accessToken }, reconnection: true, timeout: 10000,
  });
}
export async function request(socket: Socket, event: string, payload: object = {}): Promise<GameReply> {
  if (!socket.connected) throw new GameClientError('DISCONNECTED', 'Connessione interrotta. Attendi la riconnessione.');
  let reply;
  try { reply = await socket.timeout(15000).emitWithAck(event, payload); }
  catch { throw new GameClientError('TIMEOUT', 'Il server non ha risposto. Sincronizza la partita prima di riprovare.'); }
  if (!reply.ok) throw new GameClientError(reply.error.code, reply.error.message);
  return reply.data;
}
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
