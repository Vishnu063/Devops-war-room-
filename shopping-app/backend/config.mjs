export function validateConfiguration() {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol))
      throw new Error('PostgreSQL DATABASE_URL required');
    if (!/^[0-9a-f]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY || ''))
      throw new Error('DATA_ENCRYPTION_KEY must be a private 32-byte hex key');
  }
  if (process.env.APP_ORIGIN) {
    const origin = new URL(process.env.APP_ORIGIN);
    if (
      origin.origin !== process.env.APP_ORIGIN ||
      origin.username ||
      origin.password ||
      !['http:', 'https:'].includes(origin.protocol)
    )
      throw new Error('APP_ORIGIN must be a canonical HTTP(S) origin');
  }
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.DATABASE_URL || !process.env.APP_ORIGIN?.startsWith('https://'))
  )
    throw new Error('Production requires a database and explicit HTTPS APP_ORIGIN');
  for (const [name, low, high] of [
    ['AUTH_RATE_MAX', 1, 1000],
    ['RETURN_WINDOW_DAYS', 0, 365],
    ['COD_MAX_PAISE', 1, 100000000000],
  ])
    if (process.env[name] !== undefined) {
      const value = Number(process.env[name]);
      if (!Number.isSafeInteger(value) || value < low || value > high)
        throw new Error('Invalid ' + name);
    }
}
