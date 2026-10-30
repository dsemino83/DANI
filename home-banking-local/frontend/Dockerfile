# Frontend: SPA en JavaScript (módulos ES, sin build) servida por Nginx.
FROM nginx:1.27-alpine
# openssl: genera un certificado autofirmado al arrancar si frontend/certs está vacío (30-certificado.sh)
RUN apk add --no-cache openssl && rm -f /etc/nginx/conf.d/default.conf
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 30-certificado.sh /docker-entrypoint.d/30-certificado.sh
COPY public /usr/share/nginx/html
