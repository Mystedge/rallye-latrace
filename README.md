# Rallye La Trace 2026 — application de soumission des défis

Application web mobile-first pour les **8 binômes** du rallye vélo (27-28 juin 2026, Quercy Blanc).
Les binômes soumettent des réponses (texte et/ou photo) aux défis depuis leur téléphone ;
les organisateurs valident et notent, **assistés par une pré-qualification IA** des photos.
Aucun classement n'est visible des participants.

Pensée pour le terrain : **réseau intermittent** (rien n'est perdu, renvoi automatique),
photos lourdes **HEIC** compressées dans le navigateur, interface **gros boutons / fort contraste**.

> Documents de conception : voir [`_bmad-output/planning-artifacts/`](_bmad-output/planning-artifacts) (brief, PRD, architecture, epics & stories).

---

## Prérequis

- **Node.js ≥ 20** (testé sur Node 25).
- Pour le déploiement : un **VPS Linux**, **Caddy** (HTTPS auto) et **pm2** (ou systemd).

## Installation

```bash
npm install
cp .env.example .env      # puis éditer .env (voir ci-dessous)
npm run seed              # crée la base + 8 binômes (avec codes) + 29 défis
npm start                 # http://localhost:3000
```

`npm run seed` affiche les **codes de connexion** des binômes (à distribuer). Il est idempotent
(ré-exécutable sans doublonner ni régénérer les codes existants).

## Configuration (`.env`)

| Variable | Rôle |
|---|---|
| `PORT` | port d'écoute (défaut 3000) |
| `SESSION_SECRET` | secret de signature des cookies de session |
| `DB_PATH` | chemin du fichier SQLite (défaut `./data/rallye.db`) |
| `UPLOADS_DIR` | dossier des photos (défaut `./uploads`) |
| `ADMIN_PASSWORD` | **mot de passe de l'espace admin** (à changer !) |
| `ANTHROPIC_API_KEY` | clé API Claude pour la pré-qualification IA des photos |
| `BACKUP_DIR` | 2e emplacement de sauvegarde (défaut `./backup`) |

Tout a un défaut : l'app démarre sans `.env`, mais **mettez au moins `ADMIN_PASSWORD` et `SESSION_SECRET`** en production.

---

## Côté participant

`http://<hôte>:3000` → saisir le **code du binôme** → liste des défis du jour →
ouvrir un défi → répondre (texte / photo) → **Envoyer**.

- La photo est **compressée dans le navigateur** (≈1600 px, < 1 Mo), orientation EXIF corrigée, HEIC converti en JPEG.
- La réponse est **sauvegardée localement (IndexedDB) avant l'envoi** : si le réseau lâche, elle part automatiquement au retour du réseau (bandeau « en attente d'envoi »).
- Une réponse peut être **modifiée** (elle remplace la précédente).
- Le verdict (validé / refusé) n'est **pas** montré au participant.

L'app est installable (**PWA** : « ajouter à l'écran d'accueil », plein écran).

## Côté admin

`http://<hôte>:3000/admin` → mot de passe (`ADMIN_PASSWORD`).

- **Revue** : file des soumissions, filtrable (binôme / défi / statut / verdict IA), triée « à juger d'abord ».
  Photo en grand, verdict IA + confiance + justification, **Valider / Refuser** en un clic, champ points.
  Validation **en masse** des « bon » haute confiance. Raccourcis : survoler une carte, `V` valide, `R` refuse.
- **Défis** : créer / modifier / supprimer. Champs : titre, consigne, type (photo/texte/mixte),
  **mode de validation**, critère IA, réponse attendue, disponibilité, points, ordre.
- **Binômes** : créer / modifier / supprimer, **régénérer un code**.
- **Classement** : total des points validés par binôme (réservé admin).
- **Réglages** : jour courant, **ouverture des défis J2** (dimanche matin), **interrupteur IA**, **verrouillage final**.

### Les 3 modes de validation (par défi)

| Mode | Comportement |
|---|---|
| `manuel` | jugé entièrement à la main (créativité, photos subjectives) |
| `auto` | réponse **texte/chiffre** comparée à la *réponse attendue* → **validée** (points max) ou **refusée** automatiquement. Surchargeable. |
| `ia` | photo **pré-qualifiée** par Claude (`bon`/`mauvais`/`incertain` + confiance + justification). L'IA ne fait que **pré-trier** ; l'humain tranche. |

### Activer la pré-qualification IA

1. Renseigner `ANTHROPIC_API_KEY` dans `.env`.
2. En admin → Réglages : **IA activée** (interrupteur global ; off = aucune photo n'quitte le VPS).
3. Passer les défis voulus en mode `ia` avec un **critère** clair (ex. « Une borne kilométrique routière est visible »).

Modèle utilisé : `claude-haiku-4-5` (le moins cher/rapide). Coût ≈ **0,002–0,003 € par photo** (< 2 € le week-end).
En cas de panne API, la soumission tombe en file humaine (verdict `erreur`, relançable depuis la revue).

---

## Sauvegarde & restauration

**Le VPS est un point unique de défaillance le week-end.** Une sauvegarde manuelle :

```bash
npm run backup        # = node scripts/backup.js
```

Elle écrit dans `BACKUP_DIR` : un **snapshot horodaté de la base** (à chaud, WAL-safe) + une **copie des photos**,
et garde les 24 derniers snapshots.

**Automatiser (cron horaire pendant l'événement) :**

```cron
0 * * * * cd /opt/rallye && /usr/bin/node scripts/backup.js >> data/backup.log 2>&1
```

> ⚠️ Par défaut `BACKUP_DIR` est un dossier **du même VPS** : cela protège des corruptions / suppressions
> mais **pas** de la perte du VPS. Pour une vraie protection, faites pointer `BACKUP_DIR` vers un autre
> disque, ou synchronisez-le hors-VPS (`rclone` vers Backblaze B2 / Scaleway, ou `rsync` vers une autre machine).
> **À finaliser avant le jour J, et tester une restauration.**

**Restaurer :**

```bash
pm2 stop rallye-latrace                      # ou: systemctl stop rallye
cp backup/rallye-AAAA-MM-JJ_HH-MM-SS.db data/rallye.db
rm -f data/rallye.db-wal data/rallye.db-shm  # repartir du snapshot
cp -r backup/uploads/. uploads/
pm2 start rallye-latrace                      # ou: systemctl start rallye
```

---

## Déploiement (VPS)

### Avec Docker (recommandé — VPS Hostinger)

GitHub + Docker. Les données (base SQLite, photos) vivent dans un **volume** → conservées à chaque mise à jour.

1. **DNS** : enregistrement **A `app.latrace.bike` → IP du VPS**, ports 80 + 443 ouverts.
2. **Sur le VPS** :
   ```bash
   git clone <URL-du-repo> /opt/rallye && cd /opt/rallye
   cp .env.example .env        # éditer : ADMIN_PASSWORD, SESSION_SECRET, ANTHROPIC_API_KEY
   docker compose up -d --build
   docker compose exec app npm run seed     # une seule fois : binômes + défis
   ```
3. **Mise à jour** : `git pull && docker compose up -d --build` (ou `sh deploy/update.sh`).
4. **Sauvegarde** : `docker compose exec app npm run backup` (cron horaire côté hôte) ; le volume contient `/data/backup` à synchroniser hors-VPS avant J0.

> **Traefik** : le `docker-compose.yml` est déjà configuré avec les labels Traefik (pas de service Caddy). Avant le `up`, adapte dans le compose les 3 valeurs marquées `<ADAPTER>` : le **réseau externe** de Traefik (`docker network ls`), l'**entrypoint** TLS (souvent `websecure`) et le nom du **certresolver** (souvent `letsencrypt`). L'upload est borné par l'app (multer 8 Mo), pas besoin de limite côté Traefik.

### Sans Docker (pm2)

1. **DNS** : enregistrement **A `app.latrace.bike` → IP du VPS**, ports 80 + 443 ouverts.
2. **Code + dépendances** :
   ```bash
   git clone <repo> /opt/rallye && cd /opt/rallye
   npm ci
   cp .env.example .env   # éditer (ADMIN_PASSWORD, SESSION_SECRET, ANTHROPIC_API_KEY, BACKUP_DIR…)
   npm run seed
   ```
3. **Process** (pm2) :
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save && pm2 startup     # relance au boot
   ```
   *Alternative systemd* — `/etc/systemd/system/rallye.service` :
   ```ini
   [Unit]
   Description=Rallye La Trace
   After=network.target
   [Service]
   WorkingDirectory=/opt/rallye
   ExecStart=/usr/bin/node src/server.js
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
4. **Caddy** (HTTPS auto) : le [`Caddyfile`](Caddyfile) fourni → `caddy run` (ou service `caddy`).
5. **Sauvegarde** : ajouter le cron horaire (ci-dessus).

---

## Recette (à dérouler avant le jour J)

1. Démarrer, se connecter avec un code binôme, soumettre **un texte** et **une photo** ; vérifier la coche « envoyé ».
2. **Couper le réseau** pendant un envoi photo → vérifier le bandeau « en attente », le **renvoi automatique** au retour.
3. En admin, vérifier que la soumission apparaît, **valider** avec des points, voir le **classement** se mettre à jour.
4. Régler un défi en mode `auto` (réponse attendue) → soumettre une bonne puis une mauvaise réponse → validé/refusé auto.
5. Si IA activée : régler un défi en mode `ia`, soumettre une photo, **calibrer le critère** sur quelques exemples.
6. Activer le **verrou final** → vérifier que les soumissions passent en lecture seule, puis le désactiver.
7. Lancer `npm run backup`, puis **tester une restauration** sur une copie.

---

## Structure du projet

```
src/
  server.js          app Express (monte les routeurs, /sante)
  config.js          configuration (.env + défauts)
  db.js              SQLite (schéma, WAL, paramètres par défaut)
  params.js          réglages + logique des jours (jourEffectif, defiVisible)
  repo.js            accès données (lectures + écritures)
  images.js          traitement photo serveur (sharp : photo + miniature)
  prequalif.js       moteur de validation (auto / IA, file à concurrence limitée)
  ai.js              appel Claude Haiku (vision) — sortie structurée
  seed.js            jeu de données initial (binômes + défis)
  routes/
    participant.js   connexion, accueil, défis, soumissions
    admin.js         revue, notation, CRUD, réglages, classement
  views/             gabarits EJS (participant + admin/)
public/
  app.js             participant : compression, file offline, renvoi auto, PWA
  admin.js           admin : notation rapide, validation en masse, raccourcis
  styles.css         styles mobile-first
  sw.js, manifest.webmanifest, icon-*.png   PWA
  vendor/            libs navigateur auto-hébergées (compression, HEIC)
scripts/
  backup.js          sauvegarde base + photos (+ rotation)
data/   uploads/   backup/    (générés, non versionnés)
```

## Scripts npm

| Commande | Effet |
|---|---|
| `npm start` | démarre le serveur |
| `npm run dev` | démarre avec rechargement (`node --watch`) |
| `npm run seed` | (ré)initialise binômes + défis |
| `npm run backup` | sauvegarde base + photos |
