/**
 * Destinazione del collegamento di conferma Supabase. Scambia il codice
 * monouso con una sessione salvata nei cookie e apre la dashboard; se il codice
 * manca o non è valido torna al login con un indicatore di conferma fallita.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.redirect(new URL('/login?confirmation=failed', request.url));
}
