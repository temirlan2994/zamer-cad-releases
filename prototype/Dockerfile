FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4187 \
    DATA_DIR=/data

COPY package.json server.js index.html app.js styles.css sw.js manifest.webmanifest ./
COPY core ./core
COPY assets ./assets
COPY icons ./icons

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 4187

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4187/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
