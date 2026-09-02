import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Cheap enough to call from render: it reads two build-time strings and does
 * not touch the client library at all.
 */
export function supabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

let client: Promise<SupabaseClient> | null = null;

/**
 * The Supabase client, loaded on first use.
 *
 * It is a large dependency for a feature that is off by default and, for most
 * people, never turned on - importing it at the top level put around 130 kB of
 * account plumbing into the first paint of an app whose entire selling point is
 * that it works offline with no account. A dynamic import keeps it out of the
 * initial bundle and off the critical path.
 *
 * The promise is cached rather than the client, so two concurrent calls share
 * one import and one instance.
 */
export function getSupabase(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
      auth: { persistSession: true, autoRefreshToken: true },
    }),
  );
  return client;
}
