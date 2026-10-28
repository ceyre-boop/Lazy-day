import Constants from 'expo-constants'
import { createClient } from '@supabase/supabase-js'

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string }

export const supabaseConfigured = Boolean(extra.supabaseUrl && extra.supabaseAnonKey)

export const supabase = createClient(extra.supabaseUrl ?? 'http://localhost', extra.supabaseAnonKey ?? 'missing', {
  auth: { persistSession: false },
})
