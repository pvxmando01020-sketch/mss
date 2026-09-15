FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build -w @mss/web
CMD ["npm", "run", "start", "-w", "@mss/web"]
