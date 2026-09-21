"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * Pagina di Login per l'interfaccia Admin.
 * Permette ai creatori di quiz di accedere al proprio pannello di controllo.
 * Utilizza Supabase Auth per l'autenticazione tramite Email e Password. 
 */
export default function LoginPage() {
  // Stato per i campi del form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  // Stato per la gestione degli errori e del caricamento
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const router = useRouter(); // Router di Next.js per i redirect
  const supabase = createClient(); // Inizializzazione del client Supabase lato browser

  /**
   * Gestisce la sottomissione del form di login.
   * Contatta Supabase e, in caso di successo, reindirizza alla dashboard.
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); // Previene il refresh della pagina al submit
    setLoading(true);   // Attiva lo stato di caricamento (mostra spinner)
    setError(null);     // Resetta eventuali errori precedenti

    // Chiamata all'API di autenticazione di Supabase
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Se c'è un errore (es. credenziali errate), mostralo a schermo
      setError(error.message);
      setLoading(false);
    } else {
      // Login riuscito! Reindirizza l'utente alla dashboard privata
      router.push("/dashboard");
    }
  };

  return (
    // Contenitore principale a tutto schermo con un gradiente di sfondo moderno
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 p-4">
      {/* Animazione di entrata della card usando Framer Motion */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="max-w-md w-full bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/50"
      >
        <div className="p-8">
          {/* Intestazione della Card */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 mb-2 tracking-tight">
              Quizzone
            </h1>
            <p className="text-gray-500 font-medium">Bentornato! Accedi al pannello admin.</p>
          </div>

          {/* Form di Login */}
          <form onSubmit={handleLogin} className="space-y-5">
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
                className="w-full px-4 py-3 rounded-xl bg-gray-50/50 border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all"
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
                className="w-full px-4 py-3 rounded-xl bg-gray-50/50 border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            {/* Mostra il banner di errore se presente */}
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg"
              >
                {error}
              </motion.div>
            )}

            {/* Bottone di Submit */}
            <button
              type="submit"
              disabled={loading} // Disabilita il click mentre carica
              className="w-full py-3.5 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-purple-200 transform transition-all active:scale-[0.98] disabled:opacity-70 flex justify-center items-center"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Accedi"}
            </button>
          </form>

          {/* Link alla pagina di registrazione */}
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500 font-medium">
              Non hai un account?{" "}
              <Link
                href="/register"
                className="text-purple-600 hover:text-purple-800 font-bold transition-colors"
              >
                Registrati
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
