ALTER TABLE orders ADD COLUMN coupon_released_at timestamptz;
ALTER TABLE refunds ADD COLUMN manual_reference text;
ALTER TABLE carts ADD COLUMN recovery_notified_at timestamptz;
CREATE INDEX notifications_actor_idx ON notifications(user_id,guest_id,created_at DESC);
CREATE INDEX reservations_expiry_idx ON orders(reservation_expires_at) WHERE status='PENDING_PAYMENT';
CREATE INDEX mail_pending_idx ON mail_outbox(created_at) WHERE status='PENDING';
ALTER TABLE notification_preferences ADD COLUMN personalization boolean NOT NULL DEFAULT false;
ALTER TABLE notification_preferences ADD COLUMN analytics boolean NOT NULL DEFAULT false;
CREATE TABLE daily_events(day date NOT NULL DEFAULT current_date,event text NOT NULL,count bigint NOT NULL DEFAULT 0,PRIMARY KEY(day,event));
