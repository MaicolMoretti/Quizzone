/**
 * Client Supabase destinato al browser, con URL e chiave pubblici.
 * La sessione dell’utente determina i permessi RLS: qui non deve mai comparire
 * la chiave service_role utilizzata dal Game Engine.
 */
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          const upstream = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
          if (typeof window !== 'undefined' && url.origin === upstream.origin) {
            const destination = `${window.location.origin}/api/supabase${url.pathname}${url.search}`;
            return fetch(input instanceof Request ? new Request(destination, input) : destination, init);
          }
          return fetch(input, init);
        },
      },
    }
  )
}
