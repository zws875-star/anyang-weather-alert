FROM node:20-alpine

WORKDIR /app

COPY index.js package.json ./

CMD ["node", "index.js"]
