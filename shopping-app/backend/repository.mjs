import { database } from './db.mjs';
import { effectivePrice, money, fail } from './validation.mjs';
// Parameterized, read-only catalog access to the PostgreSQL schema.
// Prices are integer paise and are never accepted from the browser.
export async function findProducts({
  search = '',
  category = '',
  sort = 'featured',
  page = 1,
  limit = 12,
} = {}) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new Error('Invalid pagination');
  const params = [String(search).trim().slice(0, 120), String(category).trim().slice(0, 80)];
  const from = `FROM products p LEFT JOIN categories c ON c.id=p.category_id JOIN LATERAL (
 SELECT v0.* FROM variants v0 WHERE v0.product_id=p.id AND v0.active ORDER BY (v0.stock_on_hand>v0.stock_reserved) DESC,${effectivePrice.replaceAll('v.', 'v0.')} ASC,v0.id LIMIT 1) v ON TRUE
 WHERE p.active AND ($1='' OR p.title ILIKE '%'||$1||'%' OR EXISTS(SELECT 1 FROM variants sv WHERE sv.product_id=p.id AND sv.active AND sv.sku ILIKE '%'||$1||'%')) AND ($2='' OR lower(c.name)=lower($2) OR c.slug=lower($2))`;
  const order =
    {
      featured: 'p.created_at DESC',
      priceAsc: effectivePrice + ' ASC',
      priceDesc: effectivePrice + ' DESC',
      name: 'p.title ASC',
    }[sort] || 'p.created_at DESC';
  const count = await database().query('SELECT count(*)::int AS total ' + from, params);
  const rows = await database().query(
    `SELECT p.id::text,p.slug,p.title AS name,p.description,c.name AS category,(SELECT jsonb_build_object('src',i.storage_key,'alt',i.alt_text) FROM product_images i WHERE i.product_id=p.id ORDER BY i.sort_order,i.id LIMIT 1) AS image,v.id::text AS variant_id,v.sku,${effectivePrice} AS "pricePaise",(v.stock_on_hand-v.stock_reserved) AS stock ${from} ORDER BY ${order},p.id LIMIT $3 OFFSET $4`,
    [...params, limit, (page - 1) * limit],
  );
  return {
    items: rows.rows.map((r) => ({ ...r, pricePaise: money(r.pricePaise) })),
    total: count.rows[0].total,
    page,
    limit,
    mode: 'DATABASE',
  };
}
export async function quoteDatabaseCart(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50)
    throw new Error('Cart must contain 1–50 lines');
  const seen = new Set(),
    requested = [];
  for (const line of lines) {
    if (
      !line ||
      typeof line.variantId !== 'string' ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 99
    )
      throw new Error('Invalid cart line');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        line.variantId,
      )
    )
      throw new Error('Invalid cart line');
    if (seen.has(line.variantId)) throw new Error('Duplicate variant');
    seen.add(line.variantId);
    requested.push(line.variantId);
  }
  const result = await database().query(
    `SELECT v.id::text AS id,v.sku,p.title AS name,${effectivePrice} AS "pricePaise",(v.stock_on_hand-v.stock_reserved) AS stock
 FROM variants v JOIN products p ON p.id=v.product_id
 WHERE v.id::text=ANY($1::text[]) AND v.active=TRUE AND p.active=TRUE`,
    [requested],
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  let subtotalPaise = 0;
  const items = [];
  for (const line of lines) {
    const p = byId.get(line.variantId);
    if (!p) throw new Error('Unknown or inactive variant');
    if (line.quantity > p.stock) throw new Error('Insufficient stock');
    const unit = Number(p.pricePaise);
    if (!Number.isSafeInteger(unit) || unit < 0) throw new Error('Invalid stored price');
    const lineTotalPaise = unit * line.quantity;
    if (!Number.isSafeInteger(lineTotalPaise)) throw new Error('Total too large');
    subtotalPaise += lineTotalPaise;
    if (!Number.isSafeInteger(subtotalPaise)) throw new Error('Total too large');
    items.push({
      variantId: p.id,
      sku: p.sku,
      name: p.name,
      quantity: line.quantity,
      unitPricePaise: unit,
      lineTotalPaise,
    });
  }
  const shippingPaise = subtotalPaise >= 99900 ? 0 : 7900;
  if (!Number.isSafeInteger(subtotalPaise + shippingPaise)) throw new Error('Total too large');
  return {
    items,
    subtotalPaise,
    shippingPaise,
    taxPaise: 0,
    discountPaise: 0,
    totalPaise: subtotalPaise + shippingPaise,
    currency: 'INR',
    mode: 'DATABASE_QUOTE_ONLY',
  };
}

export async function findProduct(id) {
  if (typeof id !== 'string' || id.length > 120) fail('Invalid product identifier');
  const db = database(),
    p = await db.query(
      'SELECT p.id,p.slug,p.title AS name,p.description,c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE (p.id::text=$1 OR p.slug=$1) AND p.active',
      [id],
    );
  if (!p.rows.length) fail('Product not found', 404);
  const product = p.rows[0];
  const variants = await db.query(
    `SELECT v.id AS "variantId",v.sku,v.attributes,${effectivePrice} AS "pricePaise",v.stock_on_hand-v.stock_reserved AS stock FROM variants v WHERE v.product_id=$1 AND v.active ORDER BY v.price_paise,v.id`,
    [product.id],
  );
  const images = await db.query(
    'SELECT storage_key AS src,alt_text AS alt FROM product_images WHERE product_id=$1 ORDER BY sort_order,id',
    [product.id],
  );
  const reviews = await db.query(
    "SELECT id,rating,body,created_at FROM reviews WHERE product_id=$1 AND moderation_status='APPROVED' ORDER BY created_at DESC LIMIT 50",
    [product.id],
  );
  const questions = await db.query(
    'SELECT id,question,answer FROM product_questions WHERE product_id=$1 AND approved ORDER BY created_at DESC LIMIT 50',
    [product.id],
  );
  return {
    ...product,
    variants: variants.rows.map((v) => ({ ...v, pricePaise: money(v.pricePaise) })),
    images: images.rows,
    reviews: reviews.rows,
    questions: questions.rows,
    mode: 'DATABASE',
  };
}
export async function categories() {
  return { items: (await database().query('SELECT slug,name FROM categories ORDER BY name')).rows };
}

// Compatibility with the newer main-branch API; keep one catalog implementation.
export async function findProductById(id) {
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error('Invalid product ID');
  try {
    return await findProduct(id);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}
