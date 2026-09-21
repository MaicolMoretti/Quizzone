const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const { GameEngine, GameError, snapshot } = require('./engine');

async function createGameServer({ store, repository, origins = ['http://localhost:3000'], now = Date.now, tickMs = 250, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: origins, methods: ['GET', 'POST'] },
    allowRequest: (req, done) => done(null, !req.headers.origin || origins.includes(req.headers.origin)),
    maxHttpBufferSize: 16384,
  });
  let healthy = true;
  let closing = false;
  let ticking = false;
  const pending = new Set();
  const track = promise => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  };
  const engine = new GameEngine({ store, repository, now, publish: (game, state) => {
    io.to(game.id).emit('game:state_update', state);
    if (['LEADERBOARD', 'FINAL_RESULTS', 'ENDED'].includes(game.status)) {
      io.to(game.id).emit('game:leaderboard_update', { gameId: game.id, revision: game.revision, leaderboard: state.leaderboard });
    }
    if (game.status === 'ENDED') io.to(game.id).emit('game:ended', state);
  } });
  app.get('/health', (_req, res) => res.status(healthy ? 200 : 503).json({ ok: healthy }));

  await store.connect(() => {
    healthy = false;
    // Stop serving before another instance may acquire the lease.
    io.disconnectSockets(true);
    logger.error('Lease Redis persa: riavviare il Game Engine.');
  });
  try { await engine.restore(); } catch (error) { await store.close(); throw error; }

  io.on('connection', socket => {
    let queue = Promise.resolve();
    let windowStart = now();
    let requests = 0;
    const event = (name, action) => socket.on(name, (payload, ack) => {
      const reply = value => { if (typeof ack === 'function') ack(value); else if (!value.ok) socket.emit('game:error', value.error); };
      if (now() - windowStart >= 1000) { windowStart = now(); requests = 0; }
      if (++requests > 30) { reply({ ok: false, error: { code: 'RATE_LIMIT', message: 'Troppe richieste.' } }); return; }
      queue = queue.then(async () => {
        try {
          if (!healthy || closing) throw new GameError('UNAVAILABLE', 'Server temporaneamente non disponibile.');
          if (!socket.connected) return;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new GameError('INVALID_PAYLOAD', 'Dati non validi.');
          const data = await action(payload);
          reply({ ok: true, data: data || {} });
        } catch (error) {
          if (!(error instanceof GameError)) logger.error('Operazione Game Engine fallita:', error.message);
          reply({ ok: false, error: { code: error instanceof GameError ? error.code : 'INTERNAL_ERROR', message: error instanceof GameError ? error.message : 'Operazione non riuscita. Riprova.' } });
        }
      });
      track(queue);
    });
    const unused = () => {
      if (socket.data.role) throw new GameError('ALREADY_JOINED', 'Questo socket è già associato a una partita.');
    };
    const user = () => repository.authenticate(socket.handshake.auth?.accessToken);
    const bind = async (code, role, playerId) => {
      const game = engine.get(code);
      socket.data = { code, role, playerId };
      await socket.join(game.id);
      const state = snapshot(game, now());
      socket.emit('game:state_update', state);
      return state;
    };
    const requireRole = role => {
      if (socket.data.role !== role) throw new GameError('FORBIDDEN', 'Operazione non consentita.');
      return socket.data.code;
    };

    event('admin:create_game', async ({ quizId }) => {
      unused();
      const code = await engine.create(await user(), quizId);
      return { state: await bind(code, 'admin') };
    });
    const resolveCode = ({ gameCode, gameId }) => {
      if (gameCode) return engine.get(gameCode).code;
      const game = [...engine.games.values()].find(g => g.id === gameId);
      if (!game) throw new GameError('GAME_NOT_FOUND', 'Partita non trovata o scaduta.');
      return game.code;
    };
    event('admin:join', async (payload) => {
      const gameCode = resolveCode(payload);
      unused();
      engine.assertAdmin(engine.get(gameCode), await user());
      return { state: await bind(gameCode, 'admin') };
    });
    event('presentation:join', async (payload) => {
      const gameCode = resolveCode(payload);
      unused();
      engine.get(gameCode);
      return { state: await bind(gameCode, 'presentation') };
    });
    event('player:join', async ({ gameCode, nickname }) => {
      unused();
      const session = await engine.join(gameCode, nickname, socket.id);
      return { ...session, state: await bind(gameCode, 'player', session.playerId) };
    });
    event('player:reconnect', async ({ gameCode, playerId, sessionToken }) => {
      unused();
      const { previousSocketId, answerId } = await engine.reconnect(gameCode, playerId, sessionToken, socket.id);
      if (previousSocketId && previousSocketId !== socket.id) {
        const old = io.sockets.sockets.get(previousSocketId);
        old?.emit('player:session_replaced');
        old?.disconnect(true);
      }
      return { playerId, answerId, state: await bind(gameCode, 'player', playerId) };
    });
    event('player:answer', async ({ questionId, answerId }) => {
      const code = requireRole('player');
      return engine.answer(code, socket.data.playerId, socket.id, questionId, answerId);
    });
    event('game:sync', async () => {
      if (!socket.data.role) throw new GameError('FORBIDDEN', 'Entra prima nella partita.');
      const game = engine.get(socket.data.code);
      const answer = socket.data.role === 'player' ? game.submissions.find(a => a.player_id === socket.data.playerId && a.question_id === game.questions[game.currentQuestionIndex]?.id) : null;
      return { state: snapshot(game, now()), answerId: answer?.answer_id || null };
    });
    for (const [name, command] of Object.entries({ 'admin:start_game': 'start', 'admin:next_state': 'next', 'admin:kick_player': 'kick', 'admin:end_game': 'end' })) {
      event(name, async ({ revision, playerId }) => {
        const code = requireRole('admin');
        const result = await engine.command(code, await user(), command, revision, playerId);
        if (result?.kickedSocketId) {
          const kicked = io.sockets.sockets.get(result.kickedSocketId);
          kicked?.emit('player:kicked');
          kicked?.disconnect(true);
        }
        return { state: snapshot(engine.get(code), now()) };
      });
    }
    socket.on('disconnect', () => {
      queue = queue.then(async () => {
        if (socket.data.role === 'player' && healthy && !closing) {
          await engine.disconnect(socket.data.code, socket.data.playerId, socket.id);
        }
      }).catch(error => logger.error('Disconnessione non salvata:', error.message));
      track(queue);
    });
  });

  const lastTicks = new Map();
  const timer = setInterval(async () => {
    if (ticking || !healthy || closing) return;
    ticking = true;
    try {
      await engine.tick();
      for (const [code, game] of engine.games) {
        if (!game.deadline) { lastTicks.delete(code); continue; }
        const remaining = Math.max(0, Math.ceil((game.deadline - now()) / 1000));
        const key = `${game.deadline}:${remaining}`;
        if (lastTicks.get(code) !== key) {
          lastTicks.set(code, key);
          io.to(game.id).emit('game:timer_update', { gameId: game.id, revision: game.revision, deadline: game.deadline, serverTime: now(), timer: remaining });
        }
      }
      for (const code of lastTicks.keys()) if (!engine.games.has(code)) lastTicks.delete(code);
    } catch (error) { logger.error('Aggiornamento partita fallito:', error.message); }
    finally { ticking = false; }
  }, tickMs);
  timer.unref();

  return {
    app, io, httpServer, engine,
    listen(port = 3001, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => { httpServer.removeListener('error', reject); resolve(httpServer.address()); });
      });
    },
    async close() {
      closing = true;
      healthy = false;
      clearInterval(timer);
      await new Promise(resolve => io.close(resolve));
      await Promise.all([...pending]);
      // Finish already queued mutations before releasing Redis ownership.
      await Promise.all([...engine.queues.values()]);
      await store.close();
    },
  };
}
module.exports = { createGameServer };
