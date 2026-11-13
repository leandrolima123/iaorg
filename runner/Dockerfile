FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=7070
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs ./
EXPOSE 7070
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:7070/health || exit 1
CMD ["node", "server.mjs"]
