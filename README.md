# Local Wiki

A personal browser-only wiki with local autosave and portable ZIP backups. Built with React and TypeScript. Your pages, drafts, history, and attachments live in IndexedDB in your browser profile. There are no accounts, servers receiving your content, analytics, or remote fonts.

## Run locally

Install Node.js 22 or newer and pnpm, then run these commands from this repository:

```sh
pnpm install
pnpm build
pnpm preview --port 4173 --strictPort
```

Open **http://127.0.0.1:4173/**. The preview binds only to the local computer. Keep this address and port consistent: browser storage belongs to an origin, so `localhost`, `127.0.0.1`, and different ports have separate data.

After the production app finishes its first load, a service worker caches its assets. The app can then open and reload offline in that browser. Bookmark the address or install the app using your browser's installation menu where supported. The server only serves static app files; it does not store wiki content. Opening `index.html` directly with `file://` is not supported.

For development, use `pnpm dev` (a separate origin, usually port 5173). Development mode does not enable offline caching. After building an update, close every wiki tab and reopen to let the waiting service worker activate.

## Using the wiki

- **New page** creates a draft. Enter a title and path, then write using Markdown. **Publish page** makes the draft the current page. This is a local action; nothing is published to the internet.
- Drafts save automatically while typing. **Close editor** keeps a draft. **Discard draft** removes it after confirmation. Resume drafts from the sidebar or the page's draft banner.
- Use paths such as `projects:garden` to organize pages into namespaces. Paths are normalized to lowercase. Changing a page's path does not rewrite incoming links; update those links yourself. Paths in Trash remain reserved until restored.
- Use `[[projects:garden]]` or `[[projects:garden|Garden notebook]]` for wiki links. Clicking a missing link offers to create the page. Backlinks appear below each page.
- Search checks published titles, paths, tags, and page source, with prefix and approximate matching. Drafts, deleted pages, and attachment contents are not searched.
- **History** shows earlier published versions. Restore a version as a draft, review it, and publish it to make it current. History is retained without automatic pruning.
- **Attach file** stores an original local file and inserts its reference. Common raster images render inline; other types, including SVG and HTML, download as files. The attachment library lets you reuse files. Attachments are retained even when references are removed.
- **Move to Trash** keeps the page and history recoverable. Restore pages from Trash. Permanent deletion and attachment cleanup are not part of this first version.
- `Ctrl/Cmd+S` publishes the open draft. `Ctrl/Cmd+K` focuses search.

Markdown supports headings, lists, tables, quotes, fenced code, links, and emphasis. This is inspired by DokuWiki's features, not a compatible implementation of its markup or plugins. Wiki paths are absolute within the wiki; relative namespaces and heading targets in wiki links are not implemented.

## Backups and storage

**Export ZIP** downloads a complete snapshot: published pages, drafts, earlier revisions, Trash, settings, and every attachment. In **Wiki & backups**, **Import ZIP** validates the backup and shows a summary before asking whether to replace the current wiki. Export the current wiki first if you want to retain it. Import replaces rather than merges.

Validation checks format version, records, referenced files, expanded sizes, and SHA-256 checksums. Replacement happens in a single IndexedDB transaction; failed writes abort the replacement. Checksums detect accidental changes, not whether a backup came from a trusted person.

The archive contains:

```text
manifest.json          Version, metadata, original filenames, and file checksums
pages/<id>.md          Current page source
drafts/<id>.md         Unpublished source
revisions/<id>.md      Earlier page source
attachments/<id>      Original binary files, named by internal ID
```

Text files are readable outside the app. If you edit a backup manually, you must update its manifest and checksums before importing it. Backups are not encrypted.

This version allows up to **200 MB of attachments** and **250 MB of expanded backup content**, with at most 50,000 archive entries. Export/import assembles content in memory; these are protective limits, not performance guarantees on every device. Very large archives may need a smaller wiki or a desktop browser. Search is also built in memory from published pages.

Browser autosave is separate from a downloaded backup. Clearing site data, deleting your browser profile, or using private browsing can remove local content. Request persistent storage in **Wiki & backups**; the browser decides whether to grant it. Keep regular ZIP backups even when persistence is granted. “Last export initiated” records the download attempt, since the browser cannot confirm you retained the file.

One tab at a time can open a wiki in the same browser profile. A second tab displays a lock message rather than allowing conflicting edits. Current Chrome, Edge, Firefox, and Safari with IndexedDB, Web Locks, and service-worker support are intended targets. The automated browser checks currently run in Edge; real Safari/iPad acceptance remains outstanding.

Rendered page content is sanitized. Remote images and embedded active content are blocked; external links open only when clicked. All app libraries are bundled for offline use.

## Verification

```sh
pnpm test
pnpm build
pnpm test:browser
```

Browser tests use a locally installed Microsoft Edge and start a production preview if needed. They use isolated browser profiles, not your personal wiki. Tests cover data round trips, failed-replacement rollback, malformed backups, draft recovery, revisions, backlinks, search, attachment handling, offline reload, second-tab locking, sanitization, and responsive layout.

Source overview: `src/db.ts` owns persistence, `src/backup.ts` owns ZIP serialization and validation, `src/Markdown.tsx` owns sanitized rendering, and `src/App.tsx` provides the interface. `dist/` is the generated static production app.

### Keyboard shortcuts

DokuWiki-style access keys use Alt + key on Windows/Linux (Alt + Shift + key also works), or Control + Option + key on Mac. Browser or operating-system bindings may take priority. Open **Keyboard shortcuts** in the header for the full list.

E edits or creates the current page; S publishes; P toggles preview; V closes the editor while keeping the draft. In the page content field, B/I format bold/italic, M inserts code, D strikes text, L inserts a wiki link, 1–5 apply heading levels, and -/. insert numbered/bulleted lists. Formatting wraps the selected text using Markdown. F focuses search, O opens old revisions, R opens recent pages, X opens all pages, and T returns to the top. Existing Ctrl/Cmd+S and Ctrl/Cmd+K remain available. Shortcuts are suspended while a dialog is open.
