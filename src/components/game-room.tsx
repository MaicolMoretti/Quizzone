"use client";
/* eslint-disable @next/next/no-img-element -- Dynamic quiz images are user-supplied URLs. */
import { useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useGame } from '@/lib/game/use-game';
import type { GameRole, Phase } from '@/lib/game/types';

const labels: Record<Phase, string> = { LOBBY: 'Aspettiamo i giocatori', QUESTION_PREVIEW: 'Leggi la domanda', QUESTION_ACTIVE: 'Scegli la tua risposta', QUESTION_LOCKED: 'Tempo scaduto · risposte chiuse', ANSWER_REVEAL: 'La risposta corretta', LEADERBOARD: 'Classifica', NEXT_QUESTION: 'Preparati alla prossima domanda', FINAL_RESULTS: 'Il podio finale', ENDED: 'Partita conclusa' };
const nextLabels: Partial<Record<Phase, string>> = { QUESTION_PREVIEW: 'Mostra le risposte', QUESTION_ACTIVE: 'Chiudi le risposte', QUESTION_LOCKED: 'Rivela la soluzione', ANSWER_REVEAL: 'Mostra la classifica', LEADERBOARD: 'Prosegui', FINAL_RESULTS: 'Concludi e archivia' };
const colors = ['bg-rose-600', 'bg-blue-600', 'bg-amber-600', 'bg-emerald-600'];

export default function GameRoom({ role, identifier }: { role: GameRole; identifier: string }) {
  const game = useGame(role, identifier);
  const [nickname, setNickname] = useState('');
  const [copied, setCopied] = useState(false);
  const { state, busy, connected, joined } = game;
  const isPlayer = role === 'player';
  const isAdmin = role === 'admin';
  const isFinal = state && ['FINAL_RESULTS', 'ENDED'].includes(state.status);
  const ranking = state && ['LEADERBOARD', 'FINAL_RESULTS', 'ENDED'].includes(state.status);
  const revealed = state?.question?.answers?.some(a => typeof a.is_correct === 'boolean');
  const selected = state?.question?.answers?.find(a => a.id === game.selectedAnswer);
  const ownRank = state?.leaderboard?.find(p => p.id === game.playerId);
  const playUrl = state && typeof window !== 'undefined' ? `${window.location.origin}/play/${state.gameCode}` : '';

  return <main className={`min-h-screen bg-slate-950 text-white ${role === 'presentation' ? 'p-8 lg:p-12' : 'p-4 sm:p-8'}`}>
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <Link href={isAdmin ? '/dashboard' : '/'} className="text-xl font-black tracking-tight">Quizzone<span className="text-purple-400">.</span></Link>
        <span role="status" className={connected && joined ? 'text-emerald-300' : 'text-amber-300'}>{connected ? joined ? 'Connesso' : 'Pronto per entrare' : 'Connessione in corso…'}</span>
        {state && <span className="rounded-full bg-white/10 px-4 py-2">Codice <strong className="tracking-widest">{state.gameCode}</strong></span>}
      </header>
      {game.error && <div role="alert" className="mb-6 rounded-xl border border-rose-400/40 bg-rose-950 p-4"><p>{game.error}</p><button onClick={game.reconnect} className="mt-2 underline">Riconnetti</button></div>}
      {isPlayer && !joined && !state && <form className="mx-auto max-w-md space-y-5 rounded-3xl bg-white p-8 text-slate-900" onSubmit={e => { e.preventDefault(); void game.join(nickname); }}>
        <h1 className="text-3xl font-bold">Entra in partita</h1><p>Codice {identifier}</p>
        <label className="block">Come ti chiami?<input className="field" autoComplete="nickname" maxLength={32} required value={nickname} onChange={e => setNickname(e.target.value)} /></label>
        <button className="action w-full" disabled={!connected || busy || !nickname.trim()}>{busy ? 'Ingresso…' : 'Partecipa'}</button>
      </form>}
      {!state && !isPlayer && <p role="status">Caricamento della partita…</p>}
      {state && <>
        <div className="mb-8 flex items-center justify-between gap-5">
          <div><p className="mb-2 text-purple-300">{state.title}{state.currentQuestionIndex >= 0 && ` · ${state.currentQuestionIndex + 1}/${state.totalQuestions}`}</p><h1 className="text-3xl font-black sm:text-5xl">{labels[state.status]}</h1></div>
          {state.deadline && <div role="timer" aria-label={`${state.timer} secondi rimanenti`} className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-purple-400 text-3xl font-black tabular-nums">{state.timer}</div>}
        </div>
        {state.status === 'LOBBY' && <div className="grid gap-8 md:grid-cols-[1fr_300px]">
          <section className="rounded-3xl bg-white/5 p-6"><h2 className="mb-5 text-2xl font-bold">{state.playersCount} partecipanti</h2>
            <div className="flex flex-wrap gap-3">{state.players.map(p => <span key={p.id} className="rounded-xl bg-white/10 px-4 py-3">{p.nickname}{!p.connected && ' · offline'}</span>)}</div>
            {isPlayer && <p className="mt-6 text-purple-200">Sei dentro! La partita inizierà quando il conduttore sarà pronto.</p>}
            {!state.playersCount && <p>Condividi il codice per far entrare i giocatori.</p>}
          </section>
          {!isPlayer && <aside className="rounded-3xl bg-white p-6 text-center text-slate-900"><QRCodeSVG value={playUrl} size={220} className="mx-auto h-auto max-w-full" title="Scansiona per entrare nella partita" /><p className="my-4 text-3xl font-black tracking-widest">{state.gameCode}</p><button className="text-purple-700 underline" onClick={async () => { try { await navigator.clipboard.writeText(playUrl); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Link copiato' : 'Copia link di invito'}</button><a href={playUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-xs">{playUrl}</a></aside>}
        </div>}
        {state.question && !ranking && state.status !== 'NEXT_QUESTION' && <section className="space-y-6">
          <h2 className="text-center text-2xl font-bold sm:text-4xl">{state.question.question_text}</h2>
          {state.question.image_url && /^https?:\/\//i.test(state.question.image_url) && <img src={state.question.image_url} alt="Immagine della domanda" className="mx-auto max-h-72 rounded-2xl object-contain" />}
          <div className="grid gap-4 sm:grid-cols-2">{state.question.answers?.map((a, i) => <button key={a.id}
            disabled={!isPlayer || !joined || !connected || busy || state.status !== 'QUESTION_ACTIVE' || !!game.selectedAnswer || state.timer === 0}
            onClick={() => void game.submit(a.id)}
            className={`min-h-28 rounded-2xl p-5 text-left text-xl font-bold transition ${colors[i % 4]} ${revealed && !a.is_correct ? 'opacity-40' : ''} ${a.id === game.selectedAnswer ? 'ring-4 ring-white ring-offset-4 ring-offset-slate-950' : ''} enabled:hover:brightness-110`}>
            <span className="mr-4 opacity-70">{String.fromCharCode(65 + i)}</span>{' '}{a.answer_text}{a.is_correct === true && <span className="ml-3">✓ Corretta</span>}
            {revealed && <span className="mt-2 block text-sm">{state.statistics?.find(s => s.answerId === a.id)?.percentage || 0}% delle risposte</span>}
          </button>)}</div>
          <p role="status" className="text-center text-purple-200">{isPlayer ? revealed ? selected ? selected.is_correct ? 'Risposta corretta!' : 'Risposta errata.' : 'Non hai risposto a questa domanda.' : game.selectedAnswer ? 'Risposta inviata. Attendi la soluzione.' : state.status === 'QUESTION_PREVIEW' ? 'Le opzioni appariranno tra poco.' : state.status === 'QUESTION_LOCKED' ? 'Attendi la soluzione.' : 'Puoi scegliere una sola risposta.' : `${state.totalAnswers} risposte ricevute su ${state.playersCount} partecipanti`}</p>
          {isPlayer && revealed && ownRank && <p className="text-center text-xl font-bold">Il tuo punteggio: {ownRank.score} · Posizione {ownRank.rank}</p>}
        </section>}
        {ranking && <section className="mx-auto max-w-3xl space-y-3">
          {isFinal && state.leaderboard?.[0] && <p className="mb-8 text-center text-3xl">🏆 {state.leaderboard.filter(p => p.rank === 1).map(p => p.nickname).join(' e ')}</p>}
          {state.leaderboard?.map(p => <div key={p.id} className={`flex items-center gap-5 rounded-2xl p-5 ${p.id === game.playerId ? 'bg-purple-600' : 'bg-white/10'}`}><span className="text-2xl font-black">{p.rank}</span><span className="flex-1 text-xl">{p.nickname}</span><strong className="text-xl">{p.score} punti</strong></div>)}
          {!state.leaderboard?.length && <p>Nessun giocatore in classifica.</p>}
          {state.status === 'ENDED' && <p className="pt-5 text-center text-purple-200">{state.endReason === 'expired' ? 'La partita è scaduta.' : 'Grazie per aver giocato!'} <Link className="underline" href={isAdmin ? '/dashboard' : '/'}>Torna {isAdmin ? 'alla dashboard' : 'alla home'}</Link></p>}
        </section>}
        {isAdmin && <section className="mt-10 space-y-5 rounded-2xl border border-white/20 p-5">
          <div className="flex flex-wrap gap-4">
            {state.status === 'LOBBY' && <button className="action" disabled={!connected || !joined || busy} onClick={() => void game.command('admin:start_game')}>Inizia il quiz</button>}
            {nextLabels[state.status] && <button className="action" disabled={!connected || !joined || busy} onClick={() => void game.command('admin:next_state')}>{nextLabels[state.status]}</button>}
            <Link className="rounded-xl bg-white/10 px-5 py-3" target="_blank" href={`/game/${state.gameId}/presentation`}>Apri proiettore ↗</Link>
            {state.status !== 'ENDED' && <button disabled={!connected || !joined || busy} className="px-5 py-3 text-rose-300 disabled:opacity-40" onClick={() => { if (window.confirm('Concludere ora la partita e archiviare i risultati?')) void game.command('admin:end_game'); }}>Termina partita</button>}
          </div>
          {state.status !== 'ENDED' && <details><summary>Gestisci partecipanti ({state.playersCount})</summary><ul className="mt-4 space-y-2">{state.players.map(p => <li key={p.id} className="flex justify-between gap-4"><span>{p.nickname} · {p.connected ? 'online' : 'offline'}</span><button disabled={!connected || !joined || busy} className="text-rose-300" onClick={() => { if (window.confirm(`Rimuovere ${p.nickname}?`)) void game.command('admin:kick_player', p.id); }}>Rimuovi</button></li>)}</ul></details>}
        </section>}
      </>}
    </div>
  </main>;
}
