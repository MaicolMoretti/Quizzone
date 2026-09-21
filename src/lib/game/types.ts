export type Phase = 'LOBBY' | 'QUESTION_PREVIEW' | 'QUESTION_ACTIVE' | 'QUESTION_LOCKED' | 'ANSWER_REVEAL' | 'LEADERBOARD' | 'NEXT_QUESTION' | 'FINAL_RESULTS' | 'ENDED';
export interface GameState {
  gameId: string; gameCode: string; title: string; status: Phase; revision: number;
  currentQuestionIndex: number; totalQuestions: number; serverTime: number; deadline: number | null; timer: number;
  players: { id: string; nickname: string; connected: boolean }[]; playersCount: number; totalAnswers: number;
  question?: { id: string; question_text: string; image_url: string | null; answers?: { id: string; answer_text: string; is_correct?: boolean }[] };
  statistics?: { answerId: string; count: number; percentage: number }[];
  leaderboard?: { id: string; nickname: string; score: number; rank: number }[];
  endReason?: 'finished' | 'expired';
}
export type GameRole = 'admin' | 'player' | 'presentation';
export interface GameReply { state?: GameState; playerId?: string; sessionToken?: string; answerId?: string | null }
export interface PlayerSession { playerId: string; sessionToken: string }
