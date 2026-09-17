# Works on Fly, Render, Railway, Cloud Run — anywhere that takes a container.
FROM node:22-slim

WORKDIR /app

# Dependencies first, so edits to the deck don't invalidate the install layer
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Hosts set PORT themselves; server.js already reads it
ENV NODE_ENV=production
EXPOSE 4400

CMD ["node", "server.js"]
