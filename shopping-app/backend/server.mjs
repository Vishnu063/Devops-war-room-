// NovaCart same-origin application API. Live provider activation and production deployment are separate owner responsibilities.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { seo } from './seo.mjs';
import { validateConfiguration } from './config.mjs';
import { startJobs } from './jobs.mjs';
import { closeDatabase } from './db.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listProducts, products, quoteCart } from './catalog.mjs';
import { findProducts, quoteDatabaseCart, findProduct, categories } from './repository.mjs';
import { registerCustomer, authenticateCustomer } from './auth.mjs';
import {
  createSession,
  currentUser,
  revokeSession,
  sessionCookie,
  clearSessionCookie,
} from './sessions.mjs';
import {
  checkRateLimit,
  databaseRateLimit,
  verifySameOrigin,
  requireJson,
  clientAddress,
} from './security.mjs';
import { handleAdminProducts } from './admin-routes.mjs';
import { send, readJson, headers as staticHeaders, imagePolicy } from './http.mjs';
import { operationsRoutes } from './operations-routes.mjs';
import { commerceRoutes } from './commerce-routes.mjs';
import { mergeGuest } from './shopping.mjs';
import { transaction } from './db.mjs';
import {
  issueIdentityToken,
  requestIdentity,
  consumeIdentity,
  requireOwner,
  checkMfa,
  beginMfa,
  finishMfa,
  revokeAll,
} from './identity.mjs';
const port = Number(process.env.PORT || 3100);
export const server = createServer(async (req, res) => {
  try {
    res.setHeader('X-Request-ID', randomUUID());
    if (process.env.APP_ORIGIN) {
      if (req.headers.host !== new URL(process.env.APP_ORIGIN).host)
        return send(res, 403, { error: 'Unexpected request host' });
    } else if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || ''))
      return send(res, 403, { error: 'Unexpected request host' });
    if (!req.url.startsWith('/') || req.url.startsWith('//'))
      return send(res, 400, { error: 'Invalid request target' });
    const url = new URL(req.url, 'http://localhost');
    const method = req.method;
    if (await seo(req, res, url)) return;
    const staticFiles = {
      '/': 'index.html',
      '/account': 'index.html',
      '/cart': 'index.html',
      '/wishlist': 'index.html',
      '/orders': 'index.html',
      '/checkout': 'index.html',
      '/support': 'index.html',
      '/offers': 'index.html',
      '/policies': 'index.html',
      '/returns': 'index.html',
      '/categories': 'index.html',
      '/search': 'index.html',
      '/compare': 'index.html',
      '/index.html': 'index.html',
      '/app.js': 'app.js',
      '/ui.js': 'ui.js',
      '/account.js': 'account.js',
      '/forms.js': 'forms.js',
      '/payment-ui.js': 'payment-ui.js',
      '/owner-console.js': 'owner-console.js',
      '/styles.css': 'styles.css',
      '/admin': 'admin.html',
      '/admin.html': 'admin.html',
      '/admin.css': 'admin.css',
      '/admin.js': 'admin.js',
      '/checkout-demo.html': 'checkout-demo.html',
      '/checkout-demo.js': 'checkout-demo.js',
    };
    if (
      method === 'GET' &&
      (staticFiles[url.pathname] ||
        /^\/assets\/[a-z0-9_-]+\.(svg|png|webp|jpg)$/.test(url.pathname))
    ) {
      const name = staticFiles[url.pathname] || url.pathname.slice(1),
        bytes = await readFile(new URL('../' + name, import.meta.url));
      res.writeHead(200, {
        ...staticHeaders,
        'content-security-policy': imagePolicy(),
        'content-type': name.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : name.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : name.endsWith('.svg')
              ? 'image/svg+xml'
              : name.endsWith('.png')
                ? 'image/png'
                : name.endsWith('.jpg')
                  ? 'image/jpeg'
                  : name.endsWith('.webp')
                    ? 'image/webp'
                    : 'text/html; charset=utf-8',
      });
      res.end(bytes);
      return;
    }
    if (url.pathname.startsWith('/api/auth/')) {
      if (
        process.env.DATABASE_URL &&
        req.method === 'POST' &&
        [
          '/api/auth/forgot-password',
          '/api/auth/resend-verification',
          '/api/auth/reset-password',
          '/api/auth/verify-email',
          '/api/auth/mfa/setup',
          '/api/auth/mfa/confirm',
          '/api/auth/revoke-all',
        ].includes(url.pathname)
      ) {
        if (!verifySameOrigin(req)) return send(res, 403, { error: 'Cross-origin request denied' });
        if (!requireJson(req)) return send(res, 415, { error: 'JSON required' });
        const rate = await databaseRateLimit('identity:' + clientAddress(req));
        if (!rate.allowed) return send(res, 429, { error: 'Too many attempts' });
        const input = await readJson(req),
          origin = process.env.APP_ORIGIN || 'http://127.0.0.1:' + req.socket.localPort;
        if (url.pathname === '/api/auth/forgot-password')
          return send(res, 202, await requestIdentity(input, 'RESET_PASSWORD', origin));
        if (url.pathname === '/api/auth/resend-verification')
          return send(res, 202, await requestIdentity(input, 'VERIFY_EMAIL', origin));
        if (url.pathname === '/api/auth/reset-password')
          return send(res, 200, await consumeIdentity(input, 'RESET_PASSWORD'));
        if (url.pathname === '/api/auth/verify-email')
          return send(res, 200, await consumeIdentity(input, 'VERIFY_EMAIL'));
        if (url.pathname === '/api/auth/mfa/setup')
          return send(res, 200, await beginMfa(req, input));
        if (url.pathname === '/api/auth/revoke-all') {
          const result = await revokeAll(req);
          res.setHeader(
            'Set-Cookie',
            clearSessionCookie({ secure: process.env.NODE_ENV === 'production' }),
          );
          return send(res, 200, result);
        }
        const user = await finishMfa(req, input);
        const token = await createSession(user.id, { mfaVerified: true });
        res.setHeader(
          'Set-Cookie',
          sessionCookie(token, { secure: process.env.NODE_ENV === 'production' }),
        );
        return send(res, 200, { ok: true });
      }

      if (!process.env.DATABASE_URL)
        return send(res, 403, { error: 'Authentication requires a configured database' });
      if (method === 'GET' && url.pathname === '/api/auth/me') {
        const user = await currentUser(req);
        return user ? send(res, 200, { user }) : send(res, 401, { error: 'Not authenticated' });
      }
      if (
        method === 'POST' &&
        ['/api/auth/register', '/api/auth/login', '/api/auth/logout'].includes(url.pathname)
      ) {
        if (!verifySameOrigin(req)) return send(res, 403, { error: 'Cross-origin request denied' });
        if (!requireJson(req)) return send(res, 415, { error: 'JSON required' });
        if (url.pathname !== '/api/auth/logout') {
          const rate = process.env.DATABASE_URL
            ? await databaseRateLimit('auth:' + clientAddress(req))
            : checkRateLimit('auth:' + clientAddress(req));
          if (!rate.allowed) return send(res, 429, { error: 'Too many attempts' });
        }
        if (url.pathname === '/api/auth/logout') {
          await revokeSession(req);
          res.setHeader(
            'Set-Cookie',
            clearSessionCookie({ secure: process.env.NODE_ENV === 'production' }),
          );
          return send(res, 200, { ok: true });
        }
        const body = await readJson(req);
        const user =
          url.pathname === '/api/auth/register'
            ? await transaction(async (db) => {
                const u = await registerCustomer(body, db);
                await issueIdentityToken(
                  db,
                  u,
                  'VERIFY_EMAIL',
                  process.env.APP_ORIGIN || 'http://127.0.0.1:' + req.socket.localPort,
                );
                return u;
              })
            : await authenticateCustomer(body);
        let mfaVerified = false;
        if (user.mfaEnabled) mfaVerified = await checkMfa(user.id, body.totp);
        await mergeGuest(req, user.id);
        const token = await createSession(user.id, { mfaVerified });
        res.setHeader(
          'Set-Cookie',
          sessionCookie(token, { secure: process.env.NODE_ENV === 'production' }),
        );
        return send(res, url.pathname === '/api/auth/register' ? 201 : 200, { user });
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (method === 'GET' && url.pathname === '/api/health') {
      if (process.env.DATABASE_URL) {
        const { database } = await import('./db.mjs');
        await database().query('SELECT 1');
      }
      return send(res, 200, {
        status: 'ok',
        mode: process.env.DATABASE_URL ? 'DATABASE' : 'DEMO',
        commerce: !!process.env.DATABASE_URL,
        ...(process.env.NODE_ENV === 'test' && process.env.QA_RUN_ID
          ? { testRunId: process.env.QA_RUN_ID }
          : {}),
      });
    }
    if (method === 'GET' && url.pathname === '/api/categories' && process.env.DATABASE_URL)
      return send(res, 200, await categories());
    const operations = await operationsRoutes(req, res, url, readJson);
    if (operations) {
      if (!operations.sent) send(res, operations.status, operations.data);
      return;
    }
    const commerce = await commerceRoutes(req, res, url, readJson);
    if (commerce) {
      if (!commerce.sent) send(res, commerce.status, commerce.data);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/products') {
      const page = Number(url.searchParams.get('page') || 1),
        limit = Number(url.searchParams.get('limit') || 12);
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        page > 10000 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        return send(res, 400, { error: 'Invalid pagination' });
      return send(
        res,
        200,
        process.env.DATABASE_URL
          ? await findProducts({
              search: url.searchParams.get('search') || '',
              category: url.searchParams.get('category') || '',
              sort: url.searchParams.get('sort') || 'featured',
              page,
              limit,
            })
          : listProducts({
              search: url.searchParams.get('search') || '',
              category: url.searchParams.get('category') || '',
              sort: url.searchParams.get('sort') || 'featured',
              page,
              limit,
            }),
      );
    }
    if (
      !process.env.DATABASE_URL &&
      method === 'GET' &&
      url.pathname.startsWith('/api/products/')
    ) {
      const id = decodeURIComponent(url.pathname.slice('/api/products/'.length));
      const p = products.find((x) => x.id === id);
      return p
        ? send(res, 200, { ...p, mode: 'DEMO' })
        : send(res, 404, { error: 'Product not found' });
    }
    if (method === 'POST' && url.pathname === '/api/checkout/quote') {
      if (!requireJson(req)) return send(res, 415, { error: 'JSON required' });
      const body = await readJson(req);
      return send(
        res,
        200,
        process.env.DATABASE_URL ? await quoteDatabaseCart(body?.items) : quoteCart(body?.items),
      );
    }
    if (process.env.DATABASE_URL && method === 'GET' && url.pathname.startsWith('/api/products/'))
      return send(res, 200, await findProduct(decodeURIComponent(url.pathname.slice(14))));
    if (method === 'GET' && url.pathname === '/api/admin/me') {
      if (!process.env.DATABASE_URL) return send(res, 403, { error: 'Database required' });
      const user = await requireOwner(req);
      return send(res, 200, { user, mode: 'OWNER' });
    }
    const adminResponse = await handleAdminProducts(req, url.pathname, readJson);
    if (adminResponse) return send(res, adminResponse.status, adminResponse.data);
    if (
      url.pathname.startsWith('/api/admin') ||
      url.pathname === '/api/orders' ||
      url.pathname.startsWith('/api/payments')
    )
      return send(res, 403, { error: 'Unavailable in demo mode' });
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    const known =
      e instanceof Error &&
      /^(Invalid|Unsupported|Cart |Duplicate |Unknown |Insufficient |Stock |Total |Request too large|Password must|Account already exists|Invalid credentials|Forbidden|Product not found|Category not found|Multi-variant editing)/.test(
        e.message,
      );
    const status =
      req.url?.split('?')[0] === '/api/health'
        ? 503
        : e?.code === 'ENOENT'
          ? 404
          : e instanceof URIError
            ? 400
            : ['23505', '23514', '40P01', '55P03'].includes(e?.code)
              ? 409
              : Number.isInteger(e?.status)
                ? e.status
                : known
                  ? 400
                  : 500;
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: 'request_failed',
          requestId: res.getHeader('X-Request-ID'),
          code: e?.code || 'INTERNAL',
        }),
      );
    const safe =
      status >= 500
        ? 'Internal server error'
        : e?.code === '23505'
          ? 'A record with this identifier already exists'
          : ['23514', '40P01', '55P03'].includes(e?.code)
            ? 'Concurrent update or record constraint conflict; review and retry'
            : e?.code === 'ENOENT'
              ? 'Not found'
              : e instanceof URIError
                ? 'Invalid URL'
                : e instanceof Error
                  ? e.message
                  : 'Bad request';
    return send(res, status, { error: safe });
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 40;
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  validateConfiguration();
  server.listen(port, process.env.BIND_HOST || '127.0.0.1', () =>
    console.log(
      'NovaCart ' +
        (process.env.DATABASE_URL ? 'DATABASE' : 'DEMO') +
        ' application listening on configured port ' +
        port,
    ),
  );
  const stopJobs =
    process.env.DATABASE_URL && process.env.RUN_JOBS !== 'false' ? startJobs() : () => {};
  const stop = () => {
    stopJobs();
    server.close(() => closeDatabase().finally(() => process.exit(0)));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
