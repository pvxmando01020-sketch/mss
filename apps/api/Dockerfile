FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install
ENV PORT=4000
CMD ["npx", "tsx", "apps/api/src/index.ts"]
