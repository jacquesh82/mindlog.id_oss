# mindlog · id — image de production
FROM node:22-bookworm-slim

WORKDIR /app

# Dépendances. better-sqlite3 ne sert plus qu'au script de migration
# (scripts/migrate-to-postgres.ts) ; ces outils permettent sa compilation.
COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Code source
COPY . .

# La base est PostgreSQL (via DATABASE_URL, fourni par docker-compose).
# /app/data ne contient plus que des fichiers (photos, galerie).
ENV PORT=8787
EXPOSE 8787
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tsx directement (pas via npm) : SIGTERM atteint Node → arrêt propre.
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
