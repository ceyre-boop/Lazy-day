import Constants from 'expo-constants'
import { createClient } from '@supabase/supabase-js'

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string }

export const supabaseConfigured = Boolean(extra.supabaseUrl && extra.supabaseAnonKey)

export const supabase = createClient(extra.supabaseUrl ?? 'http://localhost', extra.supabaseAnonKey ?? 'missing', {
  auth: { persistSession: false },
})

/** Ask the backend to refresh events if they are stale (it refreshes at most once a day, however many people call). */
export async function triggerRefresh(): Promise<'fresh' | 'started' | 'error'> {
  if (!supabaseConfigured) return 'error'
  try {
    const res = await fetch(`${extra.supabaseUrl}/functions/v1/fetch-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: extra.supabaseAnonKey! },
      body: '{}',
    })
    const j = await res.json()
    return j.status === 'started' ? 'started' : j.status === 'fresh' ? 'fresh' : 'error'
  } catch {
    return 'error'
  }
}
