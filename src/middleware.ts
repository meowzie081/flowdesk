import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { sanitizeAuthCookies } from '@/lib/supabase/cookies';

const PUBLIC_PATHS = ['/login', '/auth', '/telegram'];

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function middleware(request: NextRequest) {
  if(['/api/telegram/webhook','/api/notifications/dispatch','/api/webhooks/dispatch','/api/recurrence/run'].includes(request.nextUrl.pathname)||request.nextUrl.pathname.startsWith('/api/v1/'))return NextResponse.next({request});
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => sanitizeAuthCookies(request.cookies.getAll()),
        setAll: (list: CookieToSet[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = request.nextUrl.pathname === '/' || PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    if(request.nextUrl.pathname.startsWith('/api/'))return NextResponse.json({error:'Войдите в аккаунт'},{status:401,headers:{'Cache-Control':'no-store'}});
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|manifest.webmanifest|sw.js|offline.html|icons/).*)'],
};
