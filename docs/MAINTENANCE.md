# Maintenance & évolutions — Rallye La Trace

> **À lire en premier** pour reprendre ou faire évoluer le projet dans une nouvelle session.
> Conception détaillée : [`_bmad-output/planning-artifacts/`](../_bmad-output/planning-artifacts). Utilisation au quotidien : [`../README.md`](../README.md).

## État de production (22/06/2026)

- **En ligne** : https://app.latrace.bike (participants) · https://app.latrace.bike/admin (organisation).
- **Dépôt** : https://github.com/Mystedge/rallye-latrace (public). Remote `origin` configuré → `git push` direct.
- **Hébergement** : VPS Hostinger `72.61.160.88`, template « Docker and Traefik » (Ubuntu 24.04). Traefik existant en **host mode** (conteneur `traefik-traefik-1`).
- **Image** : reconstruite automatiquement par GitHub Actions à chaque push sur `main` → `ghcr.io/mystedge/rallye-latrace:latest` (paquet GHCR **public**).
- **Données** : volume Docker `rallye-data:/data` (base SQLite + photos + sauvegardes) → conservées à chaque redéploiement.

## Cycle de mise à jour

1. Modifier le code (dossier `Documents\La Trace`).
2. `git commit` + `git push` → GitHub Actions reconstruit l'image (~30 s).
3. Hostinger : **hPanel → Gestionnaire Docker → projet `latrace` → Redéployer** (récupère la nouvelle image ; données conservées).

> **Auto-seed** : au tout premier démarrage (base vide), l'app crée les 8 binômes + 70 défis et affiche les **codes** dans les Journaux. Les redéploiements suivants ne ré-écrasent rien.

## Topologie de déploiement (réelle)

- Déploiement via l'**interface Gestionnaire Docker** de Hostinger : coller l'URL du `docker-compose.yml`, ou utiliser l'onglet **« Éditeur .yaml »** (aucune ligne de commande requise).
- Le [`docker-compose.yml`](../docker-compose.yml) contient déjà les **labels Traefik** câblés pour ce VPS :
  - réseau : **`latrace_default`** (réseau par défaut du projet — surtout **pas** de réseau custom),
  - entrypoint TLS : `websecure`, certresolver : `letsencrypt`, règle `Host(app.latrace.bike)`, port interne `3000`.
- **Secrets** (dans l'interface Hostinger, jamais dans le dépôt) : `ADMIN_PASSWORD`, `SESSION_SECRET`, `ANTHROPIC_API_KEY` (optionnelle), `RCLONE_DRIVE_TOKEN` (sauvegarde Drive — cf. § Sauvegarde).
- Construction de l'image : [`Dockerfile`](../Dockerfile) + [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml).

## Sauvegarde

Deux niveaux complémentaires :
- **Snapshots de base, dans le volume** : l'app crée un instantané WAL-safe de la base dans `/data/backup` au démarrage puis toutes les 15 min (rotation : 24 derniers). Protège des fausses manips (restaurer une base saine). Ne protège **pas** d'une perte du VPS.
- **Copie hors-VPS vers Google Drive** : le conteneur `rclone` du [`docker-compose.yml`](../docker-compose.yml) pousse `/data/uploads` (photos + vidéos) et `/data/backup` (snapshots) vers ton Drive toutes les 15 min (commande `rclone copy`, additif : ne supprime jamais côté Drive). C'est la vraie protection contre la perte du VPS.

**Activer le Drive (une seule fois) :**
1. Sur ton PC, obtiens un jeton Google pour rclone :
   - installe rclone (Windows : `rclone.exe` depuis rclone.org/downloads), **ou** avec Docker : `docker run --rm -it rclone/rclone authorize "drive"` ;
   - lance `rclone authorize "drive"` → le navigateur s'ouvre → connecte le compte Google voulu → autorise ;
   - rclone affiche un **jeton JSON** (entre accolades) : copie-le entièrement.
2. Hostinger → Gestionnaire Docker → projet `latrace` → variables d'environnement :
   - `RCLONE_DRIVE_TOKEN` = le JSON copié ;
   - (optionnel) `RCLONE_DRIVE_DOSSIER` = nom du dossier Drive cible (défaut `latrace-backup`), `RCLONE_INTERVALLE` = secondes entre deux synchros (défaut 900).
3. **Redéployer**. Tant que `RCLONE_DRIVE_TOKEN` est vide, le conteneur rclone s'arrête proprement (sauvegarde Drive inactive, l'app tourne normalement).

**Vérifier :** logs du conteneur `rclone` (Gestionnaire Docker) → lignes « cycle … OK » ; un dossier `latrace-backup/` apparaît dans le Drive (`uploads/` + `backup/`).

**Restaurer :** récupérer depuis Drive le dernier `backup/rallye-*.db` → le remettre en `/data/rallye.db` ; et le dossier `uploads/` → `/data/uploads/`.

## À finaliser avant l'événement (27-28 juin)

- [ ] Distribuer les **codes des binômes** (visibles dans `/admin → Binômes`, ou les Journaux du 1er boot).
- [ ] Configurer les défis dans `/admin` : énigmes → mode **`auto`** (avec réponse attendue) ; photos → mode **`ia`** (+ renseigner `ANTHROPIC_API_KEY`).
- [ ] Confirmer les points du défi **« Trouve ton cap » (J2)** — mis à 5 pts, non précisés dans le roadbook.
- [ ] **Activer la sauvegarde Drive** : renseigner `RCLONE_DRIVE_TOKEN` dans Hostinger (le mécanisme rclone→Drive est déjà en place — cf. § Sauvegarde — il ne manque que le jeton Google).
- [ ] **Test sur téléphone** : compression photo, file offline (couper le réseau), installation PWA.
- [ ] **Dimanche matin** : basculer « Défis J2 ouverts » dans `/admin → Réglages`.

## Décisions & repères

- Mode de validation **par défaut = `manuel`** sur tous les défis (beaucoup d'énigmes ont une réponse connue seulement de l'orga). À affiner en admin.
- Refus automatique **non visible** du participant (mode `auto`).
- IA = **pré-tri** uniquement (l'humain tranche), avec **interrupteur global** dans Réglages ; modèle `claude-haiku-4-5`.
- Source de vérité des défis : **`src/data/defis.json`** (chargé par `src/seed.js`).

## Pièges rencontrés (à ne pas reproduire)

- **`.gitignore`** : ancrer les dossiers runtime à la racine (`/data/`, pas `data/`) — sinon `src/data/defis.json` est exclu de l'image et l'app crash au boot (`ENOENT … defis.json`).
- **Réseau Traefik** : ne pas créer de réseau custom dans le compose (conflit « le réseau existe déjà ») → utiliser `latrace_default`.
- **Paquet GHCR** : doit être **public** (sinon Hostinger ne peut pas pull l'image).
- **Terminal Hostinger** : `docker` nécessite **`sudo`**.

## Déploiement alternatif (hors Hostinger)

Le dépôt contient aussi un [`Caddyfile`](../Caddyfile) + [`ecosystem.config.cjs`](../ecosystem.config.cjs) (pm2) pour un déploiement classique sans panel — voir `README.md` § « Sans Docker ».
