export interface Page { id: string; path: string; title: string; source: string; tags: string[]; created: string; updated: string; deleted?: boolean }
export interface Revision { id: string; pageId: string; title: string; path: string; source: string; tags: string[]; date: string }
export interface Draft { id: string; title: string; path: string; source: string; tags: string[]; updated: string }
export interface Attachment { id: string; name: string; type: string; size: number; created: string; blob: Blob }
export interface Settings { id: 'wiki'; name: string; lastExport?: string }
export interface Snapshot { pages: Page[]; revisions: Revision[]; drafts: Draft[]; attachments: Attachment[]; settings: Settings }
export const normalizePath = (value: string) => value.trim().toLowerCase().replace(/[/\\]+/g, ':').split(':').map(p => p.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '')).filter(p => p && p !== '.' && p !== '..').join(':');
export const linksIn = (source: string) => [...source.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(m => normalizePath(m[1]));
export const pageUrl = (path: string) => '#page/' + encodeURIComponent(path);
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const welcome = `Welcome to your own little corner of knowledge. Everything you write here stays on this device.

## Make yourself at home

Create a page, collect an idea, or start a project notebook. Use **namespaces** to keep related pages together: \`projects:garden\`, for example.

- **Write** with Markdown and a live preview.
- **Connect** pages with \`[[page-path]]\` or \`[[page-path|friendly label]]\`.
- **Find** what you need with full-text search.
- **Keep a copy** with **Export ZIP**. Open that ZIP on another device to take your wiki with you.

## A few things to know

Editing saves a draft automatically. **Publish page** records a revision and makes that draft the current page. Earlier published versions are available in History.

Images and files can be added from the editor. They are stored locally and included in your backup. External images are blocked so reading a page doesn't contact another website.

> Browser autosave keeps your work here. An exported ZIP is your portable backup. Keep both.

## Start a trail

Try creating [[notes:ideas|a page for your ideas]]. Missing links let you create the page they point to.
`;
