FROM node:22-alpine
ENV NODE_ENV=development PORT=3000
WORKDIR /workspace
COPY apps/web/src /app
EXPOSE 3000
CMD ["node", "/app/entrypoint.mjs"]
