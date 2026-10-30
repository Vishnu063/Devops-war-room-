# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
ARG APP_RUNTIME_IMAGE=node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
ARG POSTGRES_IMAGE=postgres:16.15-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /opt/novacart/backend
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -s /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --ignore-scripts --strict-ssl=true
COPY . /opt/novacart/
FROM ${APP_RUNTIME_IMAGE} AS app
ENV NODE_ENV=production PORT=3100 BIND_HOST=0.0.0.0 RELEASE_MODE=preview
WORKDIR /opt/novacart/backend
COPY --from=dependencies --chown=node:node /opt/novacart /opt/novacart
# Package managers are build tools and are not needed by the running service.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=8s --start-period=20s --retries=3 CMD ["node","../deploy/scripts/health.mjs"]
CMD ["node","--import","./runtime-env.mjs","server.mjs"]
FROM ${POSTGRES_IMAGE} AS operations
COPY --from=app /usr/local/bin/node /usr/local/bin/node
COPY --from=dependencies --chown=1000:1000 /opt/novacart /opt/novacart
WORKDIR /opt/novacart/backend
RUN mkdir -p /backups && chown 1000:1000 /backups
USER 1000:1000
ENTRYPOINT ["node","--import","./runtime-env.mjs"]
CMD ["../deploy/scripts/backup.mjs"]
