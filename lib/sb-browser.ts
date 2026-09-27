'use client';
import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, AUTH_COOKIE } from './config';
let client: ReturnType<typeof createBrowserClient> | null = null;
export function sb() {
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { cookieOptions: AUTH_COOKIE });
  return client;
}
