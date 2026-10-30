import { fail } from './validation.mjs';
export const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
export function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
    ...(process.env.NODE_ENV === 'production'
      ? { 'strict-transport-security': 'max-age=31536000' }
      : {}),
  });
  res.end(JSON.stringify(data));
}
export async function readRaw(req, max = 65536) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > max) fail('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function readJson(req) {
  if (req.headers['content-encoding']) fail('Encoded requests are not supported', 415);
  try {
    const value = JSON.parse((await readRaw(req, 16384)).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid JSON');
    return value;
  } catch (e) {
    if (e.status) throw e;
    fail('Invalid JSON');
  }
}

export function imagePolicy() {
  const hosts = (process.env.PRODUCT_IMAGE_HOSTS || '')
    .split(',')
    .filter((h) => /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(h));
  let policy = headers['content-security-policy'].replace(
    "img-src 'self'",
    "img-src 'self'" + hosts.map((h) => ' https://' + h).join(''),
  );
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
    policy =
      policy
        .replace("script-src 'self'", "script-src 'self' https://checkout.razorpay.com")
        .replace(
          "connect-src 'self'",
          "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
        ) + '; frame-src https://api.razorpay.com https://checkout.razorpay.com';
  return policy;
}
