"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

/**
 * Pagina Creazione Nuovo Quiz.
 * Mostra un modulo semplice per impostare titolo e descrizione.
 * Al salvataggio, crea una riga nel database (stato: bozza) e reindirizza all'editor.
 */
export default function NewQuizPage() {
  // Valori controllati del form: React mantiene sempre sincronizzati gli
  // input visualizzati con lo stato della pagina.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  
  // Stato della richiesta e messaggio mostrato all'utente in caso di errore.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const router = useRouter();

  /**
   * Invia il form alla route server che crea il quiz.
   *
   * La pagina non scrive più direttamente su Supabase: il server recupera
   * l'utente dai cookie autenticati e imposta owner_id in modo affidabile.
   */
  const handleCreateQuiz = async (e: React.FormEvent) => {
    // Impedisce al browser di ricaricare la pagina e perdere lo stato del form.
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // La route server esegue autenticazione, validazione e INSERT con RLS.
      const response = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });

      // La route restituisce sempre un JSON con l'ID del quiz o con un campo
      // error descrittivo, così il frontend può mostrare il problema corretto.
      const result = await response.json();

      // Qualsiasi risposta HTTP fuori dall'intervallo di successo viene
      // trasformata in un'eccezione gestita dal blocco catch.
      if (!response.ok) {
        throw new Error(result.error || "Impossibile creare il quiz.");
      }

      // Dopo la creazione l'utente viene portato all'editor del nuovo quiz.
      router.push(`/quizzes/${result.id}/edit`);
    } catch (err) {
      // Mostra il messaggio ricevuto dal server oppure un fallback generico
      // per errori che non sono istanze di Error.
      setError(
        err instanceof Error ? err.message : "Impossibile creare il quiz."
      );
    } finally {
      // Riabilita il pulsante sia dopo un successo sia dopo un errore.
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      {/* Intestazione: consente di tornare alla dashboard senza inviare il form. */}
      <header className="max-w-3xl mx-auto mb-8 flex items-center gap-4">
        <Link 
          href="/dashboard"
          className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <h1 className="text-3xl font-extrabold text-gray-800">Crea Nuovo Quiz</h1>
      </header>

      {/* Contenitore principale del modulo di creazione. */}
      <main className="max-w-3xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/40 overflow-hidden"
        >
          <div className="p-8">
            <form onSubmit={handleCreateQuiz} className="space-y-6">
              {/* Titolo obbligatorio del quiz. */}
              <div>
                <label htmlFor="title" className="block text-sm font-bold text-gray-700 mb-2">
                  Titolo del Quiz
                </label>
                <input
                  id="title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all font-medium text-lg"
                  placeholder="Es: Quiz di Cultura Generale 2024"
                />
              </div>

              {/* Descrizione facoltativa del quiz. */}
              <div>
                <label htmlFor="description" className="block text-sm font-bold text-gray-700 mb-2">
                  Descrizione (opzionale)
                </label>
                <textarea
                  id="description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all resize-none"
                  placeholder="Aggiungi qualche dettaglio in più sul tuo quiz..."
                />
              </div>

              {/* Messaggio di errore restituito dalla route server. */}
              {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium">
                  {error}
                </div>
              )}

              {/* Il pulsante resta disabilitato durante l'invio o senza titolo. */}
              <div className="pt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={loading || !title.trim()}
                  className="flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white px-8 py-3.5 rounded-xl font-bold shadow-lg shadow-purple-200 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:hover:translate-y-0"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Crea e procedi all'editor"}
                </button>
              </div>
            </form>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
