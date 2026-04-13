FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY lib ./lib
COPY public ./public
COPY server.js ./

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["npm", "start"]
