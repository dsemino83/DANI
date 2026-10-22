# Frontend: SPA en JavaScript (módulos ES, sin build) servida por Nginx.
FROM nginx:1.27-alpine
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template
COPY 40-config-runtime.sh /docker-entrypoint.d/40-config-runtime.sh
RUN chmod +x /docker-entrypoint.d/40-config-runtime.sh && rm -f /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html
