"use client";

/**
 * Editor del contenuto persistito: domande, opzioni, immagini, tempi e punti.
 * Le modifiche restano locali fino al salvataggio atomico tramite save_quiz.
 * updated_at è la versione attesa: il database rifiuta il salvataggio quando
 * un’altra sessione ha modificato il quiz o esiste una partita ancora aperta.
 */


import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { DndContext, closestCenter, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/lib/supabase/client';
import { newQuestion, validateQuestions, type Question, type Quiz } from '@/lib/quiz';

// Il pulsante di trascinamento è separato da selezione e rimozione; supporta anche la tastiera.
function QuestionTab({ question, index, selected, select, remove }: { question: Question; index: number; selected: boolean; select: () => void; remove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: question.id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-2 rounded-xl border p-3 ${selected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white'}`}>
    <button {...attributes} {...listeners} aria-label={`Riordina domanda ${index + 1}`} className="cursor-grab touch-none p-2">⠿</button>
    <button onClick={select} className="min-w-0 flex-1 text-left"><strong>Domanda {index + 1}</strong><span className="block truncate text-sm text-gray-500">{question.question_text || 'Nuova domanda'}</span></button>
    <button onClick={remove} aria-label={`Elimina domanda ${index + 1}`} className="p-2 text-red-600">×</button>
  </div>;
}

export default function QuizEditorPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const [supabase] = useState(createClient);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await supabase.from('quizzes').select('*,questions(*,answers(*))').eq('id', quizId).single();
        if (error) throw error;
        if (cancelled) return;
        // Gli elementi ritirati restano nel DB per lo storico, ma non tornano nell’editor.
        const loaded: Question[] = data.questions.filter((q: Question & { retired: boolean }) => !q.retired)
          .sort((a: Question, b: Question) => (a.question_order || 0) - (b.question_order || 0))
          .map((q: Question) => ({ ...q, answers: q.answers.filter(a => !a.retired).sort((a, b) => (a.answer_order || 0) - (b.answer_order || 0)) }));
        if (!loaded.length) { loaded.push(newQuestion()); setDirty(true); }
        setQuiz(data); setQuestions(loaded); setActiveId(loaded[0].id);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Impossibile caricare il quiz.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [quizId, supabase]);

  useEffect(() => {
    // Avvisa alla chiusura/ricarica della pagina quando ci sono modifiche locali.
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function update(id: string, patch: Partial<Question>) {
    setQuestions(previous => previous.map(q => q.id === id ? { ...q, ...patch } : q)); setDirty(true);
  }
  // La selezione usa l’UUID: spostare una domanda non cambia quella in modifica.
  function reorder({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    setQuestions(previous => arrayMove(previous, previous.findIndex(q => q.id === active.id), previous.findIndex(q => q.id === over.id))); setDirty(true);
  }
  // Un’unica RPC salva quiz, domande e risposte oppure annulla tutto in caso di errore.
  async function save() {
    if (!quiz || saving) return;
    const validation = validateQuestions(questions);
    if (validation || !quiz.title.trim()) { setError(validation || 'Inserisci un titolo.'); return; }
    setSaving(true); setError('');
    try {
      const { data, error } = await supabase.rpc('save_quiz', { p_quiz_id: quizId, p_expected_updated_at: quiz.updated_at,
        p_title: quiz.title, p_description: quiz.description, p_questions: questions });
      if (error) throw new Error(error.message);
      // La versione restituita diventa la precondizione del prossimo salvataggio.
      setQuiz({ ...quiz, updated_at: data }); setDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Salvataggio non riuscito.'); }
    finally { setSaving(false); }
  }
  const active = questions.find(q => q.id === activeId);
  if (loading) return <main className="p-12" role="status">Caricamento quiz…</main>;
  if (!quiz) return <main className="p-12"><p role="alert">{error || 'Quiz non trovato.'}</p><Link href="/dashboard">Torna alla dashboard</Link></main>;
  return <main className="min-h-screen bg-gray-50">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-white p-5">
      <Link href="/dashboard" onClick={e => { if (dirty && !window.confirm('Uscire senza salvare le modifiche?')) e.preventDefault(); }}>← Dashboard</Link>
      <p role="status">{saving ? 'Salvataggio…' : dirty ? 'Modifiche non salvate' : 'Nessuna modifica da salvare'}</p>
      <button className="action" onClick={save} disabled={saving}>Salva quiz</button>
    </header>
    {error && <p role="alert" className="m-5 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    <fieldset disabled={saving} className="mx-auto max-w-7xl p-5 disabled:opacity-60">
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <label>Titolo<input className="field" maxLength={200} value={quiz.title} onChange={e => { setQuiz({ ...quiz, title: e.target.value }); setDirty(true); }} /></label>
        <label>Descrizione<input className="field" value={quiz.description || ''} onChange={e => { setQuiz({ ...quiz, description: e.target.value }); setDirty(true); }} /></label>
      </div>
      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <h2 className="font-bold">Domande ({questions.length})</h2>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
            <SortableContext items={questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
              {questions.map((q, index) => <QuestionTab key={q.id} question={q} index={index} selected={q.id === activeId} select={() => setActiveId(q.id)} remove={() => {
                const rest = questions.filter(item => item.id !== q.id); setQuestions(rest); setDirty(true);
                if (activeId === q.id) setActiveId(rest[Math.min(index, rest.length - 1)]?.id || '');
              }} />)}
            </SortableContext>
          </DndContext>
          <button className="action w-full" disabled={questions.length >= 200} onClick={() => { const q = newQuestion(); setQuestions([...questions, q]); setActiveId(q.id); setDirty(true); }}>+ Aggiungi domanda</button>
        </aside>
        {active ? <section className="space-y-6 rounded-3xl border border-gray-200 bg-white p-6">
          <label className="block font-bold">Testo della domanda<textarea className="field text-xl" maxLength={2000} value={active.question_text} onChange={e => update(active.id, { question_text: e.target.value })} /></label>
          <label className="block">URL immagine (opzionale)<input type="url" className="field" value={active.image_url || ''} placeholder="https://…" onChange={e => update(active.id, { image_url: e.target.value || null })} /></label>
          <p className="text-sm text-gray-500">Compila le opzioni e seleziona almeno una risposta corretta.</p>
          <div className="grid gap-4 sm:grid-cols-2">{active.answers.map((a, i) => <div className="rounded-xl border border-gray-200 p-4" key={a.id}>
            <label>Risposta {String.fromCharCode(65 + i)}<input className="field" maxLength={500} value={a.answer_text} onChange={e => update(active.id, { answers: active.answers.map(item => item.id === a.id ? { ...item, answer_text: e.target.value } : item) })} /></label>
            <div className="mt-3 flex justify-between gap-2"><label><input type="checkbox" checked={a.is_correct} onChange={e => update(active.id, { answers: active.answers.map(item => item.id === a.id ? { ...item, is_correct: e.target.checked } : item) })} /> Corretta</label>
            <button disabled={active.answers.length <= 2} onClick={() => update(active.id, { answers: active.answers.filter(item => item.id !== a.id) })} className="text-sm text-red-700 disabled:opacity-30">Rimuovi</button></div>
          </div>)}</div>
          <button disabled={active.answers.length >= 8} className="text-purple-700 disabled:opacity-40" onClick={() => update(active.id, { answers: [...active.answers, { id: crypto.randomUUID(), answer_text: '', is_correct: false }] })}>+ Aggiungi risposta</button>
          <div className="grid grid-cols-2 gap-4">{([
            ['preview_seconds', 'Tempo lettura (secondi)', 0, 300], ['answer_seconds', 'Tempo risposta (secondi)', 1, 600],
            ['correct_points', 'Punti risposta corretta', 0, 100000], ['wrong_points', 'Punti risposta errata', -100000, 0],
          ] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" className="field" min={min} max={max} value={Number.isNaN(active[key]) ? '' : active[key]} onChange={e => update(active.id, { [key]: e.target.valueAsNumber })} /></label>)}</div>
        </section> : <p>Aggiungi una domanda per iniziare.</p>}
      </div>
    </fieldset>
  </main>;
}
