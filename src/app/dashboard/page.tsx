"use client";

/**
 * Area degli organizzatori: carica i quiz visibili tramite RLS e le partite
 * aperte create dall’utente. Avviare genera una nuova sessione nel motore;
 * riprendere riapre invece la vista del conduttore per la sessione esistente.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { launchGame } from '@/lib/game/client';
import type { Quiz } from '@/lib/quiz';

type Session = { id: string; quiz_id: string; game_code: string; status: string; created_at: string };
export default function DashboardPage() {
  const [supabase] = useState(createClient);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [games, setGames] = useState<Session[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState('');
  const launchingRef = useRef(false);
  const router = useRouter();
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) { router.replace('/login'); return; }
        // Richieste indipendenti: RLS filtra i quiz; le partite sono del conduttore corrente.
        const [quizResult, gameResult] = await Promise.all([
          supabase.from('quizzes').select('*').order('updated_at', { ascending: false }),
          supabase.from('games').select('id,quiz_id,game_code,status,created_at').eq('created_by', auth.user.id).in('status', ['waiting', 'active']).order('created_at', { ascending: false }),
        ]);
        if (quizResult.error || gameResult.error) throw new Error(quizResult.error?.message || gameResult.error?.message);
        if (!disposed) { setEmail(auth.user.email || ''); setQuizzes(quizResult.data || []); setGames(gameResult.data || []); }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Impossibile caricare la dashboard.'); }
      finally { if (!disposed) setLoading(false); }
    }
    void load(); return () => { disposed = true; };
  }, [supabase, router]);
  // Il riferimento blocca immediatamente avvii duplicati, prima del prossimo render.
  async function start(quizId: string) {
    if (launchingRef.current) return;
    launchingRef.current = true; setLaunching(quizId); setError('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.push('/login'); return; }
      const state = await launchGame(quizId, data.session.access_token);
      router.push(`/game/${state.gameId}/admin`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossibile avviare la partita.'); }
    finally { launchingRef.current = false; setLaunching(''); }
  }
  return <main className="mx-auto min-h-screen max-w-6xl p-5 sm:p-10">
    <header className="mb-10 flex flex-wrap items-center justify-between gap-4"><Link href="/" className="text-3xl font-black text-purple-700">Quizzone</Link><div className="flex items-center gap-4"><span className="text-sm text-gray-500">{email}</span><button onClick={async () => { const { error } = await supabase.auth.signOut(); if (error) setError(error.message); else router.push('/login'); }}>Esci</button></div></header>
    {error && <p role="alert" className="mb-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {games.length > 0 && <section className="mb-10 rounded-2xl bg-purple-50 p-6"><h2 className="mb-4 text-xl font-bold">Partite aperte</h2><div className="space-y-3">{games.map(g => <Link key={g.id} href={`/game/${g.id}/admin`} className="flex flex-wrap justify-between gap-3 rounded-xl bg-white p-4"><span>{quizzes.find(q => q.id === g.quiz_id)?.title || 'Quiz'} · {g.game_code}</span><strong className="text-purple-700">Riprendi {g.status === 'waiting' ? 'lobby' : 'partita'} →</strong></Link>)}</div></section>}
    <div className="mb-6 flex items-center justify-between gap-4"><h1 className="text-2xl font-bold">I miei quiz</h1><Link className="action" href="/quizzes/new">+ Nuovo quiz</Link></div>
    {loading ? <p role="status">Caricamento…</p> : !quizzes.length ? <div className="rounded-3xl border border-gray-200 bg-white p-12 text-center"><h2 className="text-xl font-bold">Il primo quiz comincia da te.</h2><p className="mt-3 text-gray-500">Crea le domande, invita i giocatori e dai il via alla sfida.</p></div> : <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{quizzes.map(q => <article key={q.id} className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"><p className="mb-4 text-sm text-purple-600">{q.status === 'draft' ? 'Bozza' : q.status === 'archived' ? 'Archiviato' : 'Pubblicato'}</p><h2 className="truncate text-2xl font-bold">{q.title}</h2><p className="mb-8 mt-2 truncate text-gray-500">{q.description || 'Pronto per la prossima sfida'}</p><div className="flex gap-3"><Link className="flex-1 rounded-xl bg-gray-100 p-3 text-center font-bold" href={`/quizzes/${q.id}/edit`}>Modifica</Link><button className="action flex-1" disabled={!!launching} onClick={() => void start(q.id)}>{launching === q.id ? 'Avvio…' : 'Avvia'}</button></div></article>)}</div>}
  </main>;
}
