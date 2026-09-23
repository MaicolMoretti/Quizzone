"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [code, setCode] = useState('');
  const router = useRouter();
  return <main className="flex min-h-dvh flex-col bg-slate-950 p-6 text-white">
    <header className="mx-auto flex w-full max-w-6xl flex-wrap gap-4 items-center justify-between"><span className="text-2xl font-black">Quizzone<span className="text-purple-400">.</span></span><Link href="/login" className="rounded-full border border-white/20 px-5 py-2">Area organizzatori ↗</Link></header>
    <section className="mx-auto my-auto grid w-full max-w-5xl gap-12 py-20 md:grid-cols-2 md:items-center">
      <div><p className="mb-5 font-semibold uppercase tracking-widest text-purple-300">Un quiz. Tutti in gioco.</p><h1 className="text-5xl font-black leading-tight sm:text-7xl">La sfida<br />comincia <span className="text-purple-400">qui.</span></h1><p className="mt-6 max-w-sm text-lg text-slate-300">Entra con il codice della partita, scegli un nickname e preparati a rispondere. Non serve un account.</p></div>
      <form className="space-y-6 rounded-3xl bg-white p-8 text-slate-900 shadow-2xl" onSubmit={e => { e.preventDefault(); router.push(`/play/${code}`); }}><h2 className="text-2xl font-bold">Partecipa al quiz</h2><label className="block">Codice partita<input className="field text-center text-3xl font-bold tracking-widest" name="gameCode" inputMode="numeric" enterKeyHint="go" pattern="[0-9]{6}" maxLength={6} required placeholder="123456" autoComplete="off" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label><button className="action w-full" disabled={code.length !== 6}>Entra in partita →</button><p className="text-center text-sm text-gray-500">Vuoi creare un quiz? <Link href="/register" className="font-bold text-purple-700">Registrati</Link></p></form>
    </section>
    <footer className="text-center text-sm text-slate-400">Dal primo quesito all’ultimo punto. Insieme, in tempo reale.</footer>
  </main>;
}
