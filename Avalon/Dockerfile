FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY public ./public
COPY src ./src
COPY tests ./tests

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
