FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
