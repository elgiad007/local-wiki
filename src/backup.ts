import { zip, unzipSync, strToU8, strFromU8 } from 'fflate';
import { normalizePath, type Snapshot } from './model';
const LIMIT = 250 * 1024 * 1024;
const MAX_ENTRIES = 50000;
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string';
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const tags = (v: unknown) => Array.isArray(v) && v.every(text);
function assert(value: unknown, message = 'The backup manifest is invalid.'): asserts value { if (!value) throw new Error(message); }
async function hash(bytes: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(x => x.toString(16).padStart(2, '0')).join(''); }
export async function exportZip(data: Snapshot): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const pages = data.pages.map(({ source, ...p }) => { files[`pages/${p.id}.md`] = strToU8(source); return p; });
  const revisions = data.revisions.map(({ source, ...r }) => { files[`revisions/${r.id}.md`] = strToU8(source); return r; });
  const drafts = data.drafts.map(({ source, ...d }) => { files[`drafts/${d.id}.md`] = strToU8(source); return d; });
  const attachments = [];
  let size = Object.values(files).reduce((sum, f) => sum + f.length, 0);
  for (const { blob, ...a } of data.attachments) {
    size += blob.size; assert(size <= LIMIT, 'This wiki exceeds the 250 MB backup limit.');
    files[`attachments/${a.id}`] = new Uint8Array(await blob.arrayBuffer()); attachments.push(a);
  }
  const checksums: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) checksums[name] = await hash(bytes);
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'local-wiki', version: 1, exported: new Date().toISOString(), settings: data.settings, pages, revisions, drafts, attachments, checksums }, null, 2));
  assert(Object.values(files).reduce((sum, f) => sum + f.length, 0) <= LIMIT && Object.keys(files).length <= MAX_ENTRIES, 'This wiki exceeds the backup size or entry limit.');
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 6 }, (error, result) => error ? reject(error) : resolve(result)));
  return new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' });
}
export async function importZip(file: Blob): Promise<Snapshot> {
  assert(file.size <= LIMIT, 'The ZIP exceeds the 250 MB import limit.');
  let total = 0, count = 0;
  const names = new Set<string>();
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
    total += entry.originalSize; count++;
    assert(total <= LIMIT && count <= MAX_ENTRIES, 'The expanded backup exceeds the size or entry limit.');
    assert(!names.has(entry.name), 'The ZIP contains duplicate entries.'); names.add(entry.name);
    assert(entry.name === 'manifest.json' || /^(pages|revisions|drafts)\/[a-zA-Z0-9-]{1,80}\.md$/.test(entry.name) || /^attachments\/[a-zA-Z0-9-]{1,80}$/.test(entry.name), 'The ZIP contains an unexpected file path.');
    return true;
  } });
  assert(files['manifest.json'], 'This is not a Local Wiki backup: manifest.json is missing.');
  const m = JSON.parse(strFromU8(files['manifest.json']));
  assert(m?.format === 'local-wiki' && m.version === 1, 'Unsupported backup format or version.');
  assert(m.settings?.id === 'wiki' && text(m.settings.name) && m.settings.name.trim());
  assert(m.settings.lastExport === undefined || date(m.settings.lastExport));
  for (const key of ['pages', 'revisions', 'drafts', 'attachments']) assert(Array.isArray(m[key]) && m[key].length <= MAX_ENTRIES);
  assert(m.checksums && typeof m.checksums === 'object');
  const expected = new Set(['manifest.json']);
  async function read(name: string) {
    const bytes = files[name]; assert(bytes, `Backup file missing: ${name}`);
    expected.add(name);
    assert(await hash(bytes) === m.checksums[name], `Backup integrity check failed: ${name}`);
    return bytes;
  }
  function unique(records: { id: string }[]) { const seen = new Set(); for (const r of records) { assert(validId(r.id) && !seen.has(r.id)); seen.add(r.id); } }
  for (const key of ['pages', 'revisions', 'drafts', 'attachments']) unique(m[key]);
  const paths = new Set();
  const pages = [];
  for (const p of m.pages) {
    assert(text(p.title) && p.title.trim() && text(p.path) && p.path && normalizePath(p.path) === p.path && !paths.has(p.path) && tags(p.tags) && date(p.created) && date(p.updated) && (p.deleted === undefined || typeof p.deleted === 'boolean'));
    paths.add(p.path);
    pages.push({ id: p.id, title: p.title, path: p.path, tags: p.tags, created: p.created, updated: p.updated, deleted: p.deleted, source: strFromU8(await read(`pages/${p.id}.md`)) });
  }
  const pageIds = new Set(pages.map(p => p.id));
  const revisions = [];
  for (const r of m.revisions) {
    assert(pageIds.has(r.pageId) && text(r.title) && text(r.path) && tags(r.tags) && date(r.date));
    revisions.push({ id: r.id, pageId: r.pageId, title: r.title, path: r.path, tags: r.tags, date: r.date, source: strFromU8(await read(`revisions/${r.id}.md`)) });
  }
  const drafts = [];
  for (const d of m.drafts) {
    assert(text(d.title) && text(d.path) && tags(d.tags) && date(d.updated));
    drafts.push({ id: d.id, title: d.title, path: d.path, tags: d.tags, updated: d.updated, source: strFromU8(await read(`drafts/${d.id}.md`)) });
  }
  const attachments = [];
  for (const a of m.attachments) {
    assert(text(a.name) && text(a.type) && Number.isSafeInteger(a.size) && a.size >= 0 && date(a.created));
    const bytes = await read(`attachments/${a.id}`); assert(bytes.length === a.size, 'Attachment size mismatch.');
    attachments.push({ id: a.id, name: a.name, type: a.type, size: a.size, created: a.created, blob: new Blob([new Uint8Array(bytes).buffer], { type: a.type }) });
  }
  assert(Object.keys(files).every(name => expected.has(name)), 'The backup contains unreferenced files.');
  return { pages, revisions, drafts, attachments, settings: { id: 'wiki', name: m.settings.name, lastExport: m.settings.lastExport } };
}
