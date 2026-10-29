-- Separate additive development migration. Requires data-model.sql first.
-- Session secrets are never stored in plaintext. Use SHA-256 token digests.
CREATE TABLE IF NOT EXISTS user_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_sha256 char(64) NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 last_seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx ON user_sessions(user_id,expires_at) WHERE revoked_at IS NULL;
-- Owner accounts must be provisioned through a controlled administrative process.
-- Public registration always creates CUSTOMER and must never accept role input.
