FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /data && chown node:node /data
COPY --chown=node:node server.js growth.js ai-errors.js ./
COPY --chown=node:node public ./public
USER node
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/app.sqlite
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--use-env-proxy", "server.js"]
