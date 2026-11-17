FROM node:22-alpine
ENV NODE_ENV=development HEALTH_PORT=4200
WORKDIR /app
COPY services/automation-runner/src ./
EXPOSE 4200
CMD ["node", "/app/entrypoint.mjs"]
