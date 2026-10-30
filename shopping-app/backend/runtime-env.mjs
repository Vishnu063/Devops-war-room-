// Load explicitly mounted secrets before application modules execute.
import { readFileSync } from 'node:fs';
for (const name of [
  'DATABASE_URL',
  'DATA_ENCRYPTION_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'SMTP_URL',
  'MAIL_FROM',
  'BACKUP_ENCRYPTION_KEY',
  'BACKUP_UPLOAD_TOKEN',
]) {
  if (process.env[name + '_FILE']) {
    if (process.env[name]) throw new Error('Conflicting secret bindings for ' + name);
    const value = readFileSync(process.env[name + '_FILE'], 'utf8').trim();
    if (!value || value.length > 16384) throw new Error('Invalid secret binding for ' + name);
    process.env[name] = value;
  }
}
