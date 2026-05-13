FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=8787

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

RUN mkdir -p data logs

EXPOSE 8787

CMD ["node", "server.js"]
