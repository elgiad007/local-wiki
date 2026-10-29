import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { exportZip, importZip } from '../src/backup';
import { initialize, snapshot, publish, saveDraft, replaceWiki, setDeleted, database } from '../src/db';
import { normalizePath, now, type Snapshot } from '../src/model';
const blank = (): Snapshot => ({ pages: [], drafts: [], revisions: [], attachments: [], settings: { id: 'wiki', name: 'Test wiki' } });
beforeEach(async () => { await replaceWiki(blank()); });
test('paths normalize namespaces without traversal segments', () => {
  expect(normalizePath(' Projects / My Garden ')).toBe('projects:my-garden');
  expect(normalizePath('../notes/../idea')).toBe('notes:idea');
});
test('publish preserves old revision and clears only its draft', async () => {
  const draft = { id: 'page-1', title: 'First', path: 'notes:first', source: 'one', tags: ['test'], updated: now() };
  await saveDraft(draft); await publish(draft); await saveDraft({ ...draft, id: 'other' });
  await publish({ ...draft, source: 'two' });
  const state = await snapshot();
  expect(state.pages[0].source).toBe('two'); expect(state.revisions[0].source).toBe('one'); expect(state.drafts.map(d => d.id)).toEqual(['other']);
});
test('duplicate paths reject without changing existing pages or losing draft', async () => {
  const draft = { id: 'a', title: 'First', path: 'notes:first', source: 'one', tags: [], updated: now() };
  await publish(draft); await saveDraft({ ...draft, id: 'b' });
  await expect(publish({ ...draft, id: 'b' })).rejects.toThrow('already in use');
  const state = await snapshot(); expect(state.pages).toHaveLength(1); expect(state.drafts).toHaveLength(1);
});
test('ZIP round trip preserves Unicode, binary attachments, trash, drafts and revisions', async () => {
  const draft = { id: 'a', title: 'Café 日本語', path: 'notes:café', source: 'Original [[notes:other]]', tags: ['café'], updated: now() };
  await publish(draft); await publish({ ...draft, source: 'Current **text**' }); await setDeleted('a', true); await saveDraft({ ...draft, source: 'Unfinished' });
  const state = await snapshot(); const bytes = new Uint8Array([0, 255, 20, 30, 128]);
  state.attachments.push({ id: 'file-1', name: '../test.bin', type: 'application/octet-stream', size: bytes.length, created: now(), blob: new Blob([bytes]) });
  const loaded = await importZip(await exportZip(state));
  expect(loaded.pages).toEqual(state.pages); expect(loaded.revisions).toEqual(state.revisions); expect(loaded.drafts).toEqual(state.drafts);
  expect(new Uint8Array(await loaded.attachments[0].blob.arrayBuffer())).toEqual(bytes);
  await replaceWiki(loaded); expect((await snapshot()).pages[0].deleted).toBe(true);
});
test('tampered content fails integrity validation before any database replacement', async () => {
  await publish({ id: 'a', title: 'A', path: 'a', source: 'original', tags: [], updated: now() });
  const files = unzipSync(new Uint8Array(await (await exportZip(await snapshot())).arrayBuffer()));
  files['pages/a.md'] = strToU8('tampered');
  await expect(importZip(new Blob([zipSync(files)]))).rejects.toThrow('integrity');
  expect((await snapshot()).pages[0].source).toBe('original');
});
test('unsupported versions and unsafe archive paths are rejected', async () => {
  const files = unzipSync(new Uint8Array(await (await exportZip(blank())).arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['manifest.json'])); manifest.version = 999; files['manifest.json'] = strToU8(JSON.stringify(manifest));
  await expect(importZip(new Blob([zipSync(files)]))).rejects.toThrow('Unsupported');
  await expect(importZip(new Blob([zipSync({ '../evil': strToU8('bad') })]))).rejects.toThrow('unexpected file path');
});
test('invalid records abort an entire replacement transaction', async () => {
  await publish({ id: 'a', title: 'A', path: 'a', source: 'keep me', tags: [], updated: now() });
  const invalid = blank(); invalid.pages.push({ title: 'Missing key' } as never);
  await expect(replaceWiki(invalid)).rejects.toThrow();
  // Wait for IndexedDB's queued abort before checking the old database.
  await new Promise(resolve => setTimeout(resolve, 10));
  expect((await snapshot()).pages[0].source).toBe('keep me');
});
test('initialization does not repopulate an intentionally empty restored wiki', async () => {
  await initialize(); expect((await snapshot()).pages).toHaveLength(0);
  const db = await database(); await db.clear('settings'); await initialize(); expect((await snapshot()).pages).toHaveLength(1);
});
