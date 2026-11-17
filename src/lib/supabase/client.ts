import { createBrowserClient } from '@supabase/ssr';
import { purgeInvalidAuthCookies } from '@/lib/supabase/cookies';

export function createClient() {
  purgeInvalidAuthCookies();
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
