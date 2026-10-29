import { useEffect, useMemo, useRef, useState } from 'react';
import MiniSearch from 'minisearch';
import * as db from './db';
import { exportZip, importZip } from './backup';
import { Markdown } from './Markdown';
import { Modal } from './Modal';
import { clearAppCache } from './appCache';
import { linksIn, normalizePath, now, pageUrl, uid, type Draft, type Page, type Snapshot } from './model';

const dateLabel = (v?: string) => v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
const sizeLabel = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
function currentPath() { try { return location.hash.startsWith('#page/') ? decodeURIComponent(location.hash.slice(6)) : ''; } catch { return ''; } }
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
type Section = 'pages' | 'index' | 'recent' | 'drafts' | 'trash' | 'settings';

export function App() {
  const [data, setData] = useState<Snapshot>();
  const [fatal, setFatal] = useState('');
  const [locked, setLocked] = useState(false);
  const [path, setPath] = useState(currentPath);
  const [section, setSection] = useState<Section>('pages');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Draft>();
  const [preview, setPreview] = useState(true);
  const [history, setHistory] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('Saved on this device');
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [storage, setStorage] = useState('');
  const [cacheCleared, setCacheCleared] = useState(false);
  const [incoming, setIncoming] = useState<Snapshot>();
  const [help, setHelp] = useState(false);
  const [wikiName, setWikiName] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const uploads = useRef<HTMLInputElement>(null);
  const imports = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  const pending = useRef(false);
  const editorRef = useRef<Draft | undefined>(undefined);
  const [urls, setUrls] = useState(new Map<string, { url: string; name: string; type: string }>());

  useEffect(() => {
    let release: (() => void) | undefined;
    const boot = async () => {
      await db.initialize(); const state = await db.snapshot(); setData(state); setWikiName(state.settings.name);
      if (!currentPath()) { const home = state.pages.find(p => p.path === 'welcome' && !p.deleted) || state.pages.find(p => !p.deleted); if (home) { window.history.replaceState(null, '', pageUrl(home.path)); setPath(home.path); } }
    };
    if (!navigator.locks) setFatal('This browser needs Web Locks support. Open the wiki in a current Chrome, Edge, Firefox, or Safari browser.');
    else void navigator.locks.request('local-wiki-editor', { ifAvailable: true }, async lock => {
      if (!lock) { setLocked(true); return; }
      await boot(); await new Promise<void>(resolve => { release = resolve; });
    }).catch(e => setFatal(`Unable to open local storage: ${e.message}`));
    const network = () => setOnline(navigator.onLine);
    window.addEventListener('online', network); window.addEventListener('offline', network);
    const unload = (event: BeforeUnloadEvent) => { if (pending.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { release?.(); window.removeEventListener('online', network); window.removeEventListener('offline', network); window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => {
    const onHash = () => { void queue.current.then(() => { setPath(currentPath()); setSection('pages'); setEditor(undefined); editorRef.current = undefined; setHistory(false); setSidebar(false); }).catch(e => setError(`Draft not saved. Keep this tab open: ${e.message}`)); };
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const next = new Map<string, { url: string; name: string; type: string }>();
    for (const a of data?.attachments || []) next.set(a.id, { url: URL.createObjectURL(a.blob), name: a.name, type: a.type });
    setUrls(next); return () => { for (const a of next.values()) URL.revokeObjectURL(a.url); };
  }, [data?.attachments]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || !data || busy || incoming || help) return;
      const key = event.key.toLowerCase();
      const command = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
      const access = event.altKey && !event.metaKey && (!event.ctrlKey || /Mac|iPhone|iPad/.test(navigator.platform));
      const save = () => { if (editorRef.current?.title.trim() && normalizePath(editorRef.current.path)) void run(publishPage); };
      if (command && key === 's') { event.preventDefault(); save(); return; }
      if (command && key === 'k') { event.preventDefault(); document.getElementById('search')?.focus(); return; }
      if (!access) return;
      const actions: Record<string, () => void> = {
        f: () => document.getElementById('search')?.focus(),
        x: () => void run(() => switchSection('index')),
        r: () => void run(() => switchSection('recent')),
        t: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
      };
      if (section === 'pages' && !query.trim()) {
        if (editor) {
          actions.s = save;
          actions.p = () => setPreview(v => !v);
          actions.v = () => void run(async () => { await queue.current; leaveEditor(); setNotice('Draft kept. Find it under Drafts.'); });
          if (event.target === textarea.current) {
            actions.b = () => format('**', '**', 'bold text');
            actions.i = () => format('*', '*', 'italic text');
            actions.m = () => format('`', '`', 'code');
            actions.d = () => format('~~', '~~', 'text');
            actions.l = () => format('[[', ']]', 'page-path|label');
            for (let level = 1; level <= 5; level++) actions[String(level)] = () => heading(level);
            actions['-'] = () => format('1. ', '', 'List item');
            actions['.'] = () => format('- ', '', 'List item');
          }
        } else {
          if (page || !data.pages.some(p => p.path === path && p.deleted)) actions.e = () => void run(async () => { await queue.current; edit(page, path); });
          if (page) actions.o = () => setHistory(v => !v);
        }
      }
      if (actions[key]) { event.preventDefault(); actions[key](); }
    };
    window.addEventListener('keydown', shortcuts); return () => window.removeEventListener('keydown', shortcuts);
  });
  const active = useMemo(() => data?.pages.filter(p => !p.deleted) || [], [data?.pages]);
  const search = useMemo(() => {
    const index = new MiniSearch({ fields: ['title', 'path', 'source', 'tags'], storeFields: ['title', 'path'], searchOptions: { boost: { title: 3, path: 2 }, prefix: true, fuzzy: 0.2 } });
    index.addAll(active.map(p => ({ ...p, tags: p.tags.join(' ') }))); return index;
  }, [active]);
  const results = useMemo(() => query.trim() ? search.search(query).slice(0, 50) : [], [query, search]);
  const page = active.find(p => p.path === path);
  const backlinks = page ? active.filter(p => p.id !== page.id && linksIn(p.source).includes(page.path)) : [];
  const revisions = data?.revisions.filter(r => r.pageId === page?.id).sort((a, b) => b.date.localeCompare(a.date)) || [];
  const groups = useMemo(() => {
    const grouped = new Map<string, Page[]>();
    for (const p of [...active].sort((a, b) => a.path.localeCompare(b.path))) { const ns = p.path.includes(':') ? p.path.slice(0, p.path.lastIndexOf(':')) : 'Pages'; grouped.set(ns, [...(grouped.get(ns) || []), p]); }
    return grouped;
  }, [active]);
  async function refresh() { const state = await db.snapshot(); setData(state); return state; }
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  function leaveEditor() { setEditor(undefined); editorRef.current = undefined; }
  function go(target: string) { setQuery(''); setSection('pages'); setHistory(false); setSidebar(false); if (currentPath() === target) { setPath(target); leaveEditor(); } else location.hash = pageUrl(target).slice(1); }
  function updateDraft(next: Draft) {
    next = { ...next, updated: now() }; setEditor(next); editorRef.current = next;
    const token = ++sequence.current; pending.current = true; setSaveState('Saving draft…');
    setData(old => old && ({ ...old, drafts: [...old.drafts.filter(d => d.id !== next.id), next] }));
    queue.current = queue.current.catch(() => {}).then(() => db.saveDraft(next));
    void queue.current.then(() => { if (token === sequence.current) { pending.current = false; setSaveState('Draft saved on this device'); } }).catch(e => { setSaveState('Draft could not be saved'); setError(`Storage error: ${e.message}. Keep this tab open and export a backup.`); });
  }
  function edit(p?: Page, target?: string) {
    const existing = p && data?.drafts.find(d => d.id === p.id);
    const draft = existing || { id: p?.id || uid(), title: p?.title || '', path: p?.path || target || '', source: p?.source || '', tags: p?.tags || [], updated: now() };
    setSection('pages'); setQuery(''); setHistory(false); setSidebar(false); updateDraft(draft);
  }
  async function switchSection(next: Section) { await queue.current; leaveEditor(); setQuery(''); setSection(next); setSidebar(false); }
  async function publishPage() { if (!editor) return; await queue.current; const result = await db.publish(editor); await refresh(); leaveEditor(); go(result.path); setSaveState('Saved on this device'); setNotice('Page published. Previous versions are in History.'); }
  async function exportBackup() {
    await queue.current.catch(() => {}); const state = await db.snapshot(); const date = now();
    if (editorRef.current) state.drafts = [...state.drafts.filter(d => d.id !== editorRef.current!.id), editorRef.current];
    const blob = await exportZip({ ...state, settings: { ...state.settings, lastExport: date } });
    download(blob, `${normalizePath(state.settings.name) || 'wiki'}-${date.slice(0, 10)}.zip`);
    await db.saveSettings({ ...state.settings, lastExport: date }); await refresh(); setNotice('ZIP download started. Keep the file in a safe place.');
  }
  function insert(value: string) {
    const latest = editorRef.current;
    if (!latest) return; const area = textarea.current; const start = area?.selectionStart ?? latest.source.length, end = area?.selectionEnd ?? start;
    updateDraft({ ...latest, source: latest.source.slice(0, start) + value + latest.source.slice(end) });
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + value.length, start + value.length); });
  }
  function format(open: string, close: string, fallback: string) {
    const draft = editorRef.current, area = textarea.current;
    if (!draft || !area) return;
    const start = area.selectionStart, end = area.selectionEnd;
    const selected = draft.source.slice(start, end) || fallback;
    updateDraft({ ...draft, source: draft.source.slice(0, start) + open + selected + close + draft.source.slice(end) });
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start + open.length, start + open.length + selected.length); });
  }
  function heading(level: number) {
    const draft = editorRef.current, area = textarea.current;
    if (!draft || !area) return;
    const start = draft.source.lastIndexOf('\n', area.selectionStart - 1) + 1;
    const nextLine = draft.source.indexOf('\n', area.selectionEnd);
    const end = nextLine < 0 ? draft.source.length : nextLine;
    const text = draft.source.slice(start, end).replace(/^#{1,6}\s+/, '') || 'Heading';
    const prefix = '#'.repeat(level) + ' ';
    updateDraft({ ...draft, source: draft.source.slice(0, start) + prefix + text + draft.source.slice(end) });
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start + prefix.length, start + prefix.length + text.length); });
  }

  if (locked || fatal) return <div className="startup"><div className="brand-icon">W</div><h1>{locked ? 'Your wiki is open in another tab' : 'Local storage unavailable'}</h1><p>{locked ? 'Close the other wiki tab, then reopen here. One editing tab keeps your changes consistent.' : fatal}</p><button onClick={() => location.reload()}>Try again</button></div>;
  if (!data) return <div className="startup"><div className="brand-icon">W</div><p>Opening your wiki…</p></div>;
  return <div className="app" onClick={event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#page/"]');
    if (!anchor) return;
    event.preventDefault();
    const target = decodeURIComponent(anchor.getAttribute('href')!.slice(6));
    void run(async () => { await queue.current; go(target); });
  }}>
    <aside inert={!!incoming || help} className={`sidebar ${sidebar ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); void run(async () => { await queue.current; go(active.find(p => p.path === 'welcome')?.path || active[0]?.path || ''); }); }}><span className="brand-icon">W</span><span>{data.settings.name}<small>Your personal knowledge base</small></span></a>
      <button className="primary new-page" disabled={busy} onClick={() => void run(async () => { await queue.current; edit(); })}>＋ New page</button>
      <nav aria-label="Wiki navigation">
        {([['index', '▤', 'All pages'], ['recent', '◷', 'Recent pages'], ['drafts', '✎', 'Drafts'], ['trash', '♲', 'Trash']] as const).map(([key, icon, label]) => <button key={key} className={(section === key || (key === 'index' && section === 'pages')) ? 'nav active' : 'nav'} onClick={() => void run(() => switchSection(key))}><span>{icon}</span>{label}<small>{key === 'index' ? active.length : key === 'drafts' ? data.drafts.length || '' : ''}</small></button>)}
      </nav>
      <div className="tree-heading">YOUR PAGES <span>{active.length}</span></div>
      <div className="page-tree">{[...groups].map(([name, pages]) => <details key={name} open><summary>{name === 'Pages' ? 'Unsorted' : name.replaceAll(':', ' / ')}</summary>{pages.map(p => <a key={p.id} href={pageUrl(p.path)} className={page?.id === p.id && section === 'pages' ? 'tree-page selected' : 'tree-page'}><span>▧</span>{p.title}{data.drafts.some(d => d.id === p.id) && <i title="Has draft">•</i>}</a>)}</details>)}{!active.length && <p className="muted">Your first page starts here.</p>}</div>
      <div className="sidebar-bottom"><button className="nav" onClick={() => void run(() => switchSection('settings'))}><span>⚙</span>Wiki & backups</button><div className="local-badge"><span className="dot"/> Stored on this device</div></div>
    </aside>
    <div className="workspace" inert={!!incoming || help}>
      <header className="topbar"><a className="header-brand" href={pageUrl(active.find(p => p.path === 'welcome')?.path || active[0]?.path || '')}>{data.settings.name}<small>Your personal knowledge base</small></a><button className="mobile-toggle" aria-label="Toggle navigation" onClick={() => setSidebar(!sidebar)}>☰</button><div className="search-box"><span>⌕</span><input id="search" aria-label="Search wiki" placeholder="Search your wiki…" value={query} onChange={e => setQuery(e.target.value)}/><kbd>Ctrl K</kbd></div><button className="shortcut-help" onClick={() => setHelp(true)}>Keyboard shortcuts</button><span className="connection"><span className="dot"/>{online ? 'Local workspace' : 'Offline · ready'}</span><button disabled={busy} onClick={() => void run(exportBackup)}>Export ZIP <span aria-hidden>↗</span></button></header>
      {error && <div role="alert" className="message error">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {notice && <div role="status" className="message">{notice}</div>}
      <main inert={busy}>
      {query.trim() ? <><div className="eyebrow">FIND YOUR WAY</div><h1>Search results</h1><p className="muted">{results.length} matching pages for “{query}”</p><div className="card-list">{results.map(r => { const p = active.find(p => p.id === r.id)!; return <a href={pageUrl(p.path)} key={p.id} className="result" onClick={() => setQuery('')}><h3>{p.title}</h3><small>{p.path}</small><p>{p.source.replace(/[#*`\[\]]/g, '').slice(0, 190)}…</p></a>; })}{!results.length && <div className="empty">No pages found. Try a title, tag, or a word from the page.</div>}</div></> : section === 'settings' ? <>
        <div className="eyebrow">YOUR WORKSPACE</div><h1>Wiki & backups</h1><p className="lead">A home for your knowledge. Entirely on your device.</p>
        <section className="panel"><h2>Make it yours</h2><label>Wiki name<input value={wikiName} maxLength={100} onChange={e => setWikiName(e.target.value)}/></label><button disabled={busy || !wikiName.trim()} onClick={() => void run(async () => { await db.saveSettings({ ...data.settings, name: wikiName.trim() }); await refresh(); setNotice('Wiki name saved.'); })}>Save name</button></section>
        <section className="panel"><h2>A copy you can keep</h2><p>Export one ZIP with every page, draft, revision, and attachment. Importing replaces this browser’s current wiki after you confirm.</p><div className="stats"><div><strong>{data.pages.length}</strong><span>pages, including trash</span></div><div><strong>{data.attachments.length}</strong><span>attachments · {sizeLabel(data.attachments.reduce((n, a) => n + a.size, 0))}</span></div><div><strong>{data.revisions.length}</strong><span>earlier revisions</span></div></div><p className="muted">Last export initiated: {dateLabel(data.settings.lastExport)}</p><div className="actions"><button className="primary" disabled={busy} onClick={() => void run(exportBackup)}>Export ZIP</button><button disabled={busy} onClick={() => imports.current?.click()}>Import ZIP…</button></div><p className="hint">Backups support up to 250 MB of expanded content. Files are processed locally.</p></section>
        <section className="panel"><h2>Browser storage</h2><p>Autosave belongs to this browser profile and address. Clearing site data removes it. Keep ZIP backups to move or recover your wiki.</p><button disabled={busy} onClick={() => void run(async () => { const granted = await navigator.storage.persist(); const estimate = await navigator.storage.estimate(); setStorage(`${granted ? 'Persistent storage granted.' : 'Persistent storage was not granted by this browser. Keep regular backups.'} Approximately ${sizeLabel(estimate.usage || 0)} used.`); })}>Request persistent storage</button>{storage && <p role="status">{storage}</p>}<p className="hint">The offline app cache lets the wiki open even after the server stops. Clear it to refresh older styles. Your pages, drafts, attachments, and settings are preserved.</p><button disabled={busy || cacheCleared} onClick={() => void run(async () => { await queue.current; await clearAppCache(); setCacheCleared(true); })}>Clear app cache</button>{cacheCleared && <p role="status">App cache cleared. Close all wiki tabs and installed wiki windows, then reopen http://127.0.0.1:4173/ with the server running. Offline caching resumes after the next load.</p>}</section>
      </> : section !== 'pages' ? <>
        <div className="eyebrow">YOUR COLLECTION</div><h1>{section === 'index' ? 'All pages' : section === 'recent' ? 'Recently updated' : section === 'drafts' ? 'Unfinished thoughts' : 'Trash'}</h1>
        <p className="lead">{section === 'drafts' ? 'Your drafts are saved here, ready when you are.' : section === 'trash' ? 'Deleted pages stay here until you restore them. They travel with your backup.' : section === 'index' ? 'Every page in your personal collection.' : 'Pick up where you left off.'}</p>
        <div className="card-list">{section === 'drafts' ? data.drafts.map(d => <button className="result" key={d.id} onClick={() => { setSection('pages'); updateDraft(d); }}><h3>{d.title || 'Untitled draft'}</h3><small>{d.path || 'No path yet'} · {dateLabel(d.updated)}</small></button>) : (section === 'trash' ? data.pages.filter(p => p.deleted) : [...active].sort((a, b) => section === 'index' ? a.title.localeCompare(b.title) : b.updated.localeCompare(a.updated))).map(p => <div className="result row" key={p.id}><div><h3>{p.title}</h3><small>{p.path} · {dateLabel(p.updated)}</small></div><button disabled={busy} onClick={() => section === 'trash' ? void run(async () => { await db.setDeleted(p.id, false); await refresh(); setNotice('Page restored.'); }) : go(p.path)}>{section === 'trash' ? 'Restore' : 'Open →'}</button></div>)}</div>
        {(section === 'drafts' ? !data.drafts.length : section === 'trash' ? !data.pages.some(p => p.deleted) : !active.length) && <div className="empty">Nothing here yet.</div>}
      </> : editor ? <>
        <div className="editor-heading"><div><div className="eyebrow">{data.pages.some(p => p.id === editor.id) ? 'EDIT PAGE' : 'NEW PAGE'}</div><h1>{editor.title || 'A new thought'}</h1></div><div className="actions"><button disabled={busy} onClick={() => void run(async () => { await queue.current; leaveEditor(); setNotice('Draft kept. Find it under Drafts.'); })}>Close editor</button><button className="primary" disabled={busy || !editor.title.trim() || !normalizePath(editor.path)} onClick={() => void run(publishPage)}>Publish page</button></div></div>
        <div className="edit-fields"><label>Title<input aria-label="Page title" value={editor.title} onChange={e => updateDraft({ ...editor, title: e.target.value, path: !data.pages.some(p => p.id === editor.id) && (!editor.path || editor.path === normalizePath(editor.title)) ? normalizePath(e.target.value) : editor.path })}/></label><label>Page path<input aria-label="Page path" value={editor.path} onChange={e => updateDraft({ ...editor, path: e.target.value })}/><small>Use colons for namespaces: projects:garden</small></label><label>Tags<input aria-label="Tags" value={editor.tags.join(', ')} onChange={e => updateDraft({ ...editor, tags: e.target.value.split(',').map(t => t.trim()) })}/><small>Separate tags with commas</small></label></div>
        {data.pages.some(p => p.id === editor.id && p.path !== normalizePath(editor.path)) && <p className="rename-note">Changing the path does not rewrite incoming links. Update those links after publishing.</p>}
        <div className="editor-toolbar"><div className="actions"><button title="Insert heading" onClick={() => heading(2)}>H2</button><button title="Bold [B]" onClick={() => format('**', '**', 'bold text')}><b>B</b></button><button title="Italic [I]" onClick={() => format('*', '*', 'italic text')}><i>I</i></button><button title="Code [M]" onClick={() => format('`', '`', 'code')}>Code</button><button title="Strikethrough [D]" onClick={() => format('~~', '~~', 'text')}>Strike</button><button title="Wiki link [L]" onClick={() => format('[[', ']]', 'page-path|label')}>Wiki link</button><button disabled={busy} onClick={() => uploads.current?.click()}>＋ Attach file</button></div><button title="Preview [P]" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Show preview'}</button></div>
        <div className={`editor-grid ${preview ? '' : 'source-only'}`}><div className="source-pane"><div className="pane-label">MARKDOWN</div><textarea ref={textarea} aria-label="Page content" spellCheck value={editor.source} onChange={e => updateDraft({ ...editor, source: e.target.value })} placeholder="Start writing. Link an idea with [[page-path]]."/></div>{preview && <div className="preview-pane"><div className="pane-label">LIVE PREVIEW</div><Markdown source={editor.source} pages={active} urls={urls}/></div>}</div>
        <div className="editor-footer"><span role="status">{saveState}</span><span>{editor.source.split(/\s+/).filter(Boolean).length} words · Ctrl/Cmd S to publish</span></div>
        <div className="actions secondary-actions"><button className="text-button danger" disabled={busy} onClick={() => { if (confirm('Discard this draft? The published page will remain unchanged.')) void run(async () => { await queue.current; await db.discardDraft(editor.id); leaveEditor(); await refresh(); }); }}>Discard draft</button></div>
        {data.attachments.length > 0 && <details className="attachment-library"><summary>Attachment library ({data.attachments.length})</summary>{data.attachments.map(a => <div className="attachment-row" key={a.id}><span>{a.name} <small>{sizeLabel(a.size)}</small></span><button onClick={() => insert(`${/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(a.type) ? '!' : ''}[${a.name.replace(/[\[\]]/g, '')}](attachment:${a.id})`)}>Insert</button></div>)}</details>}
      </> : page ? <>
        <div className="breadcrumbs">{page.path.split(':').map((part, i) => <span key={i}>{i > 0 && <b>/</b>}{part}</span>)}</div>
        <div className="page-heading"><div><h1>{page.title}</h1><div className="page-meta">Updated {dateLabel(page.updated)} <span>·</span> {page.source.split(/\s+/).filter(Boolean).length} words</div></div><nav className="actions page-tools" aria-label="Page tools"><button title="Old revisions [O]" aria-pressed={history} onClick={() => setHistory(!history)}>History <small>{revisions.length}</small></button><button title="Edit page [E]" className="primary" onClick={() => edit(page)}>✎ Edit page</button><button onClick={() => document.getElementById('backlinks')?.scrollIntoView({ behavior: 'smooth' })}>Backlinks</button><button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top</button></nav></div>
        {!!page.tags.filter(Boolean).length && <div className="tags">{page.tags.filter(Boolean).map((tag, i) => <button key={i} onClick={() => setQuery(tag)}># {tag}</button>)}</div>}
        {data.drafts.some(d => d.id === page.id) && <div className="draft-banner">You have an unpublished draft of this page.<button onClick={() => edit(page)}>Continue editing →</button></div>}
        {history ? <section className="panel history"><h2>Earlier versions</h2><p className="muted">Restoring a revision opens it as a draft. Publish when you’re ready.</p>{!revisions.length && <p>No earlier versions yet. Publishing an edit creates one.</p>}{revisions.map(r => <details key={r.id}><summary>{dateLabel(r.date)} · {r.title}</summary><Markdown source={r.source} pages={active} urls={urls}/><button onClick={() => { if (data.drafts.some(d => d.id === page.id) && !confirm('Replace the existing draft with this revision?')) return; updateDraft({ id: page.id, path: page.path, title: r.title, source: r.source, tags: r.tags, updated: now() }); setHistory(false); }}>Restore as draft</button></details>)}</section> : <article className="article"><Markdown source={page.source} pages={active} urls={urls}/></article>}
        <footer id="backlinks" className="page-footer" tabIndex={-1}><div><div className="eyebrow">LINKED TO THIS PAGE</div>{backlinks.length ? <div className="backlinks">{backlinks.map(p => <a key={p.id} href={pageUrl(p.path)}>↗ {p.title}</a>)}</div> : <p className="muted">No backlinks yet. Link here with <code>[[{page.path}]]</code>.</p>}</div><button className="text-button danger" disabled={busy} onClick={() => { if (confirm(`Move “${page.title}” to Trash? You can restore it later.`)) void run(async () => { await db.setDeleted(page.id, true); await refresh(); setSection('trash'); }); }}>Move to Trash</button></footer>
      </> : <div className="empty missing"><div className="eyebrow">ROOM FOR ANOTHER IDEA</div><h1>{path ? 'This page hasn’t been written yet' : 'Make your first page'}</h1><p>{path ? `Create “${path}” to give this link a home.` : 'Start with a note, a project, or something worth remembering.'}</p>{data.pages.some(p => p.path === path && p.deleted) ? <button onClick={() => setSection('trash')}>Find this page in Trash</button> : <button className="primary" onClick={() => edit(undefined, path)}>＋ Create page</button>}</div>}
      </main>
      <footer className="workspace-footer"><span>Local Wiki · Personal knowledge base</span><span>{busy ? 'Working…' : 'Private by design. Yours to keep.'}</span></footer>
    </div>
    <input hidden ref={uploads} type="file" multiple onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (!files.length || !editor) return; void run(async () => { if (files.reduce((n, f) => n + f.size, 0) + data.attachments.reduce((n, a) => n + a.size, 0) > 200 * 1024 * 1024) throw new Error('Attachments are limited to 200 MB total to leave room for page history in backups.'); const items = await db.addAttachments(files); await refresh(); insert('\n' + items.map(a => `${/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(a.type) ? '!' : ''}[${a.name.replace(/[\[\]]/g, '')}](attachment:${a.id})`).join('\n') + '\n'); }); }}/>
    <input hidden ref={imports} type="file" accept=".zip,application/zip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { await queue.current; setIncoming(await importZip(file)); }); }}/>
    {help && <Modal busy={false} titleId="shortcuts-title" onClose={() => setHelp(false)}><h2 id="shortcuts-title">Keyboard shortcuts</h2><p>Use Alt + key on Windows/Linux (Alt + Shift + key also works), or Control + Option + key on Mac. Some system shortcuts may take priority.</p><table className="shortcut-table"><tbody>{[['E', 'Edit or create the current page'], ['S', 'Publish the open draft'], ['P', 'Toggle editor preview'], ['V', 'Close editor and keep draft'], ['B / I', 'Bold / italic'], ['M / D', 'Code / strikethrough'], ['L', 'Wiki link'], ['1–5', 'Heading levels 1–5'], ['- / .', 'Numbered / bulleted list'], ['F', 'Focus search'], ['O', 'Old revisions'], ['R', 'Recent pages'], ['X', 'All pages'], ['T', 'Back to top']].map(([key, label]) => <tr key={key}><th><kbd>{key}</kbd></th><td>{label}</td></tr>)}</tbody></table><p>Formatting keys work in the page content field and wrap the selection. Ctrl/Cmd + S publishes; Ctrl/Cmd + K focuses search. Markdown headings use # through ######. Closing the editor keeps your draft.</p><button onClick={() => setHelp(false)}>Close shortcuts</button></Modal>}
    {incoming && <Modal busy={busy} onClose={() => setIncoming(undefined)}><div className="eyebrow">BACKUP VALIDATED</div><h2 id="import-title">Replace this wiki?</h2><p><strong>{incoming.settings.name}</strong> contains {incoming.pages.length} pages, {incoming.drafts.length} drafts, {incoming.revisions.length} revisions, and {incoming.attachments.length} attachments.</p><p>This replaces all current wiki content in this browser. Export your current wiki first if you want to keep it.</p><div className="actions"><button autoFocus disabled={busy} onClick={() => setIncoming(undefined)}>Cancel</button><button disabled={busy} onClick={() => void run(exportBackup)}>Export current wiki</button><button className="primary" disabled={busy} onClick={() => void run(async () => { await db.replaceWiki(incoming); setWikiName(incoming.settings.name); await refresh(); const first = incoming.pages.find(p => !p.deleted); setIncoming(undefined); leaveEditor(); go(first?.path || ''); setNotice('Wiki restored from ZIP.'); })}>Replace wiki</button></div></Modal>}
  </div>;
}
