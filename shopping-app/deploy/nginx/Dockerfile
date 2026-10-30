ARG NGINX_IMAGE=nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949
FROM ${NGINX_IMAGE}
# This proxy uses only core TLS/HTTP; optional modules and curl are unused.
RUN apk del --no-network curl nginx-module-acme nginx-module-geoip nginx-module-image-filter nginx-module-njs nginx-module-xslt
COPY --chown=1000:1000 nginx.conf /etc/nginx/nginx.conf
COPY --chown=1000:1000 proxy-params.conf /etc/nginx/proxy_params_novacart
COPY --chown=1000:1000 start.sh /usr/local/bin/start-novacart
USER 1000:1000
HEALTHCHECK --interval=5s --timeout=2s --start-period=5s --retries=6 CMD ["wget","-Y","off","-q","-O","/dev/null","http://127.0.0.1:8080/proxy-health"]
ENTRYPOINT ["/usr/local/bin/start-novacart"]
