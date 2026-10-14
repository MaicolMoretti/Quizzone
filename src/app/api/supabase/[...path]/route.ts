import type { NextRequest } from 'next/server';

// Il browser usa la stessa origine dell'app. Supabase continua a verificare
// la chiave pubblica, il JWT dell'utente e tutte le policy RLS.
async function forward(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/^\/api\/supabase/, '');
  if (!/^\/(auth|rest)\/v1\//.test(path)) {
    return Response.json({ message: 'Percorso non supportato.' }, { status: 404 });
  }
  const upstream = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  upstream.pathname = path;
  upstream.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ['apikey', 'authorization', 'content-type', 'accept', 'prefer', 'range', 'range-unit', 'accept-profile', 'content-profile', 'x-client-info', 'x-supabase-api-version']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-range', 'range-unit', 'preference-applied', 'www-authenticate', 'x-supabase-api-version']) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json({ message: 'Il servizio di accesso e dati non è raggiungibile. Riprova tra poco.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE, forward as HEAD };
