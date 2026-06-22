#!/usr/bin/env sh
# Mise à jour de l'app sur le VPS : récupère le code et redéploie.
# Les données (base, photos) sont dans un volume Docker -> conservées.
set -e
cd "$(dirname "$0")/.."
git pull
docker compose up -d --build
echo "✓ Mise à jour déployée."
