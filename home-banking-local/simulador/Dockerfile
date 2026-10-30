# Simulador del Banco de Valores (solo para usar el Home Banking sin internet). Sin dependencias externas.
FROM node:22.11-alpine3.20
WORKDIR /app
COPY servidor.mjs .
RUN mkdir -p /datos && chown node:node /datos
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/salud >/dev/null || exit 1
CMD ["node", "servidor.mjs"]
