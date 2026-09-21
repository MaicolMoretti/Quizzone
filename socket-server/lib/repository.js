const { GameError } = require('./engine');

class SupabaseRepository {
  constructor(url, key) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
  }
  async request(path, { method = 'GET', body, token, prefer } = {}) {
    const response = await fetch(`${this.url}${path}`, {
      method, signal: AbortSignal.timeout(10000),
      headers: { apikey: this.key, Authorization: `Bearer ${token || this.key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const error = new Error('Richiesta Supabase non riuscita');
      error.status = response.status;
      error.dbCode = data?.code;
      throw error;
    }
    return data;
  }
  async authenticate(token) {
    if (typeof token !== 'string' || token.length > 8192 || !token) throw new GameError('UNAUTHORIZED', 'Accesso richiesto.');
    try {
      const user = await this.request('/auth/v1/user', { token });
      if (!user?.id) throw new Error('Utente assente');
      return user.id;
    } catch (error) {
      if (error.status === 401 || error.status === 403) throw new GameError('UNAUTHORIZED', 'Sessione scaduta o non valida.');
      throw error;
    }
  }
  async loadQuiz(userId, quizId) {
    const rows = await this.request(`/rest/v1/quizzes?id=eq.${quizId}&select=id,title,owner_id`);
    const quiz = rows[0];
    if (!quiz) throw new GameError('QUIZ_NOT_FOUND', 'Quiz non trovato.');
    if (quiz.owner_id !== userId) {
      const collaborators = await this.request(`/rest/v1/quiz_collaborators?quiz_id=eq.${quizId}&user_id=eq.${userId}&role=eq.editor&select=id`);
      if (!collaborators.length) throw new GameError('FORBIDDEN', 'Non puoi avviare questo quiz.');
    }
    quiz.questions = await this.request(`/rest/v1/questions?quiz_id=eq.${quizId}&retired=eq.false&select=id,question_text,image_url,question_order,preview_seconds,answer_seconds,correct_points,wrong_points,answers(id,answer_text,answer_order,is_correct,retired)&order=question_order.asc,id.asc`);
    for (const q of quiz.questions) q.answers = q.answers.filter(a => !a.retired).sort((a, b) => a.answer_order - b.answer_order || a.id.localeCompare(b.id));
    return quiz;
  }
  async createGame(game) {
    try {
      await this.request('/rest/v1/games', { method: 'POST', body: {
        id: game.id, quiz_id: game.quizId, game_code: game.code, created_by: game.ownerId, status: 'waiting',
      } });
      return true;
    } catch (error) {
      if (error.dbCode === '23505') return false;
      throw error;
    }
  }
  async startGame(game) {
    await this.request(`/rest/v1/games?id=eq.${game.id}`, { method: 'PATCH', body: {
      status: 'active', started_at: new Date(game.startedAt).toISOString(),
    } });
  }
  async archive(game) {
    await this.request('/rest/v1/rpc/archive_game', { method: 'POST', body: { p_game: {
      id: game.id, status: game.endReason === 'expired' ? 'expired' : 'finished',
      started_at: game.startedAt === null ? null : new Date(game.startedAt).toISOString(),
      ended_at: new Date(game.endedAt).toISOString(),
      players: game.players.map(p => ({ id: p.id, nickname: p.nickname, score: p.score,
        joined_at: new Date(p.joinedAt).toISOString(), last_seen_at: new Date(p.lastSeenAt).toISOString() })),
      answers: game.submissions,
    } } });
  }
}
module.exports = { SupabaseRepository };
