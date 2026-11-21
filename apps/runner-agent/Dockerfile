# syntax=docker/dockerfile:1
# Docker Runner: Chromium + Playwright trong container (cách ly tiến trình/hệ thống tệp khỏi máy chủ).
FROM mcr.microsoft.com/playwright:v1.52.0-noble AS build
WORKDIR /app
COPY apps/runner-agent/package.json apps/runner-agent/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/runner-agent/tsconfig.json apps/runner-agent/tsconfig.build.json ./
COPY apps/runner-agent/src ./src
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.52.0-noble
ENV NODE_ENV=production RUNNER_HEADLESS=1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY apps/runner-agent/package.json ./
USER pwuser
CMD ["node", "dist/index.js"]
