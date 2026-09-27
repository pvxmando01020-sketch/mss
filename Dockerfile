FROM node:22-alpine AS base
WORKDIR /app

# أدوات للمراقبة + انتظار DB + healthcheck
RUN apk add --no-cache curl tini postgresql-client

# تثبيت الاعتماديات أولاً للاستفادة من cache
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts 2>/dev/null || true

# نسخ باقي المشروع (يُستثنى عبر .dockerignore)
COPY . .

# مستخدم غير جذري
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3000/health | grep -q '"ok":true' || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]

LABEL org.opencontainers.image.title="mss-ai-gateway" \
      org.opencontainers.image.version="1.1.0" \
      org.opencontainers.image.description="MSS AI Gateway 1+2+3+5 — code/vibe error learning"
