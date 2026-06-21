# Use official Node.js runtime
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production && npm cache clean --force

COPY index.js ./

CMD ["node", "index.js"]
