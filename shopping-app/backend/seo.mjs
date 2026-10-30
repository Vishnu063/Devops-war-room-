import { readFile } from 'node:fs/promises';
import { database } from './db.mjs';
import { findProduct } from './repository.mjs';
import { headers, imagePolicy } from './http.mjs';
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export async function seo(req, res, url) {
  if (req.method !== 'GET') return false;
  const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:' + req.socket.localPort,
    indexable = process.env.NODE_ENV === 'production' && process.env.SEO_INDEXABLE === 'true';
  if (url.pathname === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', ...headers });
    res.end(
      'User-agent: *\nDisallow: ' +
        (indexable ? '/admin' : '/') +
        '\n' +
        (indexable ? 'Sitemap: ' + origin + '/sitemap.xml\n' : ''),
    );
    return true;
  }
  if (url.pathname === '/sitemap.xml') {
    const rows = process.env.DATABASE_URL
      ? (
          await database().query(
            'SELECT slug FROM products p WHERE active AND EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.active) ORDER BY slug LIMIT 50000',
          )
        ).rows
      : [];
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', ...headers });
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        rows
          .map(
            (r) =>
              '<url><loc>' +
              escape(origin + '/products/' + encodeURIComponent(r.slug)) +
              '</loc></url>',
          )
          .join('') +
        '</urlset>',
    );
    return true;
  }
  const match = url.pathname.match(/^\/products\/([^/]+)$/);
  if (match && process.env.DATABASE_URL) {
    const p = await findProduct(decodeURIComponent(match[1]));
    let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    html = html
      .replace(/<title>.*?<\/title>/, '<title>' + escape(p.name) + ' | NovaCart</title>')
      .replace(
        /<meta name="description"[^>]*>/,
        '<meta name="description" content="' + escape(p.description.slice(0, 160)) + '">',
      );
    html = html.replace(
      '</head>',
      '<link rel="canonical" href="' +
        escape(origin + '/products/' + encodeURIComponent(p.slug)) +
        '"><meta name="robots" content="' +
        (indexable ? 'index,follow' : 'noindex,nofollow') +
        '"><meta property="og:title" content="' +
        escape(p.name) +
        '"><meta property="og:type" content="product"></head>',
    );
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      ...headers,
      'content-security-policy': imagePolicy(),
    });
    res.end(html);
    return true;
  }
  return false;
}
