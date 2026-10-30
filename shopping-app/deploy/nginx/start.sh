#!/bin/sh
set -eu
: "${APP_ORIGIN:?Canonical HTTPS origin required}"
printf '%s\n' "$APP_ORIGIN" | LC_ALL=C grep -Eq '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$'
sed "s|NOVACART_ORIGIN|$APP_ORIGIN|g" /etc/nginx/nginx.conf > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
