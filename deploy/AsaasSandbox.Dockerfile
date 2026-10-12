FROM node:24-bookworm-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node backend ./backend
COPY --chown=node:node public/sim ./public/sim
RUN mkdir -p /var/lib/shape-sandbox && chown node:node /var/lib/shape-sandbox
ENV NODE_ENV=test SIM_BACKEND_PORT=5191
USER node
EXPOSE 5191
CMD ["node", "backend/asaas-sandbox-server.mjs"]
