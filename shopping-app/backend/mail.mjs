import nodemailer from 'nodemailer';
import { database, transaction } from './db.mjs';
import { open, fail } from './validation.mjs';
export async function deliverMail({ transport } = {}) {
  if (!transport && !process.env.SMTP_URL) return { sent: 0, blocked: true };
  if (!transport) {
    const url = new URL(process.env.SMTP_URL);
    if (!['smtp:', 'smtps:'].includes(url.protocol) || url.search || url.hash)
      fail('Invalid SMTP configuration', 503);
    transport = nodemailer.createTransport({
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'smtps:' ? 465 : 587)),
      secure: url.protocol === 'smtps:',
      requireTLS: true,
      auth: url.username
        ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
        : undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    });
  }
  const rows = await transaction(async (db) => {
    const found = await db.query(
      "SELECT * FROM mail_outbox WHERE status='PENDING' AND attempts<3 ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED",
    );
    for (const row of found.rows)
      await db.query("UPDATE mail_outbox SET status='SENDING',attempts=attempts+1 WHERE id=$1", [
        row.id,
      ]);
    return found.rows;
  });
  let sent = 0;
  for (const row of rows) {
    try {
      const payload = open(row.encrypted_payload, 'mail');
      if (payload.marketing) {
        const consent = (
          await database().query(
            'SELECT marketing FROM notification_preferences WHERE user_id=$1',
            [row.user_id],
          )
        ).rows[0];
        if (!consent?.marketing) {
          await database().query("UPDATE mail_outbox SET status='SUPPRESSED' WHERE id=$1", [
            row.id,
          ]);
          continue;
        }
      }
      await transport.sendMail({
        from: process.env.MAIL_FROM || 'NovaCart Development <noreply@example.test>',
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
      });
      await database().query("UPDATE mail_outbox SET status='SENT',sent_at=now() WHERE id=$1", [
        row.id,
      ]);
      sent++;
    } catch {
      await database().query("UPDATE mail_outbox SET status='UNKNOWN' WHERE id=$1", [row.id]);
    }
  }
  return { sent, blocked: false };
}
