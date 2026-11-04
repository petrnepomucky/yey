import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase, DOC_TYPES, DOC_STATUS, PAIRING, money, dateCz, num, type Row, type FnAction } from './lib'
import { useFn, useListNav, FormModal, Confirm, Help, type Field } from './ui'

type P = { firmId: string; onLogout: () => void }
const fold = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const nul = (s?: string) => (s && s.trim() !== '' ? s.trim() : null)
const opts = (o: Record<string, string>): [string, string][] => Object.entries(o)

type Col = { h: string; cell: (r: Row) => ReactNode; cls?: string }
function Table({ cols, rows, sel, setSel, onOpen }: { cols: Col[]; rows: Row[]; sel: number; setSel: (i: number) => void; onOpen: (i: number) => void }) {
  if (!rows.length) return <p className="empty">Nic tu zatím není. Stiskněte F2 pro přidání.</p>
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead><tr>{cols.map((c) => <th key={c.h} className={c.cls}>{c.h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={i === sel ? 'sel' : ''} data-sel={i === sel ? '1' : undefined}
              onClick={() => setSel(i)} onDoubleClick={() => onOpen(i)}>
              {cols.map((c) => <td key={c.h} data-label={c.h} className={c.cls}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Search({ q, setQ, inputRef }: { q: string; setQ: (s: string) => void; inputRef: React.RefObject<HTMLInputElement> }) {
  return (
    <input ref={inputRef} className="search" placeholder="Hledat…  ( / nebo F3 )" value={q} onChange={(e) => setQ(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() }
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.blur() }
      }} />
  )
}

function useSlash(inputRef: React.RefObject<HTMLInputElement>) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !document.querySelector('[data-modal]')) {
        e.preventDefault(); inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [inputRef])
}

const dl = (name: string, data: unknown) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

// ================= DOKLADY =================
export function Documents({ firmId, onLogout }: P) {
  const [docs, setDocs] = useState<Row[]>([])
  const [contacts, setContacts] = useState<Row[]>([])
  const [jobs, setJobs] = useState<Row[]>([])
  const [files, setFiles] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<null | 'new' | 'edit' | 'del' | 'help'>(null)
  const [edit, setEdit] = useState<Row | null>(null)
  const [msg, setMsg] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  useSlash(search)

  const load = useCallback(async () => {
    const [d, c, j] = await Promise.all([
      supabase.from('doc_overview').select('*').eq('firm_id', firmId).order('issue_date', { ascending: false, nullsFirst: true }).limit(500),
      supabase.from('contacts').select('id,name').eq('firm_id', firmId).is('deleted_at', null).order('name'),
      supabase.from('jobs').select('id,number,title').eq('firm_id', firmId).is('deleted_at', null).order('number'),
    ])
    if (d.error) setMsg('Chyba: ' + d.error.message)
    setDocs(d.data ?? []); setContacts(c.data ?? []); setJobs(j.data ?? [])
  }, [firmId])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    const f = fold(q)
    return f ? docs.filter((d) => fold([d.number, d.variable_symbol, d.contact_name, d.job_number, d.order_ref, DOC_TYPES[d.doc_type]].join(' ')).includes(f)) : docs
  }, [docs, q])
  const [sel, setSel] = useNav(rows.length, () => openEdit())
  const cur: Row | undefined = rows[sel]

  useEffect(() => {
    setFiles([])
    if (!cur) return
    supabase.from('document_files').select('*').eq('document_id', cur.id).then((r) => setFiles(r.data ?? []))
  }, [cur?.id])

  async function openEdit() {
    if (!cur) return
    const { data } = await supabase.from('documents').select('*').eq('id', cur.id).single()
    setEdit(data); setModal('edit')
  }
  const rpc = async (fn: string, label: string) => {
    const { data, error } = await supabase.rpc(fn, { p_firm: firmId })
    setMsg(error ? 'Chyba: ' + error.message : `${label}: ${data}`)
    load()
  }
  const doUpload = async (file: File) => {
    if (!cur) return
    const buf = await file.arrayBuffer()
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((b) => b.toString(16).padStart(2, '0')).join('')
    const safe = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_')
    const path = `${firmId}/${new Date().getFullYear()}/${crypto.randomUUID()}-${safe}`
    const up = await supabase.storage.from('documents').upload(path, file, { contentType: file.type })
    if (up.error) return setMsg('Nahrání selhalo: ' + up.error.message)
    const ins = await supabase.from('document_files').insert({ firm_id: firmId, document_id: cur.id, storage_path: path, filename: file.name, mime: file.type, size_bytes: file.size, sha256: sha })
    if (ins.error) {
      await supabase.storage.from('documents').remove([path])
      return setMsg(ins.error.code === '23505' ? 'Tento soubor už v evidenci je.' : 'Chyba: ' + ins.error.message)
    }
    setMsg('Soubor nahrán.'); load()
    supabase.from('document_files').select('*').eq('document_id', cur.id).then((r) => setFiles(r.data ?? []))
  }
  const openFile = async (f: Row) => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(f.storage_path, 60)
    if (error) return setMsg('Chyba: ' + error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const fields: Field[] = [
    { name: 'doc_type', label: 'Typ dokladu', type: 'select', options: opts(DOC_TYPES), required: true },
    { name: 'number', label: 'Číslo dokladu' },
    { name: 'variable_symbol', label: 'Variabilní symbol' },
    { name: 'contact_id', label: 'Kontakt', type: 'select', options: contacts.map((c) => [c.id, c.name]) },
    { name: 'job_id', label: 'Zakázka', type: 'select', options: jobs.map((j) => [j.id, `${j.number} ${j.title}`]) },
    { name: 'order_ref', label: 'Číslo objednávky' },
    { name: 'issue_date', label: 'Datum vystavení', type: 'date' },
    { name: 'due_date', label: 'Splatnost', type: 'date' },
    { name: 'total_gross', label: 'Celkem s DPH (Kč)', type: 'number' },
    { name: 'status', label: 'Stav', type: 'select', options: opts(DOC_STATUS) },
    { name: 'note', label: 'Poznámka', type: 'textarea' },
  ]
  const toPayload = (v: Record<string, string>) => ({
    doc_type: v.doc_type, number: nul(v.number), variable_symbol: nul(v.variable_symbol), contact_id: nul(v.contact_id),
    job_id: nul(v.job_id), order_ref: nul(v.order_ref), issue_date: nul(v.issue_date), due_date: nul(v.due_date),
    total_gross: num(v.total_gross ?? ''), status: v.status || 'inbox', note: nul(v.note),
  })
  const del = async () => {
    if (!cur) return
    const { error } = await supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', cur.id)
    setModal(null); setMsg(error ? 'Chyba: ' + error.message : 'Doklad přesunut mimo evidenci.'); load()
  }

  const fn: FnAction[] = [
    { key: 'F1', label: 'Nápověda', run: () => setModal('help') },
    { key: 'F2', label: 'Nový', run: () => setModal('new') },
    { key: 'F3', label: 'Hledat', run: () => search.current?.focus() },
    { key: 'F4', label: 'Upravit', run: openEdit },
    { key: 'F5', label: 'Párovat', run: () => rpc('suggest_document_matches', 'Nových návrhů párování') },
    { key: 'F6', label: 'Platby', run: () => rpc('pair_payments', 'Spárovaných plateb') },
    { key: 'F7', label: 'Příloha', run: () => cur && upload.current?.click() },
    { key: 'F8', label: 'Smazat', run: () => cur && setModal('del') },
    { key: 'F9', label: 'Obnovit', run: load },
    { key: 'F10', label: 'Odhlásit', run: onLogout },
  ]
  useFn(fn)

  return (
    <section className="screen">
      <div className="toolbar"><Search q={q} setQ={setQ} inputRef={search} /><span className="count">{rows.length} dokladů</span></div>
      <Table rows={rows} sel={sel} setSel={setSel} onOpen={() => openEdit()} cols={[
        { h: 'Typ', cell: (r) => DOC_TYPES[r.doc_type] },
        { h: 'Číslo', cell: (r) => r.number },
        { h: 'Kontakt', cell: (r) => r.contact_name },
        { h: 'Zakázka', cell: (r) => r.job_number },
        { h: 'Vystaveno', cell: (r) => dateCz(r.issue_date) },
        { h: 'Splatnost', cell: (r) => <span className={r.overdue ? 'bad' : ''}>{dateCz(r.due_date)}{r.overdue ? ' !' : ''}</span> },
        { h: 'Částka', cls: 'r', cell: (r) => money(r.total_gross, r.currency) },
        { h: 'Stav', cell: (r) => DOC_STATUS[r.status] },
        { h: 'Párování', cell: (r) => PAIRING[r.pair_state ?? r.pairing_state] ?? '' },
        { h: '📎', cls: 'r', cell: (r) => (r.file_count ? r.file_count : '') },
      ]} />
      {cur && files.length > 0 && (
        <div className="detail">Přílohy: {files.map((f) => <button key={f.id} className="link" onClick={() => openFile(f)}>{f.filename}</button>)}</div>
      )}
      {msg && <div className="status" onClick={() => setMsg('')}>{msg}</div>}
      <input ref={upload} type="file" hidden accept="application/pdf,image/*,.xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = '' }} />
      {modal === 'new' && <FormModal title="Nový doklad" fields={fields} initial={{ doc_type: 'received_invoice', status: 'inbox' }} onClose={() => setModal(null)}
        onSubmit={async (v) => { const { error } = await supabase.from('documents').insert({ firm_id: firmId, ...toPayload(v) }); if (error) return error.message; setModal(null); load() }} />}
      {modal === 'edit' && edit && <FormModal title="Upravit doklad" fields={fields} onClose={() => setModal(null)}
        initial={Object.fromEntries(Object.entries(edit).map(([k, v]) => [k, v == null ? '' : String(v)]))}
        onSubmit={async (v) => { const { error } = await supabase.from('documents').update(toPayload(v)).eq('id', edit.id); if (error) return error.message; setModal(null); load() }} />}
      {modal === 'del' && <Confirm text={`Smazat doklad ${cur?.number ?? ''}? (zůstane v archivu databáze)`} onYes={del} onNo={() => setModal(null)} />}
      {modal === 'help' && <Help onClose={() => setModal(null)} extra={[['F2 / F4 / F8', 'nový / upravit / smazat doklad'], ['F5', 'navrhnout párování dodacích listů a faktur'], ['F6', 'spárovat platby podle VS'], ['F7', 'nahrát přílohu (PDF, foto)']]} />}
    </section>
  )
}

function useNav(count: number, onEnter: () => void) {
  const ref = useRef(onEnter); ref.current = onEnter
  return useListNav(count, () => ref.current())
}

// ================= KONTAKTY =================
export function Contacts({ firmId, onLogout }: P) {
  const [rows0, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<null | 'new' | 'edit' | 'del' | 'anon' | 'help'>(null)
  const [msg, setMsg] = useState('')
  const search = useRef<HTMLInputElement>(null)
  useSlash(search)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('contacts').select('*').eq('firm_id', firmId).is('deleted_at', null).order('name')
    if (error) setMsg('Chyba: ' + error.message)
    setRows(data ?? [])
  }, [firmId])
  useEffect(() => { load() }, [load])
  const rows = useMemo(() => { const f = fold(q); return f ? rows0.filter((r) => fold([r.name, r.ico, r.email, r.phone].join(' ')).includes(f)) : rows0 }, [rows0, q])
  const [sel, setSel] = useNav(rows.length, () => rows[sel] && setModal('edit'))
  const cur: Row | undefined = rows[sel]
  const kinds: [string, string][] = [['customer', 'Zákazník'], ['supplier', 'Dodavatel'], ['both', 'Zákazník i dodavatel']]
  const fields: Field[] = [
    { name: 'name', label: 'Název / jméno', required: true }, { name: 'kind', label: 'Druh', type: 'select', options: kinds },
    { name: 'ico', label: 'IČO' }, { name: 'dic', label: 'DIČ' }, { name: 'email', label: 'E-mail' }, { name: 'phone', label: 'Telefon' },
    { name: 'is_natural_person', label: 'Fyzická osoba (GDPR)', type: 'select', options: [['true', 'Ano'], ['false', 'Ne']] },
    { name: 'note', label: 'Poznámka', type: 'textarea' },
  ]
  const payload = (v: Record<string, string>) => ({ name: v.name.trim(), kind: v.kind || 'customer', ico: nul(v.ico), dic: nul(v.dic), email: nul(v.email), phone: nul(v.phone), is_natural_person: v.is_natural_person === 'true', note: nul(v.note) })
  const act = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => { const { error } = await p; setModal(null); setMsg(error ? 'Chyba: ' + error.message : ok); load() }
  useFn([
    { key: 'F1', label: 'Nápověda', run: () => setModal('help') },
    { key: 'F2', label: 'Nový', run: () => setModal('new') },
    { key: 'F3', label: 'Hledat', run: () => search.current?.focus() },
    { key: 'F4', label: 'Upravit', run: () => cur && setModal('edit') },
    { key: 'F6', label: 'Export dat', run: async () => { if (!cur) return; const { data, error } = await supabase.rpc('export_contact_data', { p_contact: cur.id }); error ? setMsg('Chyba: ' + error.message) : dl(`export-${cur.id}.json`, data) } },
    { key: 'F7', label: 'Anonymizovat', run: () => cur && setModal('anon') },
    { key: 'F8', label: 'Smazat', run: () => cur && setModal('del') },
    { key: 'F9', label: 'Obnovit', run: load },
    { key: 'F10', label: 'Odhlásit', run: onLogout },
  ])
  return (
    <section className="screen">
      <div className="toolbar"><Search q={q} setQ={setQ} inputRef={search} /><span className="count">{rows.length} kontaktů</span></div>
      <Table rows={rows} sel={sel} setSel={setSel} onOpen={() => setModal('edit')} cols={[
        { h: 'Název', cell: (r) => r.name }, { h: 'Druh', cell: (r) => kinds.find((k) => k[0] === r.kind)?.[1] },
        { h: 'IČO', cell: (r) => r.ico }, { h: 'E-mail', cell: (r) => r.email }, { h: 'Telefon', cell: (r) => r.phone },
        { h: 'FO', cell: (r) => (r.is_natural_person ? 'ano' : '') },
      ]} />
      {msg && <div className="status" onClick={() => setMsg('')}>{msg}</div>}
      {modal === 'new' && <FormModal title="Nový kontakt" fields={fields} initial={{ kind: 'customer', is_natural_person: 'false' }} onClose={() => setModal(null)}
        onSubmit={async (v) => { const { error } = await supabase.from('contacts').insert({ firm_id: firmId, ...payload(v) }); if (error) return error.message; setModal(null); load() }} />}
      {modal === 'edit' && cur && <FormModal title="Upravit kontakt" fields={fields} onClose={() => setModal(null)}
        initial={Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v == null ? '' : String(v)]))}
        onSubmit={async (v) => { const { error } = await supabase.from('contacts').update(payload(v)).eq('id', cur.id); if (error) return error.message; setModal(null); load() }} />}
      {modal === 'del' && cur && <Confirm text={`Smazat kontakt ${cur.name}?`} onNo={() => setModal(null)}
        onYes={() => act(supabase.from('contacts').update({ deleted_at: new Date().toISOString() }).eq('id', cur.id), 'Kontakt smazán.')} />}
      {modal === 'anon' && cur && <Confirm text={`Anonymizovat ${cur.name}? Osobní údaje se nenávratně smažou, účetní doklady zůstanou.`} onNo={() => setModal(null)}
        onYes={() => act(supabase.rpc('anonymize_contact', { p_contact: cur.id }), 'Kontakt anonymizován.')} />}
      {modal === 'help' && <Help onClose={() => setModal(null)} extra={[['F6', 'export dat o osobě (GDPR – přístup / přenositelnost)'], ['F7', 'anonymizace osobních údajů (GDPR – výmaz)']]} />}
    </section>
  )
}

// ================= ZAKÁZKY =================
export function Jobs({ firmId, onLogout }: P) {
  const [rows0, setRows] = useState<Row[]>([])
  const [contacts, setContacts] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<null | 'new' | 'edit' | 'del' | 'help'>(null)
  const [msg, setMsg] = useState('')
  const search = useRef<HTMLInputElement>(null)
  useSlash(search)
  const load = useCallback(async () => {
    const [j, c] = await Promise.all([
      supabase.from('jobs').select('*').eq('firm_id', firmId).is('deleted_at', null).order('number', { ascending: false }),
      supabase.from('contacts').select('id,name').eq('firm_id', firmId).is('deleted_at', null).order('name'),
    ])
    if (j.error) setMsg('Chyba: ' + j.error.message)
    setRows(j.data ?? []); setContacts(c.data ?? [])
  }, [firmId])
  useEffect(() => { load() }, [load])
  const cname = (id: string) => contacts.find((c) => c.id === id)?.name ?? ''
  const rows = useMemo(() => { const f = fold(q); return f ? rows0.filter((r) => fold([r.number, r.title, cname(r.contact_id)].join(' ')).includes(f)) : rows0 }, [rows0, q, contacts])
  const [sel, setSel] = useNav(rows.length, () => rows[sel] && setModal('edit'))
  const cur: Row | undefined = rows[sel]
  const st: [string, string][] = [['open', 'Otevřená'], ['in_progress', 'Rozpracovaná'], ['done', 'Hotová'], ['invoiced', 'Vyfakturovaná'], ['closed', 'Uzavřená']]
  const fields: Field[] = [
    { name: 'number', label: 'Číslo zakázky', required: true }, { name: 'title', label: 'Název', required: true },
    { name: 'contact_id', label: 'Zákazník', type: 'select', options: contacts.map((c) => [c.id, c.name]) },
    { name: 'status', label: 'Stav', type: 'select', options: st },
    { name: 'starts_on', label: 'Začátek', type: 'date' }, { name: 'ends_on', label: 'Konec', type: 'date' },
    { name: 'budget', label: 'Rozpočet (Kč)', type: 'number' }, { name: 'note', label: 'Poznámka', type: 'textarea' },
  ]
  const payload = (v: Record<string, string>) => ({ number: v.number.trim(), title: v.title.trim(), contact_id: nul(v.contact_id), status: v.status || 'open', starts_on: nul(v.starts_on), ends_on: nul(v.ends_on), budget: num(v.budget ?? ''), note: nul(v.note) })
  useFn([
    { key: 'F1', label: 'Nápověda', run: () => setModal('help') },
    { key: 'F2', label: 'Nová', run: () => setModal('new') },
    { key: 'F3', label: 'Hledat', run: () => search.current?.focus() },
    { key: 'F4', label: 'Upravit', run: () => cur && setModal('edit') },
    { key: 'F8', label: 'Smazat', run: () => cur && setModal('del') },
    { key: 'F9', label: 'Obnovit', run: load },
    { key: 'F10', label: 'Odhlásit', run: onLogout },
  ])
  return (
    <section className="screen">
      <div className="toolbar"><Search q={q} setQ={setQ} inputRef={search} /><span className="count">{rows.length} zakázek</span></div>
      <Table rows={rows} sel={sel} setSel={setSel} onOpen={() => setModal('edit')} cols={[
        { h: 'Číslo', cell: (r) => r.number }, { h: 'Název', cell: (r) => r.title }, { h: 'Zákazník', cell: (r) => cname(r.contact_id) },
        { h: 'Stav', cell: (r) => st.find((s) => s[0] === r.status)?.[1] }, { h: 'Začátek', cell: (r) => dateCz(r.starts_on) },
        { h: 'Konec', cell: (r) => dateCz(r.ends_on) }, { h: 'Rozpočet', cls: 'r', cell: (r) => money(r.budget) },
      ]} />
      {msg && <div className="status" onClick={() => setMsg('')}>{msg}</div>}
      {modal === 'new' && <FormModal title="Nová zakázka" fields={fields} initial={{ status: 'open' }} onClose={() => setModal(null)}
        onSubmit={async (v) => { const { error } = await supabase.from('jobs').insert({ firm_id: firmId, ...payload(v) }); if (error) return error.message; setModal(null); load() }} />}
      {modal === 'edit' && cur && <FormModal title="Upravit zakázku" fields={fields} onClose={() => setModal(null)}
        initial={Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v == null ? '' : String(v)]))}
        onSubmit={async (v) => { const { error } = await supabase.from('jobs').update(payload(v)).eq('id', cur.id); if (error) return error.message; setModal(null); load() }} />}
      {modal === 'del' && cur && <Confirm text={`Smazat zakázku ${cur.number}?`} onNo={() => setModal(null)}
        onYes={async () => { const { error } = await supabase.from('jobs').update({ deleted_at: new Date().toISOString() }).eq('id', cur.id); setModal(null); setMsg(error ? 'Chyba: ' + error.message : 'Zakázka smazána.'); load() }} />}
      {modal === 'help' && <Help onClose={() => setModal(null)} extra={[['F2 / F4 / F8', 'nová / upravit / smazat zakázku']]} />}
    </section>
  )
}

// ================= PÁROVÁNÍ =================
export function Matching({ firmId, onLogout }: P) {
  const [links, setLinks] = useState<Row[]>([])
  const [docs, setDocs] = useState<Record<string, Row>>({})
  const [msg, setMsg] = useState('')
  const [modal, setModal] = useState<null | 'help'>(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('document_links').select('*').eq('firm_id', firmId).eq('status', 'suggested').order('confidence', { ascending: false })
    if (error) setMsg('Chyba: ' + error.message)
    const l = data ?? []
    setLinks(l)
    const ids = [...new Set(l.flatMap((x) => [x.from_document_id, x.to_document_id]))]
    if (ids.length) {
      const d = await supabase.from('doc_overview').select('id,doc_type,number,contact_name,total_gross,currency,issue_date').in('id', ids)
      setDocs(Object.fromEntries((d.data ?? []).map((x) => [x.id, x])))
    }
  }, [firmId])
  useEffect(() => { load() }, [load])
  const decide = async (i: number, status: 'confirmed' | 'rejected') => {
    const l = links[i]; if (!l) return
    const { error } = await supabase.from('document_links').update({ status }).eq('id', l.id)
    setMsg(error ? 'Chyba: ' + error.message : status === 'confirmed' ? 'Spárováno.' : 'Návrh odmítnut.')
    load()
  }
  const [sel, setSel] = useNav(links.length, () => decide(sel, 'confirmed'))
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || document.querySelector('[data-modal]')) return
      if (e.key === 'y' || e.key === 'Y') decide(sel, 'confirmed')
      if (e.key === 'n' || e.key === 'N' || e.key === 'Delete') decide(sel, 'rejected')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
  const run = async () => {
    const { data, error } = await supabase.rpc('suggest_document_matches', { p_firm: firmId })
    setMsg(error ? 'Chyba: ' + error.message : `Nových návrhů: ${data}`); load()
  }
  useFn([
    { key: 'F1', label: 'Nápověda', run: () => setModal('help') },
    { key: 'F2', label: 'Potvrdit', run: () => decide(sel, 'confirmed') },
    { key: 'F3', label: 'Odmítnout', run: () => decide(sel, 'rejected') },
    { key: 'F5', label: 'Hledat shody', run },
    { key: 'F9', label: 'Obnovit', run: load },
    { key: 'F10', label: 'Odhlásit', run: onLogout },
  ])
  const d = (id: string) => docs[id]
  const label = (x?: Row) => (x ? `${DOC_TYPES[x.doc_type]} ${x.number ?? '—'} · ${x.contact_name ?? '—'} · ${money(x.total_gross, x.currency ?? 'CZK')}` : '…')
  return (
    <section className="screen">
      <div className="toolbar"><span className="count">{links.length} návrhů ke schválení</span></div>
      <Table rows={links} sel={sel} setSel={setSel} onOpen={(i) => decide(i, 'confirmed')} cols={[
        { h: 'Shoda', cls: 'r', cell: (r) => Math.round(Number(r.confidence) * 100) + ' %' },
        { h: 'Dodací list', cell: (r) => label(d(r.from_document_id)) },
        { h: 'Faktura', cell: (r) => label(d(r.to_document_id)) },
        { h: 'Důvody', cell: (r) => (r.reasons as string[]).join(', ') },
      ]} />
      {msg && <div className="status" onClick={() => setMsg('')}>{msg}</div>}
      {modal === 'help' && <Help onClose={() => setModal(null)} extra={[['Enter / Y / F2', 'potvrdit spárování'], ['N / Del / F3', 'odmítnout návrh'], ['F5', 'vyhledat nové shody']]} />}
    </section>
  )
}
