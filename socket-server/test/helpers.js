const { randomUUID } = require('node:crypto');
const { GameEngine } = require('../lib/engine');
const { MemoryStore } = require('../lib/store');

function quiz(count = 2) {
  return { id: randomUUID(), title: 'Quiz di prova', questions: Array.from({ length: count }, (_, i) => ({
    id: randomUUID(), question_text: `Domanda ${i + 1}`, question_order: i + 1,
    preview_seconds: 2, answer_seconds: 5, correct_points: 100, wrong_points: -20,
    answers: [{ id: randomUUID(), answer_text: 'Giusta', is_correct: true }, { id: randomUUID(), answer_text: 'Errata', is_correct: false }],
  })) };
}
function repository(data = quiz()) {
  return {
    data, archived: [], started: [], created: [],
    async authenticate(token) { if (token === 'valid-token') return 'owner'; throw new (require('../lib/engine').GameError)('UNAUTHORIZED', 'Accesso richiesto'); },
    async loadQuiz(user) { if (user !== 'owner') throw new (require('../lib/engine').GameError)('FORBIDDEN', 'Non autorizzato'); return structuredClone(data); },
    async createGame(game) { this.created.push(structuredClone(game)); return true; },
    async startGame(game) { this.started.push(game.id); },
    async archive(game) { this.archived.push(structuredClone(game)); },
  };
}
async function fixture(count = 2) {
  let time = 100000;
  const repo = repository(quiz(count));
  const store = new MemoryStore();
  const events = [];
  const engine = new GameEngine({ store, repository: repo, now: () => time, publish: (_, s) => events.push(s) });
  const code = await engine.create('owner', repo.data.id);
  const command = (name = 'next', playerId) => engine.command(code, 'owner', name, engine.get(code).revision, playerId);
  return { engine, code, store, repo, events, command, now: () => time, advance: ms => { time += ms; } };
}
module.exports = { fixture, repository, quiz };
