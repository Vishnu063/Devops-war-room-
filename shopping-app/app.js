import { payOrder } from './payment-ui.js';
import { refreshAccount, identityLink, field, form, openSupport } from './account.js';
import { $, api, node, button, money, notify, closeButtons } from './ui.js';
const compared = new Set();
let products = [],
  categories = [],
  user = null,
  cart = [],
  wish = [],
  category = '',
  search = '',
  sort = 'featured',
  page = 1,
  total = 0,
  sequence = 0,
  databaseMode = false,
  quote = null,
  pendingCheckout = null;
const placeholder = '/assets/product-placeholder.svg';
function image(name, src = placeholder, cls = '') {
  const img = node('img', cls);
  img.src = src;
  img.alt = name;
  img.loading = 'lazy';
  img.width = 360;
  img.height = 300;
  return img;
}
async function ensureSession() {
  try {
    user = (await api('/api/auth/me')).user;
  } catch (e) {
    if (e.status !== 401) throw e;
    user = null;
    await api('/api/guest', 'POST', {});
  }
  $('accountButton').textContent = user ? user.name.split(' ')[0].slice(0, 18) : 'Account';
  $('logoutButton').hidden = !user;
  await refreshAccount(user);
}
async function refreshShopping() {
  const [c, w] = await Promise.all([api('/api/cart'), api('/api/wishlist')]);
  cart = c.items;
  wish = w.items;
  $('cartCount').textContent = cart.reduce((n, x) => n + x.quantity, 0);
  $('wishlistCount').textContent = wish.length;
}
function renderFilters() {
  const box = $('filters');
  box.replaceChildren();
  for (const c of [{ slug: '', name: 'All' }, ...categories]) {
    const b = button(c.name, async () => {
      category = c.name === 'All' ? '' : c.name;
      page = 1;
      renderFilters();
      await renderProducts();
    });
    b.classList.toggle('active', category === (c.name === 'All' ? '' : c.name));
    b.setAttribute('aria-pressed', String(category === (c.name === 'All' ? '' : c.name)));
    box.append(b);
  }
}
async function renderProducts() {
  const run = ++sequence;
  $('catalogStatus').textContent = 'Loading products…';
  try {
    const q = new URLSearchParams({ search, category, sort, page: String(page), limit: '8' });
    const data = await api('/api/products?' + q);
    if (run !== sequence) return;
    products = data.items;
    total = data.total;
    const grid = $('productGrid');
    grid.replaceChildren();
    $('empty').hidden = products.length > 0;
    for (const p of products) {
      const card = node('article', 'productCard'),
        picture = node('div', 'productImage');
      picture.append(
        image(p.image?.alt || 'Illustration — ' + p.name, p.image?.src || placeholder),
      );
      const saved = wish.some((w) => w.id === p.id);
      const heart = button(
        saved ? '♥' : '♡',
        async () => {
          await api('/api/wishlist/' + p.id, saved ? 'DELETE' : 'PUT', {});
          await refreshShopping();
          await renderProducts();
          notify('Wishlist updated');
        },
        'heart' + (saved ? ' saved' : ''),
      );
      heart.setAttribute('aria-label', (saved ? 'Remove from' : 'Add to') + ' wishlist: ' + p.name);
      heart.disabled = !databaseMode;
      picture.append(heart);
      const info = node('div', 'productInfo'),
        title = button(p.name, () => showProduct(p.id), 'productTitle');
      info.append(title, node('small', '', p.category));
      const add = button(
        p.stock > 0 ? 'Add to bag +' : 'Out of stock',
        async () => {
          await addToCart(p.variant_id || p.variantId);
          notify(p.name + ' added to bag');
        },
        'add',
      );
      add.disabled = !databaseMode || p.stock <= 0;
      const compare = node('label', 'small', 'Compare'),
        check = node('input');
      check.type = 'checkbox';
      check.checked = compared.has(p.id);
      check.setAttribute('aria-label', 'Compare ' + p.name);
      check.addEventListener('change', () => {
        if (check.checked && compared.size >= 4) {
          check.checked = false;
          notify('Compare up to four products');
          return;
        }
        check.checked ? compared.add(p.id) : compared.delete(p.id);
        $('compareButton').disabled = compared.size < 2;
        $('compareButton').textContent = 'Compare products (' + compared.size + ')';
      });
      compare.append(check);
      card.append(picture, info, node('p', 'price', money(p.pricePaise)), add, compare);
      grid.append(card);
    }
    $('catalogStatus').textContent = total + ' matching products';
    $('pageStatus').textContent = 'Page ' + page + ' of ' + Math.max(1, Math.ceil(total / 8));
    $('previousPage').disabled = page <= 1;
    $('nextPage').disabled = page * 8 >= total;
  } catch (e) {
    $('catalogStatus').textContent = 'Catalog unavailable. ' + e.message;
  }
}
async function addToCart(variantId) {
  const current = cart.find((x) => x.variantId === variantId);
  await api('/api/cart', 'PUT', { variantId, quantity: (current?.quantity || 0) + 1 });
  await refreshShopping();
}
async function showProduct(id) {
  try {
    const p = await api('/api/products/' + encodeURIComponent(id));
    $('detailTitle').textContent = p.name;
    const body = $('productDetail');
    body.replaceChildren();
    body.append(
      image(
        p.images?.[0]?.alt || 'Illustration — ' + p.name,
        p.images?.[0]?.src || placeholder,
        'detailImage',
      ),
      node('p', 'eyebrow', p.category),
      node('p', '', p.description),
    );
    const variants = p.variants || [
      { variantId: p.id, pricePaise: p.pricePaise, stock: p.stock, sku: p.sku },
    ];
    const label = node('label', '', 'Choose variant'),
      select = node('select');
    for (const v of variants) {
      const option = node(
        'option',
        '',
        v.sku +
          ' ' +
          Object.values(v.attributes || {}).join(' / ') +
          ' · ' +
          money(v.pricePaise) +
          ' · ' +
          v.stock +
          ' available',
      );
      option.value = v.variantId;
      select.append(option);
    }
    label.append(select);
    const add = button(
      'Add selected variant',
      async () => {
        await addToCart(select.value);
        notify('Added to bag');
      },
      'primary',
    );
    add.disabled = !databaseMode || variants.every((v) => v.stock <= 0);
    body.append(label, add, node('h3', '', 'Customer reviews'));
    if (!p.reviews?.length) body.append(node('p', 'muted', 'No published reviews.'));
    for (const r of p.reviews || []) body.append(node('p', '', r.rating + '/5 — ' + r.body));
    if (user) {
      const form = node('form'),
        rating = node('select'),
        review = node('textarea');
      rating.setAttribute('aria-label', 'Rating');
      for (let i = 1; i <= 5; i++) {
        const option = node('option', '', i + ' stars');
        option.value = i;
        rating.append(option);
      }
      review.setAttribute('aria-label', 'Review');
      review.required = true;
      review.minLength = 10;
      review.maxLength = 2000;
      const submit = node('button', '', 'Submit review for moderation');
      form.append(rating, review, submit);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/products/' + p.id + '/reviews', 'POST', {
            rating: Number(rating.value),
            body: review.value,
          });
          notify('Review submitted for moderation');
          form.reset();
        } catch (error) {
          notify(error.message);
        }
      });
      body.append(form);
    }
    const questionForm = form(
      [
        field('Ask about this product', 'question', {
          type: 'textarea',
          minLength: 10,
          maxLength: 1000,
        }),
      ],
      'Submit question',
      async (data) => {
        await api('/api/products/' + p.id + '/questions', 'POST', data);
        notify('Question submitted for moderation');
      },
    );
    if (user) body.append(questionForm);
    if (p.questions?.length) {
      body.append(node('h3', '', 'Questions and answers'));
      for (const q of p.questions) body.append(node('p', '', q.question), node('p', '', q.answer));
    }
    if (databaseMode) {
      const related = await api('/api/products/' + p.id + '/recommendations');
      if (related.items.length) {
        body.append(node('h3', '', 'More from this category'));
        for (const item of related.items)
          body.append(button(item.name, () => showProduct(item.id)));
      }
      if (user) await api('/api/recent', 'POST', { productId: p.id });
    }
    document.title = p.name + ' | NovaCart';
    $('productDialog').showModal();
  } catch (e) {
    notify(e.message);
  }
}
async function showDrawer(mode) {
  const root = $('drawerContent'),
    foot = $('drawerFooter');
  root.replaceChildren();
  foot.replaceChildren();
  $('drawerTitle').textContent =
    mode === 'cart' ? 'Your bag' : mode === 'wish' ? 'Your wishlist' : 'Your orders';
  $('drawer').showModal();
  root.textContent = 'Loading…';
  try {
    await refreshShopping();
    root.replaceChildren();
    if (mode === 'orders') {
      await renderOrders(root);
      return;
    }
    const list = mode === 'cart' ? cart : wish;
    if (!list.length)
      root.append(
        node('p', 'muted', mode === 'cart' ? 'Your bag is empty.' : 'No saved favorites yet.'),
      );
    for (const p of list) {
      const row = node('div', 'drawerItem'),
        info = node('div');
      info.append(node('strong', '', p.name));
      if (mode === 'cart') {
        const quantity = node('input');
        quantity.type = 'number';
        quantity.min = 0;
        quantity.max = 99;
        quantity.value = p.quantity;
        quantity.setAttribute('aria-label', 'Quantity for ' + p.name);
        quantity.addEventListener('change', async () => {
          try {
            await api('/api/cart', 'PUT', {
              variantId: p.variantId,
              quantity: Number(quantity.value),
            });
            await showDrawer('cart');
          } catch (e) {
            notify(e.message);
          }
        });
        info.append(node('p', '', money(p.pricePaise)), quantity);
      }
      const remove = button('Remove', async () => {
        if (mode === 'cart') await api('/api/cart', 'PUT', { variantId: p.variantId, quantity: 0 });
        else await api('/api/wishlist/' + p.id, 'DELETE', {});
        await showDrawer(mode);
        await renderProducts();
      });
      row.append(image('Illustration — ' + p.name), info, remove);
      if (mode === 'wish') info.append(button('View product', () => showProduct(p.id)));
      root.append(row);
    }
    if (mode === 'cart' && cart.length) {
      quote = await api('/api/cart/quote', 'POST', {});
      foot.append(
        node(
          'p',
          '',
          'Subtotal ' + money(quote.subtotalPaise) + ' · Shipping ' + money(quote.shippingPaise),
        ),
        node('strong', '', 'Total ' + money(quote.totalPaise)),
        button(
          'Continue to checkout',
          async () => {
            $('drawer').close();
            await openCheckout();
          },
          'primary',
        ),
      );
    }
  } catch (e) {
    root.textContent = e.message;
  }
}
async function openCheckout() {
  if (!cart.length) return notify('Your bag is empty');
  $('checkoutStatus').textContent = 'Server totals are rechecked before recording the order.';
  $('checkoutTotal').textContent = money(quote.totalPaise);
  $('checkoutDialog').showModal();
}
async function renderOrders(root) {
  const orders = (await api('/api/orders')).items;
  if (!orders.length) root.append(node('p', '', 'No orders recorded.'));
  for (const o of orders) {
    const row = node('article', 'orderCard');
    row.append(
      node('h3', '', o.orderNumber),
      node('p', '', o.status + ' · ' + o.paymentStatus + ' · ' + money(o.totalPaise)),
      button('View order', async () => {
        const detail = await api('/api/orders/' + o.id);
        const section = node('section');
        section.append(node('h3', '', detail.orderNumber));
        for (const item of detail.items)
          section.append(
            node('p', '', item.name + ' × ' + item.quantity + ' — ' + money(item.lineTotalPaise)),
          );
        for (const event of detail.timeline)
          section.append(
            node('p', 'small', new Date(event.created_at).toLocaleString() + ' · ' + event.action),
          );
        for (const s of detail.shipments)
          section.append(
            node(
              'p',
              '',
              s.status +
                ' · ' +
                (s.provider || 'Manual') +
                ' · ' +
                (s.tracking_number || 'Awaiting tracking'),
            ),
          );
        const pdf = node('a', 'primary', 'Download order receipt');
        pdf.href = '/api/orders/' + o.id + '/receipt';
        pdf.download = '';
        section.append(pdf);
        if (detail.status === 'PENDING_PAYMENT' && detail.paymentMethod === 'RAZORPAY')
          section.append(button('Pay using hosted checkout', () => payOrder(detail.id)));
        if (['DELIVERED', 'RETURN_REQUESTED'].includes(detail.status)) {
          section.append(
            form(
              [
                field('Return item', 'orderItemId', {
                  options: detail.items.map((i) => [i.id, i.name]),
                }),
                field('Return quantity', 'quantity', { type: 'number', value: '1' }),
                field('Return reason', 'reason', {
                  type: 'textarea',
                  minLength: 5,
                  maxLength: 1000,
                }),
              ],
              'Request return review',
              async (data) => {
                await fetch('/api/orders/' + o.id + '/returns', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': crypto.randomUUID(),
                  },
                  body: JSON.stringify({ ...data, quantity: Number(data.quantity) }),
                }).then(async (response) => {
                  const body = await response.json();
                  if (!response.ok) throw new Error(body.error);
                });
                notify('Return requested. Refund and restock require a reviewed decision.');
              },
            ),
          );
        }
        for (const refund of detail.refunds)
          section.append(
            node('p', '', 'Refund ' + money(refund.amount_paise) + ' · ' + refund.status),
          );
        row.append(section);
      }),
    );
    if (['PENDING_PAYMENT', 'CONFIRMED', 'PACKING'].includes(o.status))
      row.append(
        button('Cancel order', async () => {
          await api('/api/orders/' + o.id + '/cancel', 'POST', {});
          root.replaceChildren();
          await renderOrders(root);
          await refreshShopping();
        }),
      );
    root.append(row);
  }
}
$('checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget,
    submit = $('placeOrder');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    if (!pendingCheckout) {
      const data = Object.fromEntries(new FormData(form));
      pendingCheckout = {
        key: crypto.randomUUID(),
        body: {
          items: cart.map((x) => ({ variantId: x.variantId, quantity: x.quantity })),
          address: {
            recipient: data.recipient,
            phone: data.phone,
            line1: data.line1,
            line2: data.line2,
            city: data.city,
            state: data.state,
            pincode: data.pincode,
          },
          paymentMethod: data.paymentMethod,
          couponCode: data.couponCode || undefined,
          useStoreCredit: data.useStoreCredit === 'on',
        },
      };
    }
    const response = await fetch('/api/orders', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pendingCheckout.key },
      body: JSON.stringify(pendingCheckout.body),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status < 500) pendingCheckout = null;
      throw new Error(result.error || 'Order result uncertain; retry the same request');
    }
    pendingCheckout = null;
    form.reset();
    $('checkoutDialog').close();
    await refreshShopping();
    await showDrawer('orders');
    notify('Order ' + result.orderNumber + ' recorded. No online payment was collected.');
  } catch (error) {
    $('checkoutStatus').textContent = error.message;
    if (pendingCheckout)
      $('checkoutStatus').textContent += ' Retry preserves the same order request and key.';
  } finally {
    submit.disabled = false;
    for (const control of form.elements)
      if (control !== submit) control.disabled = !!pendingCheckout;
  }
});
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget)),
    register = $('registerChoice').checked;
  try {
    await api('/api/auth/' + (register ? 'register' : 'login'), 'POST', {
      email: data.email,
      password: data.password,
      ...(register ? { name: data.name } : {}),
      ...(data.totp ? { totp: data.totp } : {}),
    });
    await ensureSession();
    await refreshShopping();
    $('accountDialog').close();
    e.currentTarget.reset();
    await renderProducts();
    notify('Signed in');
  } catch (error) {
    $('authStatus').textContent = error.message;
  }
});
$('logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', 'POST', {});
    await ensureSession();
    await refreshShopping();
    await renderProducts();
    notify('Signed out');
  } catch (e) {
    notify(e.message);
  }
});
$('accountButton').addEventListener('click', () => {
  $('accountDialog').showModal();
});
$('cartButton').addEventListener('click', () => showDrawer('cart'));
$('wishlistButton').addEventListener('click', () => showDrawer('wish'));
$('ordersButton').addEventListener('click', () => showDrawer('orders'));
$('closeProduct').addEventListener('click', () => $('productDialog').close());
$('closeDrawer').addEventListener('click', () => $('drawer').close());
$('sortSelect').addEventListener('change', async (e) => {
  sort = e.target.value;
  page = 1;
  await renderProducts();
});
$('searchInput').addEventListener('input', (e) => {
  search = e.target.value.trim();
  page = 1;
  clearTimeout(renderProducts.timer);
  renderProducts.timer = setTimeout(renderProducts, 250);
});
$('previousPage').addEventListener('click', () => {
  page--;
  renderProducts();
});
$('nextPage').addEventListener('click', () => {
  page++;
  renderProducts();
});
$('searchButton').addEventListener('click', () => {
  $('shop').scrollIntoView();
  $('searchInput').focus();
});
document.querySelectorAll('[data-category]').forEach((a) =>
  a.addEventListener('click', () => {
    category = a.dataset.category;
    page = 1;
    renderFilters();
    renderProducts();
  }),
);
closeButtons();
async function start() {
  try {
    const health = await api('/api/health');
    databaseMode = health.mode === 'DATABASE';
    if (databaseMode) {
      await ensureSession();
      categories = (await api('/api/categories')).items;
      await refreshShopping();
    } else {
      $('previewNotice').textContent =
        'Offline catalog demonstration. Start database mode for accounts, carts and orders.';
    }
    renderFilters();
    await renderProducts();
    if (databaseMode) {
      const cms = await api('/api/content');
      const home = cms.items.find((x) => x.key === 'homepage');
      if (home) {
        document.querySelector('.hero h1').textContent = home.value.title;
        document.querySelector('.intro').textContent = home.value.body;
      }
      const campaign = cms.items.find((x) => x.key === 'campaign');
      if (campaign)
        document.querySelector('.announcement').textContent =
          campaign.value.title + ' · ' + campaign.value.body;
      const config = await api('/api/config');
      $('checkoutForm').elements.paymentMethod.options[0].disabled = !config.codEnabled;
      $('checkoutForm').elements.paymentMethod.options[1].disabled = !config.onlineEnabled;
    }
  } catch (e) {
    $('catalogStatus').textContent = 'Application unavailable. ' + e.message;
  }
}
$('compareButton').addEventListener('click', async () => {
  try {
    const result = await api('/api/compare?ids=' + encodeURIComponent([...compared].join(',')));
    $('detailTitle').textContent = 'Compare products';
    const root = $('productDetail');
    root.replaceChildren();
    for (const p of result.items) {
      const section = node('section', 'orderCard');
      section.append(node('h3', '', p.name), node('p', '', p.description));
      for (const v of p.variants)
        section.append(
          node(
            'p',
            '',
            v.sku +
              ' ' +
              Object.values(v.attributes || {}).join(' / ') +
              ' · ' +
              money(v.pricePaise) +
              ' · ' +
              v.stock +
              ' available · ' +
              Object.entries(v.attributes)
                .map(([k, x]) => k + ': ' + x)
                .join(', '),
          ),
        );
      root.append(section);
    }
    $('productDialog').showModal();
  } catch (e) {
    notify(e.message);
  }
});
$('checkoutForm').addEventListener('change', async (e) => {
  if (!['couponCode', 'useStoreCredit'].includes(e.target.name) || pendingCheckout) return;
  try {
    const f = e.currentTarget,
      q = await api('/api/cart/quote', 'POST', {
        couponCode: f.elements.couponCode.value || undefined,
        useStoreCredit: f.elements.useStoreCredit.checked,
      });
    $('checkoutTotal').textContent =
      money(q.payablePaise) +
      ' (discount ' +
      money(q.discountPaise) +
      ', credit ' +
      money(q.creditPaise) +
      ')';
  } catch (error) {
    $('checkoutStatus').textContent = error.message;
  }
});
await start();
await identityLink();
const route = location.pathname;
if (route === '/account') $('accountDialog').showModal();
if (['/cart', '/wishlist', '/orders', '/returns'].includes(route))
  await showDrawer(route === '/cart' ? 'cart' : route === '/wishlist' ? 'wish' : 'orders');
if (route === '/checkout') {
  quote = await api('/api/cart/quote', 'POST', {}).catch(() => null);
  if (quote) await openCheckout();
  else notify('Add products to your bag before checkout');
}
if (route === '/support') await openSupport();
if (['/offers', '/policies'].includes(route)) {
  const root = $('productDetail');
  root.replaceChildren();
  $('detailTitle').textContent = route === '/offers' ? 'Current offers' : 'Policy preview';
  if (route === '/offers') {
    const offers = await api('/api/offers');
    for (const c of offers.items)
      root.append(
        node(
          'p',
          '',
          c.code +
            ' · ' +
            (c.type === 'PERCENT' ? c.value + '%' : money(c.value)) +
            ' off · Minimum ' +
            money(c.minimum_paise),
        ),
      );
    if (!offers.items.length) root.append(node('p', '', 'No active offers.'));
  } else {
    const content = await api('/api/content'),
      policy = content.items.find((x) => x.key === 'policy-preview');
    root.append(
      node(
        'p',
        '',
        policy?.value.body ||
          'Production tax, shipping, returns and legal policies have not been approved. Development orders do not create actual payments or deliveries.',
      ),
    );
  }
  $('productDialog').showModal();
}
if (route === '/categories') $('categories').scrollIntoView();
if (route === '/search') {
  $('shop').scrollIntoView();
  $('searchInput').focus();
}
const initialProduct =
  new URL(location.href).searchParams.get('product') ||
  location.pathname.match(/^\/products\/([^/]+)$/)?.[1];
if (initialProduct) await showProduct(initialProduct);

$('communicationButton').addEventListener('click', () => {
  $('accountButton').click();
  if (user) $('preferencesButton').click();
});
