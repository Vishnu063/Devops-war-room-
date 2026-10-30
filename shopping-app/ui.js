export const $ = (id) => document.getElementById(id);
export const money = (paise) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(paise) / 100,
  );
export function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
export async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(value.error || 'Request failed'), { status: response.status });
  return value;
}
export function button(label, run, cls = '') {
  const b = node('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await run();
    } catch (e) {
      notify(e.message);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
export function notify(message) {
  const target = $('toast') || $('status');
  target.textContent = message;
  const dialog = document.activeElement?.closest('dialog[open]');
  if (dialog) {
    let feedback = dialog.querySelector('[data-feedback]');
    if (!feedback) {
      feedback = node('p', 'previewNotice');
      feedback.dataset.feedback = 'true';
      feedback.setAttribute('role', 'status');
      dialog.append(feedback);
    }
    feedback.textContent = message;
  }
  target.classList.add('visible');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => target.classList.remove('visible'), 6000);
}
export function closeButtons() {
  document
    .querySelectorAll('[data-close]')
    .forEach((b) => b.addEventListener('click', () => $(b.dataset.close).close()));
  document.querySelectorAll('dialog').forEach((d) =>
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    }),
  );
}
