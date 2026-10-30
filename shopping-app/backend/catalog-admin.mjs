import { transaction } from './db.mjs';
import { createAdminProduct, validateProduct } from './admin.mjs';
import { object, text, integer, uuid, fail, audit } from './validation.mjs';
function slug(value) {
  const s = text(value, 'slug', 1, 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) fail('Invalid slug');
  return s;
}
export async function category(actor, input) {
  object(input, ['slug', 'name']);
  return transaction(async (db) => {
    const r = await db.query(
      'INSERT INTO categories(slug,name) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id',
      [slug(input.slug), text(input.name, 'category name', 2, 80)],
    );
    await audit(db, actor, 'CATEGORY_SAVED', 'CATEGORY', r.rows[0].id);
    return r.rows[0];
  });
}
export async function variant(actor, productId, input, id = null) {
  const fields = [
    'sku',
    'pricePaise',
    'stock',
    'attributes',
    'active',
    'salePricePaise',
    'saleStartsAt',
    'saleEndsAt',
  ];
  object(input, fields);
  if (!Object.keys(input).length) fail('Invalid variant update');
  const values = {};
  if (input.sku !== undefined) {
    values.sku = text(input.sku, 'SKU', 3, 80);
    if (!/^[A-Z0-9_-]+$/.test(values.sku)) fail('Invalid SKU');
  }
  for (const k of ['pricePaise', 'stock'])
    if (k in input) values[k] = integer(input[k], k, 0, k === 'stock' ? 1000000 : 100000000000);
  if ('active' in input) {
    if (typeof input.active !== 'boolean') fail('Invalid active flag');
    values.active = input.active;
  }
  if ('attributes' in input) {
    if (
      !input.attributes ||
      typeof input.attributes !== 'object' ||
      Array.isArray(input.attributes) ||
      Object.keys(input.attributes).length > 15
    )
      fail('Invalid variant attributes');
    values.attributes = {};
    for (const [key, value] of Object.entries(input.attributes))
      Object.defineProperty(values.attributes, text(key, 'attribute', 1, 40), {
        value: text(value, 'attribute value', 1, 100),
        enumerable: true,
      });
  }
  if ('salePricePaise' in input)
    values.salePricePaise =
      input.salePricePaise === null
        ? null
        : integer(input.salePricePaise, 'sale price', 0, 100000000000);
  for (const k of ['saleStartsAt', 'saleEndsAt'])
    if (k in input) {
      if (input[k] === null) values[k] = null;
      else {
        const d = new Date(input[k]);
        if (typeof input[k] !== 'string' || !Number.isFinite(+d)) fail('Invalid sale date');
        values[k] = d.toISOString();
      }
    }
  return transaction(async (db) => {
    let row;
    if (id) {
      row = (await db.query('SELECT * FROM variants WHERE id=$1 FOR UPDATE', [uuid(id)])).rows[0];
      if (!row) fail('Variant not found', 404);
    } else {
      const p = await db.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [uuid(productId)]);
      if (!p.rows.length) fail('Product not found', 404);
      if (!values.sku || values.pricePaise === undefined || values.stock === undefined)
        fail('SKU, price and stock are required');
      row = (
        await db.query(
          'INSERT INTO variants(product_id,sku,price_paise,stock_on_hand) VALUES($1,$2,$3,$4) RETURNING *',
          [productId, values.sku, values.pricePaise, values.stock],
        )
      ).rows[0];
    }
    if (values.stock !== undefined && values.stock < row.stock_reserved)
      fail('Stock cannot be below reserved inventory', 409);
    const base = values.pricePaise ?? Number(row.price_paise),
      sale =
        'salePricePaise' in values
          ? values.salePricePaise
          : row.sale_price_paise === null
            ? null
            : Number(row.sale_price_paise);
    if (sale !== null && sale > base) fail('Sale price exceeds base price');
    const start = 'saleStartsAt' in values ? values.saleStartsAt : row.sale_starts_at,
      end = 'saleEndsAt' in values ? values.saleEndsAt : row.sale_ends_at;
    if (start && end && new Date(end) <= new Date(start)) fail('Invalid sale window');
    const columns = {
      sku: 'sku',
      pricePaise: 'price_paise',
      stock: 'stock_on_hand',
      active: 'active',
      attributes: 'attributes',
      salePricePaise: 'sale_price_paise',
      saleStartsAt: 'sale_starts_at',
      saleEndsAt: 'sale_ends_at',
    };
    const params = [],
      updates = [];
    for (const [key, col] of Object.entries(columns))
      if (key in values) {
        params.push(key === 'attributes' ? JSON.stringify(values[key]) : values[key]);
        updates.push(col + '=$' + params.length);
      }
    params.push(row.id);
    if (updates.length)
      await db.query(
        'UPDATE variants SET ' + updates.join(',') + ' WHERE id=$' + params.length,
        params,
      );
    await audit(db, actor, 'VARIANT_SAVED', 'PRODUCT', row.product_id, {
      variantId: row.id,
      fields: Object.keys(values),
    });
    return { id: row.id };
  });
}
export async function productImages(actor, id, input) {
  object(input, ['images']);
  if (!Array.isArray(input.images) || input.images.length > 10) fail('Invalid images');
  const allowedHosts = (process.env.PRODUCT_IMAGE_HOSTS || '')
    .split(',')
    .filter((h) => /^[a-z0-9.-]+$/.test(h));
  const images = input.images.map((i) => {
    object(i, ['src', 'alt']);
    const src = text(i.src, 'image reference', 5, 500),
      alt = text(i.alt, 'alternative text', 3, 200);
    let allowed = /^\/assets\/[a-z0-9_-]+\.(svg|png|webp|jpg)$/.test(src);
    try {
      const u = new URL(src);
      allowed =
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.port &&
        !u.search &&
        !u.hash &&
        allowedHosts.includes(u.hostname);
    } catch {
      /* Local references are deliberately not absolute URLs. */
    }
    if (!allowed) fail('Image must be a local asset or explicitly allowed HTTPS host');
    return { src, alt };
  });
  return transaction(async (db) => {
    const p = await db.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [uuid(id)]);
    if (!p.rows.length) fail('Product not found', 404);
    await db.query('DELETE FROM product_images WHERE product_id=$1', [id]);
    for (const [index, image] of images.entries())
      await db.query(
        'INSERT INTO product_images(product_id,storage_key,alt_text,sort_order) VALUES($1,$2,$3,$4)',
        [id, image.src, image.alt, index],
      );
    await audit(db, actor, 'PRODUCT_IMAGES_SAVED', 'PRODUCT', id);
    return { ok: true };
  });
}
export async function bulkProducts(actor, input) {
  object(input, ['items']);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50)
    fail('Bulk import supports 1–50 products');
  input.items.forEach(validateProduct);
  const results = [];
  for (const item of input.items) {
    try {
      results.push({
        sku: item.sku,
        result: await createAdminProduct(item, actor.id),
        status: 'CREATED',
      });
    } catch (error) {
      results.push({
        sku: item.sku,
        status: 'REJECTED',
        error:
          error.code === '23505'
            ? 'Identifier already exists'
            : error.status && error.status < 500
              ? error.message
              : 'Product rejected',
      });
    }
  }
  return {
    items: results,
    notice:
      'Each product is atomic; per-row failures are reported. No rows are silently treated as imported.',
  };
}
