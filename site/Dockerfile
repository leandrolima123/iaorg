# Site público do IAORG (só a landing e a lista de interesse). Construir a partir da raiz do projeto:
#   docker build -f site/Dockerfile -t iaorg-site .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data SITE_ROOT=/app

# só as três bibliotecas do navegador (mesmas versões do app)
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund three@0.160.0 @fontsource/archivo@5.3.0 @fontsource/barlow-condensed@5.3.0 \
 && npm cache clean --force

COPY site/server.mjs ./server.mjs
COPY public/landing.html public/privacidade.html public/termos.html public/site.css public/avatars.js ./public/
COPY public/brand ./public/brand
COPY public/videos ./public/videos
COPY public/assets/kaykit/characters ./public/assets/kaykit/characters
COPY public/assets/kaykit/animations ./public/assets/kaykit/animations
COPY public/assets/kaykit/LICENSE-KayKit.txt public/assets/kaykit/LICENSE-KayKit-Skeletons.txt ./public/assets/kaykit/

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
