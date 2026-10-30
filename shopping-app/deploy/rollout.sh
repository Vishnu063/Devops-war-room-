#!/bin/sh
# Manually invoked on an explicitly approved host; never creates resources remotely.
set -eu
: "${CONFIRM_PREVIEW_ROLLOUT:?Set explicit confirmation to yes}"
[ "$CONFIRM_PREVIEW_ROLLOUT" = yes ]
: "${APP_IMAGE:?Use a reviewed immutable image digest}"
: "${PREVIEW_ENV_FILE:?Set private Compose environment path}"
: "${PREVIEW_SMOKE_URL:?Set approved HTTPS health URL}"
printf '%s\n' "$APP_IMAGE" | LC_ALL=C grep -Eq '^ghcr.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$'
: "${PREVIEW_CURL_CONFIG:?Set private CA/auth curl configuration}"
[ -r "$PREVIEW_CURL_CONFIG" ]
[ -r "$PREVIEW_ENV_FILE" ]
command -v jq >/dev/null
# Validate every input and existing configuration before mutation. No migrations/seeds.
docker compose --env-file "$PREVIEW_ENV_FILE" config --quiet
umask 077
CONFIG_FILE=$(mktemp)
trap 'rm -f "$CONFIG_FILE"' EXIT
docker compose --env-file "$PREVIEW_ENV_FILE" config --format json > "$CONFIG_FILE"
jq -e '.services["novacart-app"].environment as $e | $e.RELEASE_MODE == "preview" and $e.ACCEPT_LIVE_ORDERS == "false" and $e.ALLOW_PREVIEW_ORDERS == "false" and $e.ALLOW_LIVE_PAYMENTS == "false"' "$CONFIG_FILE" >/dev/null
docker compose --env-file "$PREVIEW_ENV_FILE" pull novacart-app
docker compose --env-file "$PREVIEW_ENV_FILE" up -d --no-deps --wait novacart-app
docker compose --env-file "$PREVIEW_ENV_FILE" restart nginx
# Authentication comes from a private curl configuration, never command arguments.
curl --proto '=https' --tlsv1.2 --config "$PREVIEW_CURL_CONFIG" --fail --silent --show-error "$PREVIEW_SMOKE_URL"
