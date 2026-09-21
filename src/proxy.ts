import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const protectedRoute = path.startsWith('/dashboard') || path.startsWith('/quizzes') || path.endsWith('/admin');
  const destination = !user && protectedRoute ? '/login' : user && (path === '/login' || path === '/register') ? '/dashboard' : null;
  if (destination) {
    const url = request.nextUrl.clone(); url.pathname = destination; url.search = '';
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}
export const config = { matcher: ['/dashboard/:path*', '/quizzes/:path*', '/game/:gameId/admin', '/login', '/register'] };
