import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const fail = () => NextResponse.redirect(`${origin}/login?auth_error=1`);
  if (searchParams.get('error')) return fail();
  const code = searchParams.get('code');
  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail();
  }
  return NextResponse.redirect(`${origin}/`);
}