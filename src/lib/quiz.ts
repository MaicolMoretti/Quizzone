export interface Answer { id: string; answer_text: string; is_correct: boolean; answer_order?: number; retired?: boolean }
export interface Question {
  id: string; question_text: string; image_url: string | null; question_order?: number;
  preview_seconds: number; answer_seconds: number; correct_points: number; wrong_points: number;
  answers: Answer[];
}
export interface Quiz { id: string; title: string; description: string | null; updated_at: string; status: string }
export function newQuestion(): Question {
  return { id: crypto.randomUUID(), question_text: '', image_url: null, preview_seconds: 5, answer_seconds: 15,
    correct_points: 100, wrong_points: 0,
    answers: Array.from({ length: 4 }, () => ({ id: crypto.randomUUID(), answer_text: '', is_correct: false })) };
}
export function validateQuestions(questions: Question[]): string | null {
  if (!questions.length || questions.length > 200) return 'Inserisci da 1 a 200 domande.';
  for (const [i, q] of questions.entries()) {
    const prefix = `Domanda ${i + 1}: `;
    if (!q.question_text.trim() || q.question_text.length > 2000) return prefix + 'inserisci un testo (massimo 2000 caratteri).';
    if (q.answers.length < 2 || q.answers.length > 8 || q.answers.some(a => !a.answer_text.trim() || a.answer_text.length > 500)) return prefix + 'compila tutte le risposte (da 2 a 8).';
    if (!q.answers.some(a => a.is_correct)) return prefix + 'seleziona almeno una risposta corretta.';
    for (const [n, min, max] of [[q.preview_seconds, 0, 300], [q.answer_seconds, 1, 600], [q.correct_points, 0, 100000], [q.wrong_points, -100000, 0]]) {
      if (!Number.isInteger(n) || n < min || n > max) return prefix + 'controlla tempi e punteggi.';
    }
    if (q.image_url && !/^https?:\/\//i.test(q.image_url)) return prefix + 'usa un URL immagine http o https.';
  }
  return null;
}
