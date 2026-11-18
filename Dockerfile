# --- build the dashboard ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js postcss.config.js tailwind.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# --- runtime: no dev dependencies, no build tools, non-root user ---
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY src/services ./src/services
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server/index.js", "--production"]
