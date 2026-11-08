import { createClient } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

export type Row = Record<string, any>

export const DOC_TYPES: Record<string, string> = {
  received_invoice: 'Přijatá faktura', issued_invoice: 'Vydaná faktura', delivery_note: 'Dodací list',
  quote: 'Nabídka', order: 'Objednávka', credit_note: 'Dobropis', receipt: 'Účtenka',
  contract: 'Smlouva', other: 'Ostatní',
}
export const DOC_STATUS: Record<string, string> = {
  inbox: 'Nový', to_review: 'Ke kontrole', approved: 'Schváleno', paid: 'Zaplaceno',
  disputed: 'Sporné', archived: 'Archiv',
}
export const PAIRING: Record<string, string> = { paired: '● spárováno', suggested: '◐ návrh', unpaired: '○ nespárováno' }

export const money = (v: any, cur = 'CZK') =>
  v == null ? '' : new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: cur }).format(Number(v))
export const dateCz = (v?: string | null) => (v ? new Date(v).toLocaleDateString('cs-CZ') : '')
export const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')))

// ---- Lišta funkčních kláves (jako v MS-DOS aplikacích) ----
export type FnAction = { key: string; label: string; run: () => void }
let actions: FnAction[] = []
const listeners = new Set<() => void>()
export const setFnActions = (a: FnAction[]) => {
  actions = a
  listeners.forEach((l) => l())
}
export const getFnActions = () => actions
export const useFnActions = () =>
  useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), getFnActions)
