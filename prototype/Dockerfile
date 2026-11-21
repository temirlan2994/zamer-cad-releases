FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4187 \
    DATA_DIR=/data

COPY prototype/package.json prototype/server.js prototype/index.html prototype/app.js prototype/styles.css prototype/sw.js prototype/manifest.webmanifest ./
COPY prototype/core ./core
COPY prototype/assets ./assets
COPY prototype/icons ./icons
COPY shared/cad/*.js ./core/
COPY kepler/core/zip.js ./core/zip.js

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 4187

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4187/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
