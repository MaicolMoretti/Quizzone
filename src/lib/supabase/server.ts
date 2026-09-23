/**
 * Client Supabase per richieste Next.js, associato ai cookie della richiesta
 * corrente. Usa la chiave pubblica insieme alla sessione dell’utente, mantenendo
 * attivi i controlli RLS anche nelle route eseguite sul server.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* I Server Component non scrivono cookie: il proxy rinnova la sessione. */ }
      },
    },
  });
}
