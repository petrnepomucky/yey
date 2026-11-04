import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useFnActions, getFnActions, setFnActions, type FnAction } from './lib'

// Nastaví funkční klávesy aktuální obrazovky
export function useFn(actions: FnAction[]) {
  useEffect(() => {
    setFnActions(actions)
  })
  useEffect(() => () => setFnActions([]), [])
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

// Globální poslech F1–F12
export function useGlobalFnKeys() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!/^F([1-9]|1[0-2])$/.test(e.key)) return
      e.preventDefault()
      const a = getFnActions().find((x) => x.key === e.key)
      const modalOpen = document.querySelector('[data-modal]')
      if (a && (!modalOpen || a.key === 'F1')) a.run()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}

export function FnBar() {
  const actions = useFnActions()
  return (
    <nav className="fnbar" aria-label="Funkční klávesy">
      {Array.from({ length: 10 }, (_, i) => {
        const key = `F${i + 1}`
        const a = actions.find((x) => x.key === key)
        return (
          <button key={key} className={'fnkey' + (a ? '' : ' off')} disabled={!a} onClick={() => a?.run()}>
            <span className="fnnum">{i + 1}</span>
            <span className="fnlab">{a?.label ?? ''}</span>
          </button>
        )
      })}
    </nav>
  )
}

// Pohyb v seznamu klávesnicí
export function useListNav(count: number, onEnter: (i: number) => void, active = true) {
  const [i, setI] = useState(0)
  const ref = useRef({ count, onEnter, i })
  ref.current = { count, onEnter, i }
  useEffect(() => {
    if (i >= count) setI(Math.max(0, count - 1))
  }, [count, i])
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => {
      if (typing(e.target) || document.querySelector('[data-modal]') || e.ctrlKey || e.altKey || e.metaKey) return
      const { count, onEnter, i } = ref.current
      const go = (n: number) => { e.preventDefault(); setI(Math.min(Math.max(0, n), count - 1)) }
      if (e.key === 'ArrowDown' || e.key === 'j') go(i + 1)
      else if (e.key === 'ArrowUp' || e.key === 'k') go(i - 1)
      else if (e.key === 'PageDown') go(i + 10)
      else if (e.key === 'PageUp') go(i - 10)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(count - 1)
      else if (e.key === 'Enter' && count > 0) { e.preventDefault(); onEnter(i) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [active])
  useEffect(() => {
    document.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [i])
  return [i, setI] as const
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" data-modal onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export type Field = {
  name: string; label: string
  type?: 'text' | 'date' | 'number' | 'select' | 'textarea'
  options?: [string, string][]
  required?: boolean
}

export function FormModal(p: {
  title: string; fields: Field[]; initial?: Record<string, string>
  onSubmit: (v: Record<string, string>) => Promise<string | void>; onClose: () => void
}) {
  const [v, setV] = useState<Record<string, string>>(p.initial ?? {})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('input,select,textarea')?.focus()
  }, [])
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setBusy(true); setErr('')
    const r = await p.onSubmit(v)
    setBusy(false)
    if (r) setErr(r)
  }
  return (
    <Modal title={p.title} onClose={p.onClose}>
      <form ref={form} onSubmit={submit} onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && submit()}>
        {p.fields.map((f) => (
          <label key={f.name} className="field">
            <span>{f.label}{f.required ? ' *' : ''}</span>
            {f.type === 'select' ? (
              <select value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
                <option value="">—</option>
                {f.options?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea rows={3} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
            ) : (
              <input type={f.type === 'number' ? 'text' : f.type ?? 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined}
                required={f.required} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
            )}
          </label>
        ))}
        {err && <p className="err">{err}</p>}
        <div className="dlgbtns">
          <button type="submit" disabled={busy}>{busy ? 'Ukládám…' : 'Uložit (Enter)'}</button>
          <button type="button" onClick={p.onClose}>Zrušit (Esc)</button>
        </div>
      </form>
    </Modal>
  )
}

export function Confirm(p: { text: string; onYes: () => void; onNo: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') { e.preventDefault(); p.onYes() }
      if (e.key === 'n' || e.key === 'N') p.onNo()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [p])
  return (
    <Modal title="Potvrzení" onClose={p.onNo}>
      <p>{p.text}</p>
      <div className="dlgbtns">
        <button onClick={p.onYes}>Ano (Y / Enter)</button>
        <button onClick={p.onNo}>Ne (N / Esc)</button>
      </div>
    </Modal>
  )
}

export function Help({ onClose, extra }: { onClose: () => void; extra: [string, string][] }) {
  const rows: [string, string][] = [
    ['↑ ↓ / J K', 'pohyb v seznamu'], ['PgUp PgDn Home End', 'rychlý pohyb'], ['Enter', 'otevřít / potvrdit'],
    ['/ nebo F3', 'hledat'], ['Esc', 'zavřít / zrušit'], ['Alt+1…4', 'přepnout modul'], ['Tab', 'další pole ve formuláři'],
    ['Ctrl+Enter', 'uložit formulář'], ...extra,
  ]
  return (
    <Modal title="Nápověda" onClose={onClose}>
      <table className="helptab"><tbody>
        {rows.map(([k, d]) => <tr key={k}><th>{k}</th><td>{d}</td></tr>)}
      </tbody></table>
      <p className="muted">Dole je vždy lišta funkčních kláves F1–F10 – platí pro aktuální modul. Dá se i klikat nebo klepat.</p>
    </Modal>
  )
}
