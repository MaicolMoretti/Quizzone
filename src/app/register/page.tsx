"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * Pagina di Registrazione per l'interfaccia Admin.
 * Consente a nuovi utenti di creare un account per gestire i propri quiz.
 */
export default function RegisterPage() {
  // Stati per i campi del form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  // Stati per la UI (errori e caricamento)
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  
  const router = useRouter(); // Utility di Next.js per navigare tra le pagine
  const supabase = createClient(); // Client Supabase per chiamate alle API

  /**
   * Gestisce l'invio del form di registrazione.
   * Esegue validazione lato client (coerenza password) e poi contatta Supabase.
   */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault(); // Evita il ricaricamento predefinito della pagina
    setLoading(true);
    setError(null);

    // Validazione base: controllo che le due password coincidano
    if (password !== confirmPassword) {
      setError("Le password non coincidono.");
      setLoading(false);
      return;
    }

    // Effettua la chiamata a Supabase per creare l'account
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Se è abilitata la conferma via email, redireziona a questo URL dopo il click sul link
        emailRedirectTo: `${location.origin}/auth/callback`,
      }
    });

    if (error) {
      // In caso di errore (es: email già registrata, password debole), mostra messaggio
      setError(error.message);
      setLoading(false);
    } else {
      // La dashboard richiede una sessione; altrimenti attendiamo la conferma email.
      if (data.session) router.push("/dashboard");
      else { setMessage("Per un nuovo account, controlla la posta e lo spam: la conferma avviene tramite un link, non un codice. Se hai già un account, premi Accedi e usa la password della registrazione originale."); setLoading(false); }
    }
  };

  return (
    // Sfondo a tutto schermo con un leggero gradiente vivace
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-tr from-pink-100 via-purple-50 to-indigo-100 p-4">
      {/* Animazione di scala in ingresso fornita da framer-motion */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="max-w-md w-full bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/50"
      >
        <div className="p-8">
          {message && <p role="status" className="mb-4 rounded-xl bg-green-50 p-4 text-green-700">{message}</p>}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-600 mb-2 tracking-tight">
              Registrati
            </h1>
            <p className="text-gray-500 font-medium">Crea un account Admin per gestire i quiz.</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            {/* Campo Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-gray-700 mb-1"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-gray-50/50 border border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none transition-all"
                placeholder="admin@quizzone.it"
              />
            </div>
            
            {/* Campo Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-gray-700 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-gray-50/50 border border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            {/* Campo Conferma Password */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-semibold text-gray-700 mb-1"
              >
                Conferma Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-gray-50/50 border border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            {/* Display banner Errore animato */}
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg"
              >
                {error}
              </motion.div>
            )}

            {/* Pulsante Invia */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold rounded-xl shadow-lg shadow-pink-200 transform transition-all active:scale-[0.98] disabled:opacity-70 flex justify-center items-center"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Crea Account"}
            </button>
          </form>

          {/* Link per passare al Login */}
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500 font-medium">
              Hai già un account?{" "}
              <Link
                href="/login"
                className="text-pink-600 hover:text-pink-800 font-bold transition-colors"
              >
                Accedi
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
