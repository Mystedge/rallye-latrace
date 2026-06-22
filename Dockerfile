# Image de production — Node LTS Debian slim.
# better-sqlite3 et sharp utilisent des binaires précompilés (glibc x64) : pas de build natif requis.
FROM node:22-bookworm-slim

WORKDIR /app

# Dépendances (couche cachable tant que package*.json ne change pas)
COPY package*.json ./
RUN npm ci --omit=dev

# Code applicatif
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# Données persistées sur un volume (cf. docker-compose.yml)
ENV DB_PATH=/data/rallye.db
ENV UPLOADS_DIR=/data/uploads
ENV BACKUP_DIR=/data/backup

EXPOSE 3000
CMD ["node", "src/server.js"]
