import { createClient } from '@supabase/supabase-js'

// Configuração pública do projeto Supabase.
// A chave sb_publishable_ é própria para uso no frontend.
// Nunca substituir por service_role ou sb_secret_.
const url = 'https://zlmmcczxinvdzrjshbcl.supabase.co'
const key = 'sb_publishable_T8-Zzov_cGYlxZjeK9yI4Q_eT1W7YWR'

export const hasSupabase = Boolean(url && key)
export const supabase = createClient(url, key)
