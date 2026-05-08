import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Lazy client that only throws when actually used, not at import time
let _client: SupabaseClient | null = null

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_client) {
      if (!SUPABASE_URL) {
        throw new Error('Supabase URL not configured. Set VITE_SUPABASE_URL in your environment.')
      }
      _client = createClient(SUPABASE_URL, SUPABASE_KEY)
    }
    // @ts-ignore
    return _client[prop]
  },
})
