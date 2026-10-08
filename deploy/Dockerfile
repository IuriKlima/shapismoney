FROM node:24-bookworm-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node backend ./backend
COPY --chown=node:node prototype/dev-ai.mjs ./prototype/dev-ai.mjs
COPY --chown=node:node public/sim/persistent.html public/sim/persistent.js public/sim/crm-ui.js public/sim/budget-ui.js public/sim/nutrition-ui.js public/sim/style.css public/sim/logo.svg ./public/sim/
ENV NODE_ENV=production SIM_BACKEND_PORT=5190
USER node
EXPOSE 5190
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 CMD ["node", "backend/healthcheck.mjs"]
CMD ["node", "backend/server.mjs"]
