import { requireOwner } from './identity.mjs';

import { listAdminProducts, createAdminProduct, updateAdminProduct } from './admin.mjs';
import { verifySameOrigin, requireJson } from './security.mjs';
export async function handleAdminProducts(req, pathname, readJson) {
  if (pathname !== '/api/admin/products' && !pathname.startsWith('/api/admin/products/'))
    return null;
  if (!process.env.DATABASE_URL) return { status: 403, data: { error: 'Database required' } };
  const user = await requireOwner(req);
  if (req.method === 'GET' && pathname === '/api/admin/products')
    return { status: 200, data: { items: await listAdminProducts() } };
  if (req.method === 'POST' && pathname === '/api/admin/products') {
    if (!verifySameOrigin(req))
      return { status: 403, data: { error: 'Cross-origin request denied' } };
    if (!requireJson(req)) return { status: 415, data: { error: 'JSON required' } };
    return { status: 201, data: await createAdminProduct(await readJson(req), user.id) };
  }
  if (req.method === 'PATCH' && pathname.startsWith('/api/admin/products/')) {
    if (!verifySameOrigin(req))
      return { status: 403, data: { error: 'Cross-origin request denied' } };
    if (!requireJson(req)) return { status: 415, data: { error: 'JSON required' } };
    return {
      status: 200,
      data: await updateAdminProduct(
        pathname.slice('/api/admin/products/'.length),
        await readJson(req),
        user.id,
      ),
    };
  }
  return { status: 405, data: { error: 'Method not allowed' } };
}
