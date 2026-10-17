import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Выход из аккаунта. POST, чтобы ссылка-картинка на чужом сайте не могла разлогинить пользователя. */
export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
