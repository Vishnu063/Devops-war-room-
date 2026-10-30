import { database } from './db.mjs';
import { expireReservations } from './commerce.mjs';
import { abandonedCartBatch } from './customer.mjs';
import { deliverMail } from './mail.mjs';
export async function maintenance() {
  const reservations = await expireReservations();
  await database().query('DELETE FROM auth_attempts WHERE reset_at<now()');
  await database().query("DELETE FROM identity_tokens WHERE expires_at<now()-interval '7 days'");
  await database().query("DELETE FROM user_sessions WHERE expires_at<now()-interval '7 days'");
  return { reservations, recovery: await abandonedCartBatch(), mail: await deliverMail() };
}
export function startJobs() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await maintenance();
    } catch {
      console.error(
        JSON.stringify({
          event: 'maintenance_failed',
          detail: 'Inspect configuration and stored intent states before retrying external work',
        }),
      );
    } finally {
      running = false;
    }
  }, 30000);
  timer.unref();
  return () => clearInterval(timer);
}
