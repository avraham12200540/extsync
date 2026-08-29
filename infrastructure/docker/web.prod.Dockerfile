# ExtSync Web (Next.js 16) - PRODUCTION image (standalone output).
FROM node:24-slim AS builder
WORKDIR /app/apps/web
ARG NEXT_PUBLIC_API_URL
ARG GOOGLE_SITE_VERIFICATION
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    GOOGLE_SITE_VERIFICATION=${GOOGLE_SITE_VERIFICATION} \
    NEXT_TELEMETRY_DISABLED=1
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web ./
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN useradd -m -u 1001 nextjs
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
