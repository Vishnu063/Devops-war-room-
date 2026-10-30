import { $, api, node, button, money, notify } from './ui.js';
import { field, form } from './forms.js';
// Owner operations use the same authenticated, MFA-enforced backend as catalog edits.
const panels = $('ownerPanels');
function view(title) {
  panels.replaceChildren(node('h2', '', title));
  return panels;
}
function card(title) {
  const el = node('article', 'operationCard');
  el.append(node('h3', '', title));
  return el;
}
export function ownerNavigation() {
  const nav = $('ownerNav');
  nav.replaceChildren();
  for (const [name, run] of [
    ['Orders', orders],
    ['Returns and refunds', returns],
    ['Coupons and credit', campaigns],
    ['Homepage content', cms],
    ['Reviews and questions', moderation],
    ['Support', support],
    ['Analytics and audit', analytics],
    ['Categories', categories],
  ])
    nav.append(button(name, run));
}
async function orders() {
  const root = view('Order fulfillment');
  for (const o of (await api('/api/admin/orders')).items) {
    const row = card(o.order_number);
    row.append(
      node('p', '', o.status + ' · ' + o.payment_status + ' · ' + money(o.total_paise)),
      button('View items and delivery address', async () => {
        const detail = await api('/api/admin/orders/' + o.id);
        const section = node('section');
        section.append(
          node('p', '', detail.items.map((i) => i.name + ' × ' + i.quantity).join('; ')),
        );
        if (detail.address)
          section.append(
            node(
              'p',
              '',
              [
                detail.address.recipient,
                detail.address.phone,
                detail.address.line1,
                detail.address.city,
                detail.address.pincode,
              ].join(' · '),
            ),
          );
        row.append(section);
      }),
    );
    if (o.status === 'CONFIRMED')
      row.append(
        button('Mark packing', async () => {
          await api('/api/admin/orders/' + o.id + '/transition', 'POST', { status: 'PACKING' });
          await orders();
        }),
      );
    if (o.status === 'PACKING')
      row.append(
        form(
          [field('Carrier name', 'provider'), field('Tracking reference', 'trackingNumber')],
          'Record shipment',
          async (data) => {
            await api('/api/admin/orders/' + o.id + '/transition', 'POST', {
              status: 'SHIPPED',
              ...data,
            });
            await orders();
          },
        ),
      );
    if (o.status === 'SHIPPED')
      row.append(
        form(
          [
            field(
              'I confirm cash was collected for this COD order (if applicable)',
              'codCollected',
              { type: 'checkbox' },
            ),
          ],
          'Record delivery',
          async (_, f) => {
            await api('/api/admin/orders/' + o.id + '/transition', 'POST', {
              status: 'DELIVERED',
              codCollected: f.elements.codCollected.checked,
            });
            await orders();
          },
        ),
      );
    root.append(row);
  }
  if (root.children.length === 1) root.append(node('p', '', 'No orders yet.'));
}
async function returns() {
  const root = view('Returns and refund records');
  for (const r of (await api('/api/admin/returns')).items) {
    const row = card('Return ' + r.id.slice(0, 8));
    row.append(node('p', '', r.status + ' · Quantity ' + r.quantity + ' · ' + r.reason));
    if (r.status === 'REQUESTED')
      row.append(
        form(
          [
            field('Decision', 'decision', {
              options: [
                ['RECEIVED', 'Returned item received'],
                ['REJECTED', 'Return rejected'],
              ],
            }),
            field('Received item is sellable: restock it', 'restock', { type: 'checkbox' }),
          ],
          'Record return decision',
          async (data, f) => {
            await api('/api/admin/returns/' + r.id, 'PATCH', {
              decision: data.decision,
              restock: f.elements.restock.checked,
            });
            await returns();
          },
        ),
      );
    root.append(row);
  }
  for (const r of (await api('/api/admin/refunds')).items) {
    const row = card('Refund ' + r.id.slice(0, 8));
    row.append(node('p', '', money(r.amount_paise) + ' · ' + r.status + ' · ' + r.request_state));
    if (r.status === 'PENDING') {
      row.append(
        button('Submit to configured online gateway', async () => {
          await api('/api/admin/refunds/' + r.id + '/submit', 'POST', {});
          await returns();
        }),
        form(
          [field('Already-completed cash payout reference', 'reference')],
          'Record offline cash payout',
          async (data) => {
            await api('/api/admin/refunds/' + r.id + '/manual', 'POST', data);
            await returns();
          },
        ),
      );
    }
    root.append(row);
  }
  root.append(
    node(
      'p',
      'muted',
      'Submission is not refund confirmation. Online refunds remain pending until a verified provider event. Offline cash records are owner assertions, not gateway settlements.',
    ),
  );
}
async function campaigns() {
  const root = view('Coupons and owner-issued store credit');
  for (const c of (await api('/api/admin/coupons')).items)
    root.append(
      node(
        'p',
        '',
        c.code +
          ' · ' +
          (c.type === 'PERCENT' ? c.value + '%' : money(c.value)) +
          ' · ' +
          c.usage_count +
          ' uses · ' +
          (c.active ? 'Enabled' : 'Disabled'),
      ),
    );
  root.append(
    form(
      [
        field('Code', 'code', { maxLength: 40 }),
        field('Discount type', 'type', {
          options: [
            ['PERCENT', 'Percentage'],
            ['FIXED', 'Fixed INR'],
          ],
        }),
        field('Discount value', 'value', { type: 'number' }),
        field('Minimum order INR', 'minimum', { type: 'number', value: '0' }),
        field('Usage limit (empty for unlimited)', 'usageLimit', {
          type: 'number',
          required: false,
        }),
        field('Starts at', 'startsAt', { type: 'datetime-local', required: false }),
        field('Ends at', 'endsAt', { type: 'datetime-local', required: false }),
        field('Enabled', 'active', { type: 'checkbox', value: true }),
      ],
      'Save coupon',
      async (data, f) => {
        await api('/api/admin/coupons', 'POST', {
          code: data.code,
          type: data.type,
          value: data.type === 'PERCENT' ? Number(data.value) : inr(data.value),
          minimumPaise: inr(data.minimum),
          usageLimit: data.usageLimit ? Number(data.usageLimit) : null,
          startsAt: data.startsAt ? new Date(data.startsAt).toISOString() : null,
          endsAt: data.endsAt ? new Date(data.endsAt).toISOString() : null,
          active: f.elements.active.checked,
        });
        await campaigns();
      },
    ),
  );
  root.append(
    form(
      [field('Owner-issued credit amount INR', 'amount', { type: 'number' })],
      'Issue gift credit code',
      async (data) => {
        const r = await api('/api/admin/gift-cards', 'POST', { amountPaise: inr(data.amount) });
        root.append(
          node('p', '', 'Private one-time code: ' + r.code),
          node('p', 'muted', r.notice),
        );
      },
    ),
  );
}
async function cms() {
  const root = view('Homepage and campaign content');
  root.append(node('p', '', 'Plain text only. No arbitrary HTML or scripts.'));
  root.append(
    form(
      [
        field('Content block', 'key', {
          options: [
            ['homepage', 'Homepage hero'],
            ['campaign', 'Campaign'],
            ['policy-preview', 'Policy draft'],
          ],
        }),
        field('Title', 'title', { maxLength: 120 }),
        field('Text', 'body', { type: 'textarea', maxLength: 2000 }),
        field('Published', 'enabled', { type: 'checkbox' }),
      ],
      'Save content',
      async (data, f) => {
        await api('/api/admin/content/' + data.key, 'PUT', {
          title: data.title,
          body: data.body,
          enabled: f.elements.enabled.checked,
        });
      },
    ),
  );
}
async function moderation() {
  const root = view('Review and Q&A moderation');
  for (const r of (await api('/api/admin/reviews')).items) {
    const row = card(r.rating + '/5 · ' + r.moderation_status);
    row.append(node('p', '', r.body));
    for (const status of ['APPROVED', 'REJECTED'])
      row.append(
        button(status === 'APPROVED' ? 'Publish review' : 'Reject review', async () => {
          await api('/api/admin/reviews/' + r.id, 'PATCH', { status });
          await moderation();
        }),
      );
    root.append(row);
  }
  for (const q of (await api('/api/admin/questions')).items) {
    const row = card('Product question');
    row.append(
      node('p', '', q.question),
      form(
        [
          field('Answer', 'answer', { type: 'textarea', value: q.answer || '', maxLength: 2000 }),
          field('Publish question and answer', 'approved', { type: 'checkbox', value: q.approved }),
        ],
        'Save answer',
        async (data, f) => {
          await api('/api/admin/questions/' + q.id, 'PATCH', {
            answer: data.answer,
            approved: f.elements.approved.checked,
          });
          await moderation();
        },
      ),
    );
    root.append(row);
  }
}
async function support() {
  const root = view('Customer support');
  for (const t of (await api('/api/admin/support')).items) {
    const row = card(t.subject + ' · ' + t.status);
    for (const m of t.messages) row.append(node('p', '', m.author + ': ' + m.body));
    row.append(
      form(
        [
          field('Reply', 'message', { type: 'textarea', maxLength: 3000 }),
          field('Status', 'status', {
            options: [
              ['WAITING_CUSTOMER', 'Waiting for customer'],
              ['RESOLVED', 'Resolved'],
              ['OPEN', 'Open'],
            ],
          }),
        ],
        'Send reply',
        async (data) => {
          await api('/api/admin/support/' + t.id, 'POST', data);
          await support();
        },
      ),
    );
    root.append(row);
  }
}
async function analytics() {
  const root = view('Operational records');
  const data = await api('/api/admin/analytics');
  root.append(node('p', '', data.scope));
  for (const [name, value] of Object.entries(data.orders))
    root.append(
      node(
        'p',
        '',
        name.replaceAll('_', ' ') + ': ' + (name.endsWith('paise') ? money(value) : value),
      ),
    );
  root.append(node('h3', '', 'Low-stock variants'));
  for (const v of data.lowStock)
    root.append(node('p', '', v.sku + ' · ' + v.available + ' available'));
  const download = node('a', '', 'Download orders CSV');
  download.href = '/api/admin/export/orders';
  download.download = '';
  root.append(download, node('h3', '', 'Audit history'));
  for (const event of (await api('/api/admin/audit')).items)
    root.append(
      node(
        'p',
        'small',
        new Date(event.created_at).toLocaleString() +
          ' · ' +
          event.action +
          ' · ' +
          event.entity_type,
      ),
    );
  root.append(
    button('Run reservation expiry and configured notification maintenance', async () => {
      const r = await api('/api/admin/maintenance', 'POST', {});
      notify(
        'Expired ' +
          r.reservations.expired +
          ' reservations; mail ' +
          (r.mail.blocked ? 'not configured' : r.mail.sent + ' sent'),
      );
    }),
  );
}
async function categories() {
  const root = view('Categories');
  for (const c of (await api('/api/categories')).items)
    root.append(node('p', '', c.name + ' · ' + c.slug));
  root.append(
    form(
      [field('Category name', 'name'), field('URL slug', 'slug')],
      'Save category',
      async (data) => {
        await api('/api/admin/categories', 'POST', data);
        await categories();
      },
    ),
  );
}
export function inr(value) {
  const string = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(string))
    throw new Error('Enter a nonnegative INR amount with at most two decimal places');
  const [whole, fraction = ''] = string.split('.'),
    amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Amount is too large');
  return amount;
}
export async function manageVariants(product) {
  const root = view('Variants for ' + product.name);
  const rows = (await api('/api/admin/products')).items.filter((x) => x.id === product.id);
  for (const row of rows) {
    const section = card(row.sku);
    section.append(
      form(
        [
          field('Price INR', 'price', { value: (Number(row.pricePaise) / 100).toFixed(2) }),
          field('Stock on hand', 'stock', { type: 'number', value: row.stock }),
          field('Sale price INR (empty clears sale)', 'sale', { required: false }),
          field('Sale starts', 'start', { type: 'datetime-local', required: false }),
          field('Sale ends', 'end', { type: 'datetime-local', required: false }),
        ],
        'Save variant and sale',
        async (data) => {
          await api('/api/admin/variants/' + row.variantId, 'PATCH', {
            pricePaise: inr(data.price),
            stock: Number(data.stock),
            salePricePaise: data.sale ? inr(data.sale) : null,
            saleStartsAt: data.start ? new Date(data.start).toISOString() : null,
            saleEndsAt: data.end ? new Date(data.end).toISOString() : null,
          });
          await manageVariants(product);
        },
      ),
    );
    root.append(section);
  }
  root.append(
    form(
      [
        field('New SKU', 'sku'),
        field('Price INR', 'price'),
        field('Stock on hand', 'stock', { type: 'number' }),
        field('Color', 'color', { required: false }),
        field('Size', 'size', { required: false }),
      ],
      'Create additional variant',
      async (data) => {
        await api('/api/admin/products/' + product.id + '/variants', 'POST', {
          sku: data.sku,
          pricePaise: inr(data.price),
          stock: Number(data.stock),
          attributes: Object.fromEntries(
            ['color', 'size'].filter((k) => data[k]).map((k) => [k, data[k]]),
          ),
        });
        await manageVariants(product);
      },
    ),
  );
  root.append(
    form(
      [field('Image path or approved HTTPS URL', 'src'), field('Image alternative text', 'alt')],
      'Set product image',
      async (data) => {
        await api('/api/admin/products/' + product.id + '/images', 'PUT', { images: [data] });
      },
    ),
  );
}
export function bulkImport() {
  const root = view('Import product JSON');
  root.append(
    node(
      'p',
      '',
      'Import an array of 1–50 product objects using the documented fields. Price is integer paise in the import format. Every row is validated; per-row failures are shown. Files are read locally, not stored as uploads.',
    ),
  );
  const input = node('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.setAttribute('aria-label', 'Product import JSON file');
  root.append(
    input,
    button('Import file', async () => {
      const file = input.files?.[0];
      if (!file || file.size > 12000) throw new Error('Choose a JSON file smaller than 12 KB');
      const items = JSON.parse(await file.text());
      const result = await api('/api/admin/products/bulk', 'POST', { items });
      for (const row of result.items)
        root.append(
          node('p', '', row.sku + ' · ' + row.status + (row.error ? ' · ' + row.error : '')),
        );
    }),
  );
}
