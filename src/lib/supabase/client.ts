/**
 * Client Supabase destinato al browser, con URL e chiave pubblici.
 * La sessione dell’utente determina i permessi RLS: qui non deve mai comparire
 * la chiave service_role utilizzata dal Game Engine.
 */
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
