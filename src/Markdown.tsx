import { useMemo } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { normalizePath, pageUrl, type Page } from './model';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const parser = new Marked({ gfm: true, breaks: false });
parser.use({ extensions: [{ name: 'wikilink', level: 'inline', start: src => src.indexOf('[['), tokenizer(src) {
  const match = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
  if (match) return { type: 'wikilink', raw: match[0], target: match[1], label: match[2] || match[1] };
}, renderer(token) { return `<a href="${escape(pageUrl(normalizePath(token.target)))}" data-wiki="${escape(normalizePath(token.target))}">${escape(token.label)}</a>`; } }] });
export function Markdown({ source, pages, urls }: { source: string; pages: Page[]; urls: Map<string, { url: string; name: string; type: string }> }) {
  const html = useMemo(() => {
    const fragment = DOMPurify.sanitize(parser.parse(source) as string, {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'strong', 'b', 'em', 'i', 'del', 's', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'details', 'summary', 'sup', 'sub'],
      ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'data-wiki', 'start', 'colspan', 'rowspan'], ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|attachment):|#)/i
    });
    for (const img of fragment.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      const asset = urls.get(src.replace(/^attachment:/, ''));
      if (src.startsWith('attachment:') && asset && /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(asset.type)) { img.src = asset.url; img.loading = 'lazy'; }
      else { const span = document.createElement('span'); span.className = 'blocked-media'; span.textContent = `[Image unavailable: ${img.alt || 'use an uploaded image'}]`; img.replaceWith(span); }
    }
    for (const a of fragment.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('attachment:')) {
        const asset = urls.get(href.slice(11));
        if (asset) { a.href = asset.url; a.download = asset.name; }
        else { a.removeAttribute('href'); a.title = 'Attachment missing'; }
      } else if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      const path = a.getAttribute('data-wiki');
      if (path && !pages.some(p => p.path === path && !p.deleted)) { a.classList.add('missing-link'); a.title = 'Create this page'; }
    }
    const container = document.createElement('div'); container.append(fragment); return container.innerHTML;
  }, [source, pages, urls]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
