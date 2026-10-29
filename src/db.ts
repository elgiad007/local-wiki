import { openDB } from 'idb';
import { now, uid, welcome, normalizePath, type Snapshot, type Page, type Draft, type Attachment, type Revision, type Settings } from './model';
const stores = ['pages', 'revisions', 'drafts', 'attachments', 'settings'] as const;
export const database = () => openDB('local-wiki', 1, { upgrade(db) { for (const name of stores) db.createObjectStore(name, { keyPath: 'id' }); } });
export async function initialize() {
  const db = await database();
  const tx = db.transaction(['pages', 'settings'], 'readwrite');
  if (!await tx.objectStore('settings').get('wiki')) {
    const date = now();
    await tx.objectStore('settings').put({ id: 'wiki', name: 'My wiki' });
    await tx.objectStore('pages').put({ id: uid(), path: 'welcome', title: 'Welcome to your wiki', source: welcome, tags: ['getting-started'], created: date, updated: date });
  }
  await tx.done;
}
export async function snapshot(): Promise<Snapshot> {
  const db = await database();
  const tx = db.transaction([...stores], 'readonly');
  const [pages, revisions, drafts, attachments, settings] = await Promise.all(stores.map(s => tx.objectStore(s).getAll()));
  await tx.done;
  return { pages, revisions, drafts, attachments, settings: settings[0] } as Snapshot;
}
export async function saveDraft(draft: Draft) { const db = await database(); await db.put('drafts', draft); }
export async function discardDraft(id: string) { const db = await database(); await db.delete('drafts', id); }
export async function publish(draft: Draft) {
  if (!draft.title.trim() || !normalizePath(draft.path)) throw new Error('A title and page path are required.');
  const path = normalizePath(draft.path);
  const db = await database();
  const tx = db.transaction(['pages', 'drafts', 'revisions'], 'readwrite');
  const pages: Page[] = await tx.objectStore('pages').getAll();
  if (pages.some(p => p.id !== draft.id && p.path === path)) {
    await tx.done;
    throw new Error('That page path is already in use (possibly in Trash). Choose another path.');
  }
  const old = pages.find(p => p.id === draft.id);
  const date = now();
  if (old) await tx.objectStore('revisions').put({ id: uid(), pageId: old.id, title: old.title, path: old.path, source: old.source, tags: old.tags, date: old.updated } satisfies Revision);
  const page: Page = { id: draft.id, title: draft.title.trim(), path, source: draft.source, tags: draft.tags, created: old?.created ?? date, updated: date };
  await tx.objectStore('pages').put(page);
  await tx.objectStore('drafts').delete(draft.id);
  await tx.done;
  return page;
}
export async function setDeleted(id: string, deleted: boolean) {
  const db = await database(); const tx = db.transaction('pages', 'readwrite');
  const page = await tx.store.get(id);
  if (page) await tx.store.put({ ...page, deleted });
  await tx.done;
}
export async function addAttachments(files: File[]) {
  const items: Attachment[] = files.map(file => ({ id: uid(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, created: now(), blob: file }));
  const db = await database(); const tx = db.transaction('attachments', 'readwrite');
  for (const item of items) await tx.store.put(item);
  await tx.done; return items;
}
export async function saveSettings(settings: Settings) { const db = await database(); await db.put('settings', settings); }
// The replacement commits as a single transaction. A failed write keeps the previous wiki intact.
export async function replaceWiki(data: Snapshot) {
  const db = await database(); const tx = db.transaction([...stores], 'readwrite');
  try {
    for (const name of stores) {
      await tx.objectStore(name).clear();
      for (const record of name === 'settings' ? [data.settings] : data[name]) await tx.objectStore(name).put(record);
    }
    await tx.done;
  } catch (error) {
    // Synchronous errors (for example DataCloneError) don't automatically abort IDB.
    try { tx.abort(); } catch { /* A request error may already have aborted it. */ }
    await tx.done.catch(() => {});
    throw error;
  }
}
