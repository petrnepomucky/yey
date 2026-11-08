import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib'
import { FnBar, useFn, useGlobalFnKeys } from './ui'
import { Documents, Contacts, Jobs, Matching } from './screens'

const TABS = [
  ['docs', 'Doklady'], ['contacts', 'Kontakty'], ['jobs', 'Zakázky'], ['match', 'Párování'],
] as const

function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (mode: 'in' | 'up') => {
    setBusy(true); setMsg('')
    const r = mode === 'in' ? await supabase.auth.signInWithPassword({ email, password: pw }) : await supabase.auth.signUp({ email, password: pw })
    setBusy(false)
    if (r.error) setMsg(r.error.message)
    else if (mode === 'up' && !r.data.session) setMsg('Registrace hotova – potvrďte e-mail a přihlaste se.')
  }
  useFn([])
  return (
    <main className="login">
      <h1>Kancelář řemeslníků online</h1>
      <form onSubmit={(e) => { e.preventDefault(); go('in') }}>
        <label className="field"><span>E-mail</span><input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Heslo</span><input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {msg && <p className="err">{msg}</p>}
        <div className="dlgbtns">
          <button type="submit" disabled={busy}>Přihlásit (Enter)</button>
          <button type="button" disabled={busy} onClick={() => go('up')}>Registrovat</button>
        </div>
      </form>
    </main>
  )
}

function FirmSetup({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const [name, setName] = useState('')
  const [ico, setIco] = useState('')
  const [msg, setMsg] = useState('')
  useFn([{ key: 'F10', label: 'Odhlásit', run: onLogout }])
  return (
    <main className="login">
      <h1>Založení kanceláře</h1>
      <form onSubmit={async (e) => {
        e.preventDefault()
        const { error } = await supabase.from('firms').insert({ name: name.trim(), ico: ico.trim() || null })
        if (error) setMsg(error.message); else onDone()
      }}>
        <label className="field"><span>Název firmy</span><input autoFocus required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>IČO</span><input value={ico} onChange={(e) => setIco(e.target.value)} /></label>
        {msg && <p className="err">{msg}</p>}
        <div className="dlgbtns"><button type="submit">Založit (Enter)</button></div>
      </form>
    </main>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [firm, setFirm] = useState<{ id: string; name: string } | null | undefined>(undefined)
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('docs')
  useGlobalFnKeys()

  useEffect(() => {
    supabase.auth.getSession().then((r) => setSession(r.data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const loadFirm = async () => {
    const { data } = await supabase.from('firm_members').select('firm_id, firms(name)').limit(1)
    const m: any = data?.[0]
    setFirm(m ? { id: m.firm_id, name: m.firms?.name ?? '' } : null)
  }
  useEffect(() => {
    if (session) loadFirm(); else setFirm(undefined)
  }, [session?.user.id])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const i = Number(e.code.replace('Digit', '')) - 1
      if (TABS[i]) { e.preventDefault(); setTab(TABS[i][0]) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const logout = () => supabase.auth.signOut()

  let body
  if (session === undefined || (session && firm === undefined)) body = <p className="empty">Načítám…</p>
  else if (!session) body = <Login />
  else if (!firm) body = <FirmSetup onDone={loadFirm} onLogout={logout} />
  else {
    const P = { firmId: firm.id, onLogout: logout }
    body = (
      <>
        <header className="top">
          <strong className="brand">{firm.name}</strong>
          <nav className="tabs">
            {TABS.map(([k, l], i) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                <kbd>Alt+{i + 1}</kbd> {l}
              </button>
            ))}
          </nav>
        </header>
        {tab === 'docs' && <Documents key="d" {...P} />}
        {tab === 'contacts' && <Contacts key="c" {...P} />}
        {tab === 'jobs' && <Jobs key="j" {...P} />}
        {tab === 'match' && <Matching key="m" {...P} />}
      </>
    )
  }
  return (
    <div className="app">
      <div className="body">{body}</div>
      <FnBar />
    </div>
  )
}
