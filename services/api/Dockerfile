FROM node:22-alpine
ENV NODE_ENV=development PORT=4000
WORKDIR /workspace
COPY services/api/src /app
EXPOSE 4000
CMD ["node", "/app/entrypoint.mjs"]
