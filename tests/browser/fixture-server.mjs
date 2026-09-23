/**
 * Servizi isolati per le prove browser: Auth e REST sono simulati in memoria,
 * mentre il server Socket.IO è quello dell’applicazione. Le credenziali di prova
 * non sono valide su Supabase. Non carica i file .env e non scrive nel database reale.
 */
// Questi servizi vengono avviati e chiusi da Playwright sulle porte riservate ai test.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const express = require('../../socket-server/node_modules/express');
const { createGameServer } = require('../../socket-server/lib/server');
const { MemoryStore } = require('../../socket-server/lib/store');
const { GameError } = require('../../socket-server/lib/engine');
const app = express(); app.use(express.json());
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const user = { id: randomUUID(), email: 'host@example.test', aud: 'authenticated', role: 'authenticated', email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
// JWT deliberatamente fittizio: la fixture lo riconosce per confronto esatto, senza firma reale.
const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
const quizzes = new Map();
const games = new Map();
const archives = [];
app.post('/auth/v1/token', (_req, res) => res.json({ access_token: accessToken, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user }));
app.get('/auth/v1/user', (_req, res) => res.json(user));
app.post('/auth/v1/logout', (_req, res) => res.sendStatus(204));
app.get('/rest/v1/quizzes', (req, res) => {
  if (req.query.id) return res.json(quizzes.get(req.query.id.replace('eq.', '')));
  res.json([...quizzes.values()]);
});
app.post('/rest/v1/quizzes', (req, res) => {
  const quiz = { ...req.body, id: req.body.id || randomUUID(), updated_at: new Date().toISOString(), questions: [] };
  quizzes.set(quiz.id, quiz); res.status(201).json(quiz);
});
app.get('/rest/v1/games', (_req, res) => res.json([...games.values()].filter(g => ['waiting', 'active'].includes(g.status))));
app.post('/rest/v1/rpc/save_quiz', (req, res) => {
  const p = req.body, quiz = quizzes.get(p.p_quiz_id);
  if (!quiz) return res.status(404).json({ message: 'Quiz non trovato' });
  if (p.p_expected_updated_at !== quiz.updated_at) return res.status(409).json({ message: 'Modifica concorrente' });
  quiz.title = p.p_title; quiz.description = p.p_description; quiz.questions = p.p_questions;
  quiz.updated_at = new Date().toISOString(); res.json(quiz.updated_at);
});
app.get('/test/archive', (_req, res) => res.json(archives));
const repository = {
  async authenticate(token) { if (token !== accessToken) throw new GameError('UNAUTHORIZED', 'Accesso richiesto'); return user.id; },
  async loadQuiz(_userId, id) { return structuredClone(quizzes.get(id)); },
  async createGame(game) { games.set(game.id, { id: game.id, quiz_id: game.quizId, game_code: game.code, status: 'waiting', created_at: new Date().toISOString() }); return true; },
  async startGame(game) { games.get(game.id).status = 'active'; },
  async archive(game) { games.get(game.id).status = 'finished'; archives.push(structuredClone(game)); },
};
const api = app.listen(54325, '127.0.0.1');
const server = await createGameServer({ store: new MemoryStore(), repository, origins: ['http://127.0.0.1:3100', 'http://localhost:3100'] });
await server.listen(3101, '127.0.0.1');
const close = async () => { await server.close(); api.close(); };
process.once('SIGTERM', close); process.once('SIGINT', close);
