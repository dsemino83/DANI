# Frontend (SPA). Por ahora sirve un placeholder: reemplazar public/ por el build de la SPA
# (React o Angular) que implementa las pantallas del prototipo y hace login OIDC + PKCE.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html
