FROM node:22-alpine
ENV NODE_ENV=development HEALTH_PORT=4100
WORKDIR /app
COPY services/worker/src ./
EXPOSE 4100
CMD ["node", "/app/entrypoint.mjs"]
