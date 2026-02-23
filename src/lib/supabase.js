import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://ahdcmxvsznnpmqmxxudo.supabase.co',       // replace with your actual URL
  'sb_publishable_RlYExWFK8KNB-CEKOozqeQ_Vdse1R0E'   // replace with your actual anon key
)