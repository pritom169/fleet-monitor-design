# One image for the ingest server, the registry seed and the MQTT robot simulator.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY backend backend
COPY frontend frontend
RUN npm run build -w frontend
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "backend/src/server/main.ts"]
