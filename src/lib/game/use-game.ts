"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { createClient } from '@/lib/supabase/client';
import { gameSocket, request, GameClientError } from './client';
import type { GameState, GameRole, PlayerSession, GameReply } from './types';

export function useGame(role: GameRole, identifier: string) {
  const socketRef = useRef<Socket | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const busyRef = useRef(false);
  const [state, setState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [answer, setAnswer] = useState<{ questionId: string; answerId: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sessionKey = `quizzone:player:${identifier}`;
  const sessionRef = useRef<PlayerSession | null>(null);

  const accept = useCallback((next: GameState) => {
    if (stateRef.current && next.revision < stateRef.current.revision) return;
    stateRef.current = next; setState(next);
  }, []);
  const acceptReply = useCallback((reply: GameReply) => {
    if (reply.state) {
      accept(reply.state);
      if ('answerId' in reply) setAnswer(reply.answerId && reply.state.question ? { questionId: reply.state.question.id, answerId: reply.answerId } : null);
    }
  }, [accept]);

  useEffect(() => {
    let disposed = false;
    let socket: Socket;
    let unsubscribe: (() => void) | undefined;
    const showError = (e: unknown) => { if (!disposed) setError(e instanceof Error ? e.message : 'Connessione non riuscita.'); };
    async function connect() {
      let token: string | undefined;
      if (role === 'admin') {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) throw new Error('Accedi per controllare la partita.');
        token = data.session.access_token;
        const subscription = supabase.auth.onAuthStateChange((_event, session) => {
          if (socket && session?.access_token !== token) {
            token = session?.access_token;
            if (!token) { socket.disconnect(); showError(new Error('Sessione scaduta. Accedi nuovamente.')); }
            else { socket.auth = { accessToken: token }; socket.disconnect().connect(); }
          }
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
      }
      if (disposed) { unsubscribe?.(); return; }
      if (role === 'player' && !sessionRef.current) {
        try { sessionRef.current = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { /* A new session can still be created. */ }
      }
      socket = gameSocket(token); socketRef.current = socket;
      socket.on('game:state_update', (next: GameState) => { if (!disposed) accept(next); });
      socket.on('game:timer_update', (tick: { gameId: string; revision: number; timer: number; deadline: number; serverTime: number }) => {
        const current = stateRef.current;
        if (!disposed && current?.gameId === tick.gameId && current.revision === tick.revision && current.deadline === tick.deadline) {
          accept({ ...current, timer: tick.timer, serverTime: tick.serverTime });
        }
      });
      socket.on('connect_error', () => showError(new Error('Server di gioco non raggiungibile. Nuovo tentativo in corso…')));
      socket.on('disconnect', () => { if (!disposed) { setConnected(false); setJoined(false); } });
      socket.on('player:kicked', () => { showError(new Error('Il conduttore ti ha rimosso dalla partita.')); });
      socket.on('player:session_replaced', () => showError(new Error('La tua sessione è aperta su un altro dispositivo o scheda.')));
      socket.on('connect', async () => {
        if (disposed) return;
        setConnected(true); setError('');
        try {
          if (role === 'player') {
            if (!sessionRef.current) return;
            const result = await request(socket, 'player:reconnect', { gameCode: identifier, ...sessionRef.current });
            if (!disposed) { setPlayerId(sessionRef.current.playerId); acceptReply(result); setJoined(true); }
          } else {
            const result = await request(socket, `${role}:join`, { gameId: identifier });
            if (!disposed) { acceptReply(result); setJoined(true); }
          }
        } catch (e) { showError(e); }
      });
      socket.connect();
    }
    void connect().catch(showError);
    return () => { disposed = true; unsubscribe?.(); socket?.removeAllListeners(); socket?.disconnect(); socketRef.current = null; };
  }, [role, identifier, sessionKey, attempt, accept, acceptReply]);

  async function perform(event: string, payload: object = {}) {
    if (busyRef.current) return;
    const socket = socketRef.current;
    if (!socket) { setError('Connessione in corso.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await request(socket, event, payload);
      acceptReply(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operazione non riuscita.');
      if (e instanceof GameClientError && ['STALE_STATE', 'ALREADY_ANSWERED', 'TIMEOUT'].includes(e.code)) {
        try { acceptReply(await request(socket, 'game:sync')); } catch { /* Keep original error and reconnect control. */ }
      }
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function join(nickname: string) {
    const result = await perform('player:join', { gameCode: identifier, nickname });
    if (result?.playerId && result.sessionToken) {
      sessionRef.current = { playerId: result.playerId, sessionToken: result.sessionToken };
      try { localStorage.setItem(sessionKey, JSON.stringify(sessionRef.current)); }
      catch { setError('Il browser non permette di conservare la sessione: evita di ricaricare la pagina.'); }
      setPlayerId(result.playerId); setJoined(true);
    }
  }
  async function submit(answerId: string) {
    const questionId = stateRef.current?.question?.id;
    if (!questionId) return;
    const result = await perform('player:answer', { questionId, answerId });
    if (result?.answerId) setAnswer({ questionId, answerId: result.answerId });
  }
  return { state, connected, joined, busy, error, playerId, join, submit,
    selectedAnswer: answer?.questionId === state?.question?.id ? answer?.answerId : null,
    command: (event: string, playerId?: string) => perform(event, { revision: stateRef.current?.revision, playerId }),
    reconnect: () => { setConnected(false); setJoined(false); setAttempt(n => n + 1); },
  };
}
