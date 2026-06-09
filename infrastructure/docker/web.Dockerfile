# ExtSync Web (Next.js) — dev image. For production use `next build` + standalone.
FROM node:20-slim

ENV NODE_ENV=development

WORKDIR /app/apps/web

# Install deps first for layer caching
COPY apps/web/package.json apps/web/package-lock.json* /app/apps/web/
RUN npm install

COPY apps/web /app/apps/web
COPY packages /app/packages

EXPOSE 3000
CMD ["npm", "run", "dev"]
