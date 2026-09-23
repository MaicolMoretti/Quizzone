/**
 * Regole autoritative della partita: validazione, fasi, timer e punteggi.
 * Lo stato privato contiene quiz completo, invii e hash delle sessioni; solo
 * snapshot() può trasformarlo in dati pubblicabili. Store, repository, orologio
 * e pubblicazione sono iniettati per verificare le regole senza rete reale.
 */
const { randomUUID, randomBytes, randomInt, createHash } = require('node:crypto');

class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new GameError(code, message); };
const hash = (token) => createHash('sha256').update(token).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const visibleResults = new Set(['ANSWER_REVEAL', 'LEADERBOARD', 'NEXT_QUESTION', 'FINAL_RESULTS', 'ENDED']);

/**
 * Convalida l’intero quiz prima di creare record o pubblicare una lobby. Gli
 * UUID devono essere unici; ogni domanda richiede almeno un’opzione corretta.
 */
function validateQuiz(quiz) {
  if (!quiz || !uuid(quiz.id) || !Array.isArray(quiz.questions) || !quiz.questions.length || quiz.questions.length > 200) {
    fail('INVALID_QUIZ', 'Il quiz deve contenere da 1 a 200 domande.');
  }
  const ids = new Set();
  for (const q of quiz.questions) {
    if (!uuid(q.id) || ids.has(q.id) || typeof q.question_text !== 'string' || !q.question_text.trim() ||
        !integer(q.preview_seconds, 0, 300) || !integer(q.answer_seconds, 1, 600) ||
        !integer(q.correct_points, 0, 100000) || !integer(q.wrong_points, -100000, 0) ||
        !Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 8 || !q.answers.some(a => a.is_correct === true)) {
      fail('INVALID_QUIZ', 'Domande, tempi, punti o risposte del quiz non validi.');
    }
    ids.add(q.id);
    for (const a of q.answers) {
      if (!uuid(a.id) || ids.has(a.id) || typeof a.answer_text !== 'string' || !a.answer_text.trim() || typeof a.is_correct !== 'boolean') {
        fail('INVALID_QUIZ', 'Risposta non valida.');
      }
      ids.add(a.id);
    }
  }
}

/**
 * Esclude gli espulsi e assegna lo stesso rango a punteggi uguali (1, 1, 3).
 * Il nickname ordina soltanto la visualizzazione dei giocatori a pari merito.
 */
function leaderboard(game) {
  return game.players.filter(p => !p.kicked).map(p => ({ id: p.id, nickname: p.nickname, score: p.score }))
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
    .map((p, i, rows) => ({ ...p, rank: rows.findIndex(r => r.score === p.score) + 1 }));
}

// Unica rappresentazione ammessa nei messaggi pubblici: non inviare mai lo stato privato.
function snapshot(game, now = Date.now()) {
  const q = game.questions[game.currentQuestionIndex];
  const reveal = visibleResults.has(game.status);
  const state = {
    gameId: game.id, gameCode: game.code, title: game.title, status: game.status,
    revision: game.revision, currentQuestionIndex: game.currentQuestionIndex,
    totalQuestions: game.questions.length, serverTime: now, deadline: game.deadline,
    timer: game.deadline ? Math.max(0, Math.ceil((game.deadline - now) / 1000)) : 0,
    players: game.players.filter(p => !p.kicked).map(p => ({ id: p.id, nickname: p.nickname, connected: !!p.socketId })),
    playersCount: game.players.filter(p => !p.kicked).length,
    totalAnswers: q ? game.submissions.filter(a => a.question_id === q.id).length : 0,
  };
  if (q) {
    state.question = { id: q.id, question_text: q.question_text, image_url: q.image_url || null };
    if (game.status !== 'QUESTION_PREVIEW') {
      state.question.answers = q.answers.map(a => ({ id: a.id, answer_text: a.answer_text, ...(reveal ? { is_correct: a.is_correct } : {}) }));
    }
    if (reveal) {
      const answers = game.submissions.filter(a => a.question_id === q.id);
      state.statistics = q.answers.map(a => {
        const count = answers.filter(s => s.answer_id === a.id).length;
        return { answerId: a.id, count, percentage: answers.length ? Math.round(count / answers.length * 100) : 0 };
      });
    }
  }
  // Durante QUESTION_LOCKED i nuovi punteggi devono restare nascosti fino alla soluzione.
  if (reveal) state.leaderboard = leaderboard(game);
  if (game.endReason) state.endReason = game.endReason;
  return state;
}

class GameEngine {
  constructor({ store, repository, now = Date.now, publish = () => {}, maxGames = 100, maxPlayers = 500, ttlMs = 86400000 }) {
    Object.assign(this, { store, repository, now, publish, maxGames, maxPlayers, ttlMs });
    this.games = new Map();
    this.queues = new Map();
  }

  /**
   * Ricarica gli stati persistiti, azzera i vecchi socket e recupera subito
   * le scadenze trascorse: un riavvio non concede tempo aggiuntivo.
   */
  async restore() {
    for (const game of await this.store.loadAll()) {
      for (const p of game.players) p.socketId = null;
      this.games.set(game.code, game);
      await this.store.save(game);
    }
    await this.tick();
  }

  /**
   * Accoda le operazioni per partita. Una richiesta fallita non blocca quelle
   * successive; la coda separata "create" serializza l’assegnazione dei codici.
   */
  serial(key, action) {
    const pending = (this.queues.get(key) || Promise.resolve()).then(action);
    const tail = pending.catch(() => {});
    this.queues.set(key, tail);
    tail.then(() => { if (this.queues.get(key) === tail) this.queues.delete(key); });
    return pending;
  }

  get(code) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) fail('INVALID_CODE', 'Codice partita non valido.');
    const game = this.games.get(code);
    if (!game) fail('GAME_NOT_FOUND', 'Partita non trovata.');
    return game;
  }

  /**
   * Incrementa la revisione e persiste prima di sostituire lo stato in memoria
   * e pubblicarlo. Se lo store fallisce, lo stato confermato resta invariato.
   */
  async save(game) {
    game.revision += 1;
    await this.store.save(game);
    this.games.set(game.code, structuredClone(game));
    this.publish(game, snapshot(game, this.now()));
  }

  /**
   * Lavora su una copia privata sotto la coda della partita. Applica prima
   * scadenza e timer, poi il comando: evita risposte tardive e aggiornamenti persi.
   */
  mutate(code, action) {
    return this.serial(code, async () => {
      const game = structuredClone(this.get(code));
      if (game.expiresAt <= this.now() && game.status !== 'ENDED') {
        await this.end(game, 'expired');
        await this.save(game);
        fail('GAME_ENDED', 'Partita scaduta.');
      }
      // La scadenza server decide la validità dell’invio, anche se il timer periodico è in ritardo.
      if (this.advanceTimers(game)) await this.save(game);
      const result = await action(game);
      await this.save(game);
      return result;
    });
  }

  /**
   * Carica un quiz autorizzato e ne conserva il contenuto nella partita.
   * Riprova fino a venti codici casuali, rispettando anche l’unicità nel database.
   */
  async create(userId, quizId) {
    if (!uuid(quizId)) fail('INVALID_QUIZ', 'Identificativo quiz non valido.');
    return this.serial('create', async () => {
      if ([...this.games.values()].filter(g => g.status !== 'ENDED').length >= this.maxGames) fail('CAPACITY', 'Numero massimo di partite raggiunto.');
      const quiz = await this.repository.loadQuiz(userId, quizId);
      validateQuiz(quiz);
      const game = {
        id: randomUUID(), quizId, ownerId: userId, title: quiz.title,
        questions: quiz.questions, status: 'LOBBY', players: [], submissions: [],
        currentQuestionIndex: -1, deadline: null, activeStartedAt: null,
        createdAt: this.now(), startedAt: null, endedAt: null, expiresAt: this.now() + this.ttlMs, revision: 0,
      };
      let created = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        game.code = String(randomInt(100000, 1000000));
        if (this.games.has(game.code)) continue;
        if (await this.repository.createGame(game)) { created = true; break; }
      }
      if (!created) fail('CAPACITY', 'Impossibile assegnare un codice partita.');
      await this.save(game);
      return game.code;
    });
  }

  /**
   * Solo chi ha creato questa partita può condurla, anche se altri utenti
   * collaborano alla modifica del quiz originale.
   */
  assertAdmin(game, userId) {
    if (!userId || game.ownerId !== userId) fail('FORBIDDEN', 'Solo il conduttore può controllare questa partita.');
  }

  /**
   * Normalizza il nickname e controlla duplicati, capienza e fase lobby.
   * Il token casuale viene restituito una sola volta; nello store resta l’hash.
   */
  async join(code, nickname, socketId) {
    if (typeof nickname !== 'string') fail('INVALID_NICKNAME', 'Nickname non valido.');
    nickname = nickname.trim().normalize('NFKC');
    if (!nickname || nickname.length > 32 || /[\p{Cc}\p{Cf}]/u.test(nickname)) fail('INVALID_NICKNAME', 'Usa un nickname da 1 a 32 caratteri.');
    return this.mutate(code, game => {
      if (game.status !== 'LOBBY') fail('GAME_STARTED', 'Gli ingressi sono consentiti solo nella lobby.');
      if (game.players.some(p => p.nickname.toLocaleLowerCase('it') === nickname.toLocaleLowerCase('it'))) fail('NICKNAME_TAKEN', 'Nickname già utilizzato.');
      if (game.players.length >= this.maxPlayers) fail('CAPACITY', 'La partita è piena.');
      const token = randomBytes(32).toString('hex');
      const player = { id: randomUUID(), nickname, tokenHash: hash(token), socketId, score: 0, joinedAt: this.now(), lastSeenAt: this.now(), kicked: false };
      game.players.push(player);
      return { playerId: player.id, sessionToken: token };
    });
  }

  /**
   * Autentica l’identità già creata, sostituisce il socket precedente e
   * recupera l’invio corrente. Una sessione espulsa non può essere riattivata.
   */
  reconnect(code, playerId, token, socketId) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('INVALID_SESSION', 'Sessione non valida.');
    return this.mutate(code, game => {
      const p = game.players.find(p => p.id === playerId && p.tokenHash === hash(token));
      if (!p || p.kicked) fail('INVALID_SESSION', 'Sessione non valida o giocatore rimosso.');
      const previousSocketId = p.socketId;
      p.socketId = socketId;
      p.lastSeenAt = this.now();
      const answer = game.submissions.find(a => a.player_id === p.id && a.question_id === game.questions[game.currentQuestionIndex]?.id);
      return { playerId: p.id, previousSocketId, answerId: answer?.answer_id || null };
    });
  }

  /**
   * Aggiorna solo il socket ancora associato: la disconnessione del vecchio
   * trasporto non deve annullare una riconnessione già completata.
   */
  disconnect(code, playerId, socketId) {
    return this.mutate(code, game => {
      const p = game.players.find(p => p.id === playerId && p.socketId === socketId);
      if (p) { p.socketId = null; p.lastSeenAt = this.now(); }
    });
  }

  /**
   * Accetta un solo invio per giocatore e domanda attiva. Correttezza, punti
   * e tempo impiegato sono calcolati sul server, mai accettati dal client.
   */
  answer(code, playerId, socketId, questionId, answerId) {
    return this.mutate(code, game => {
      const p = game.players.find(p => p.id === playerId && p.socketId === socketId && !p.kicked);
      if (!p) fail('INVALID_SESSION', 'Entra nella partita prima di rispondere.');
      if (game.status !== 'QUESTION_ACTIVE') fail('ANSWERS_CLOSED', 'Le risposte sono chiuse.');
      const q = game.questions[game.currentQuestionIndex];
      if (q.id !== questionId) fail('INVALID_QUESTION', 'La domanda non è quella attiva.');
      const a = q.answers.find(a => a.id === answerId);
      if (!a) fail('INVALID_ANSWER', 'Risposta non valida.');
      if (game.submissions.some(s => s.player_id === p.id && s.question_id === q.id)) fail('ALREADY_ANSWERED', 'Hai già risposto.');
      game.submissions.push({ id: randomUUID(), game_id: game.id, player_id: p.id, question_id: q.id, answer_id: a.id,
        is_correct: a.is_correct, points_awarded: a.is_correct ? q.correct_points : q.wrong_points,
        response_time: Math.max(0, this.now() - game.activeStartedAt), created_at: new Date(this.now()).toISOString() });
      p.lastSeenAt = this.now();
      return { answerId };
    });
  }

  /**
   * Seleziona la domanda successiva e programma la fine della lettura
   * utilizzando un istante assoluto, espresso in millisecondi.
   */
  preview(game, time) {
    game.currentQuestionIndex += 1;
    game.status = 'QUESTION_PREVIEW';
    game.deadline = time + game.questions[game.currentQuestionIndex].preview_seconds * 1000;
  }

  /**
   * Apre gli invii e fissa l’istante iniziale da cui misurare il tempo risposta.
   */
  activate(game, time) {
    game.status = 'QUESTION_ACTIVE';
    game.activeStartedAt = time;
    game.deadline = time + game.questions[game.currentQuestionIndex].answer_seconds * 1000;
  }

  /**
   * Chiude gli invii e somma i punti una sola volta nella transizione da
   * QUESTION_ACTIVE. Le chiamate successive ai timer non ripetono il conteggio.
   */
  lock(game) {
    game.status = 'QUESTION_LOCKED';
    game.deadline = null;
    const questionId = game.questions[game.currentQuestionIndex].id;
    for (const a of game.submissions.filter(a => a.question_id === questionId)) {
      const player = game.players.find(p => p.id === a.player_id);
      player.score += a.points_awarded;
    }
  }

  /**
   * Recupera in sequenza le transizioni scadute. L’attivazione usa la scadenza
   * della preview, non l’ora del controllo, così un ritardo non allunga il quiz.
   */
  advanceTimers(game) {
    let changed = false;
    if (game.status === 'NEXT_QUESTION') { this.preview(game, this.now()); changed = true; }
    if (game.status === 'QUESTION_PREVIEW' && game.deadline <= this.now()) {
      this.activate(game, game.deadline); changed = true;
    }
    if (game.status === 'QUESTION_ACTIVE' && game.deadline <= this.now()) {
      this.lock(game); changed = true;
    }
    return changed;
  }

  /**
   * Chiude l’eventuale domanda attiva e archivia prima di confermare ENDED.
   * Un errore di archivio risale al chiamante e lascia possibile un nuovo tentativo.
   */
  async end(game, reason = 'finished') {
    if (game.status === 'QUESTION_ACTIVE') this.lock(game);
    game.status = 'ENDED';
    game.endReason = reason;
    game.deadline = null;
    game.endedAt = this.now();
    await this.repository.archive(game);
    // Mantiene riconnessione e risultati finali disponibili per un’ora.
    game.expiresAt = this.now() + 3600000;
  }

  /**
   * Esegue i comandi del conduttore solo sulla revisione più recente.
   * Le transizioni manuali seguono la macchina a stati; la chiusura anticipata
   * usa lo stesso percorso di archiviazione della conclusione normale.
   */
  command(code, userId, command, revision, playerId) {
    return this.mutate(code, async game => {
      this.assertAdmin(game, userId);
      if (game.status === 'ENDED') fail('GAME_ENDED', 'Partita terminata.');
      // Doppi clic e schede del conduttore non aggiornate non possono saltare una fase.
      if (revision !== game.revision) fail('STALE_STATE', 'Stato aggiornato: sincronizza e riprova.');
      if (command === 'kick') {
        const p = game.players.find(p => p.id === playerId && !p.kicked);
        if (!p) fail('PLAYER_NOT_FOUND', 'Giocatore non trovato.');
        p.kicked = true;
        const socketId = p.socketId;
        p.socketId = null;
        return { kickedSocketId: socketId };
      }
      if (command === 'end') { await this.end(game); return; }
      if (command === 'start') {
        if (game.status !== 'LOBBY') fail('INVALID_STATE', 'La partita è già iniziata.');
        game.startedAt = this.now();
        await this.repository.startGame(game);
        this.preview(game, this.now());
        return;
      }
      if (command !== 'next') fail('INVALID_COMMAND', 'Comando non valido.');
      switch (game.status) {
        case 'QUESTION_PREVIEW': this.activate(game, this.now()); break;
        case 'QUESTION_ACTIVE': this.lock(game); break;
        case 'QUESTION_LOCKED': game.status = 'ANSWER_REVEAL'; break;
        case 'ANSWER_REVEAL': game.status = 'LEADERBOARD'; break;
        case 'LEADERBOARD': game.status = game.currentQuestionIndex + 1 < game.questions.length ? 'NEXT_QUESTION' : 'FINAL_RESULTS'; break;
        case 'FINAL_RESULTS': await this.end(game); break;
        default: fail('INVALID_STATE', 'Transizione non consentita.');
      }
    });
  }

  /**
   * Controllo periodico delle scadenze: serializza per partita, archivia quelle
   * scadute e rimuove gli stati finali al termine dell’ora di conservazione.
   */
  async tick() {
    await Promise.all([...this.games.keys()].map(code => this.serial(code, async () => {
      const game = structuredClone(this.get(code));
      if (game.expiresAt <= this.now()) {
        if (game.status === 'ENDED') {
          await this.store.remove(game.code);
          this.games.delete(code);
          return;
        }
        await this.end(game, 'expired');
        await this.save(game);
      } else if (this.advanceTimers(game)) await this.save(game);
    })));
  }
}

module.exports = { GameEngine, GameError, snapshot, leaderboard, validateQuiz, uuid };
