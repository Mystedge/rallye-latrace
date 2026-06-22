# Architecture technique — Application Rallye La Trace 2026

> Artefact BMAD (BMM) · Gate 3/4 du cycle de planification
> Projet : Rallye La Trace 2026 · Auteur : TRISTAN · Rédigé le 21/06/2026 (J-6) · Statut : à valider
> Amont : [product-brief.md](product-brief.md) · [prd.md](prd.md)

---

## 1. Vue d'ensemble

Monolithe Node.js auto-hébergé sur VPS, derrière Caddy (HTTPS auto). SQLite fichier unique. Photos sur disque local. Pré-qualification IA asynchrone via l'API Claude (Haiku). Frontend : pages rendues côté serveur + JavaScript vanilla, **offline-first** côté participant.

```
  Navigateur (mobile)                         VPS
 ┌──────────────────────┐         ┌──────────────────────────────────────┐
 │ Compression photo    │ HTTPS   │  Caddy (TLS, limite taille req.)      │
 │ (browser-image-compr)│────────▶│        │                             │
 │ Brouillon IndexedDB  │         │        ▼                             │
 │ File de renvoi auto  │         │  Express (Node) ── better-sqlite3 ──▶ rallye.db (WAL)
 │ Service Worker (PWA) │         │        │            sharp (miniatures)│
 └──────────────────────┘         │        │            ▼                 │
                                  │        │         /uploads (disque)    │
                                  │        ▼                              │
                                  │  File pré-qualif (in-process)         │
                                  │   ├─ auto : compare texte             │
                                  │   └─ ia   : Claude Haiku (vision) ────┼──▶ api.anthropic.com
                                  │                                       │
                                  │  cron horaire : backup db + uploads ──┼──▶ 2e emplacement
                                  └──────────────────────────────────────┘
```

## 2. Stack & dépendances

| Rôle | Choix | Paquet |
|---|---|---|
| Runtime | Node.js ≥ 20 | — |
| Serveur HTTP | Express | `express` |
| Base | SQLite (WAL) | `better-sqlite3` |
| Upload multipart | Multer (disque) | `multer` |
| Traitement image | re-encodage + miniature + auto-orient EXIF | `sharp` |
| IA vision | API Claude | `@anthropic-ai/sdk` |
| Sessions | cookie signé | `cookie-session` (ou `express-session`) |
| Rendu HTML | gabarits légers | `ejs` (ou template literals) |
| **Côté navigateur** | compression + EXIF/HEIC | `browser-image-compression` (+ `heic2any` en secours) |
| Reverse proxy | Caddy (TLS auto) | — |
| Process | pm2 ou systemd | — |

## 3. Structure du projet

```
La Trace/
├─ package.json
├─ .env.example                 # variables d'env (cf. §10)
├─ Caddyfile
├─ ecosystem.config.js          # pm2 (ou rallye.service systemd)
├─ src/
│  ├─ server.js                 # app Express, montage des routes
│  ├─ db.js                     # init better-sqlite3 + schéma + migrations + WAL
│  ├─ routes/
│  │  ├─ participant.js         # login binôme, défis, soumissions
│  │  └─ admin.js               # auth admin, revue, CRUD, réglages, classement
│  ├─ prequalif.js              # moteur de validation (auto + file IA, concurrence limitée)
│  ├─ ai.js                     # appel Claude Haiku vision + parsing structuré
│  ├─ images.js                 # sharp : re-encode + miniature + auto-orient
│  ├─ params.js                 # lecture/écriture table parametres + logique jour
│  ├─ seed.js                   # seed 8 binômes + ~30 défis
│  └─ views/                    # gabarits EJS (connexion, accueil, défi, admin*)
├─ public/
│  ├─ app.js                    # participant : compression, IndexedDB, file de renvoi
│  ├─ admin.js                  # admin : revue rapide, raccourcis, filtres
│  ├─ styles.css                # mobile-first, gros boutons, fort contraste
│  ├─ manifest.webmanifest + icônes
│  └─ sw.js                     # service worker (shell PWA)
├─ scripts/
│  └─ backup.js                 # sauvegarde db + uploads (lancé par cron)
├─ data/                        # rallye.db (gitignored)
└─ uploads/                     # photos + miniatures (gitignored)
```

## 4. Modèle de données (SQLite, `better-sqlite3`, WAL)

```sql
PRAGMA journal_mode = WAL;        -- accès concurrents fiables
PRAGMA foreign_keys = ON;

CREATE TABLE binomes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nom        TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,                 -- login (mot/PIN simple, non devinable)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))   -- UTC
);

CREATE TABLE defis (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  titre            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  type             TEXT NOT NULL CHECK (type IN ('photo','texte','mixte')),
  disponibilite    TEXT NOT NULL CHECK (disponibilite IN ('weekend','J1','J2')),
  mode_validation  TEXT NOT NULL DEFAULT 'manuel'
                     CHECK (mode_validation IN ('manuel','auto','ia')),
  critere_ia       TEXT,        -- consigne donnée à l'IA (mode ia)
  reponse_attendue TEXT,        -- mode auto + indice admin
  points_max       INTEGER NOT NULL DEFAULT 10,
  ordre            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE soumissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  binome_id        INTEGER NOT NULL REFERENCES binomes(id),
  defi_id          INTEGER NOT NULL REFERENCES defis(id),
  texte            TEXT,
  photo_path       TEXT,        -- chemin relatif sous /uploads
  thumb_path       TEXT,        -- miniature (revue admin rapide)
  statut           TEXT NOT NULL DEFAULT 'soumis'
                     CHECK (statut IN ('soumis','valide','refuse')),
  points_attribues INTEGER,
  validation_auto  INTEGER NOT NULL DEFAULT 0,     -- 0/1
  ia_verdict       TEXT NOT NULL DEFAULT 'non_evalue'
                     CHECK (ia_verdict IN ('non_evalue','bon','mauvais','incertain','erreur')),
  ia_confiance     REAL,                            -- 0..1
  ia_commentaire   TEXT,
  ia_evalue_at     TEXT,
  submitted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at     TEXT,
  UNIQUE (binome_id, defi_id)                       -- idempotence (1 ligne / binôme×défi)
);

CREATE TABLE parametres (                            -- clé/valeur
  cle    TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);
-- seed : jour_courant='auto'  (auto|weekend|J1|J2)
--        j2_ouvert='0'        (0|1, ouvert dimanche matin par l'admin)
--        ia_activee='1'       (0|1, interrupteur global IA)
--        verrou_final='0'     (0|1, lecture seule)
```

Tout est stocké en **UTC** (`datetime('now')`), affiché en **Europe/Paris** côté rendu.

## 5. Contrat d'API

**Participant** (session cookie `binome_id` après login) :

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/login` | `{code}` → ouvre la session, renvoie le binôme. Code inconnu → 401 |
| `POST` | `/api/logout` | ferme la session |
| `GET`  | `/api/defis` | défis visibles selon le jour + état de soumission de ce binôme |
| `GET`  | `/api/defis/:id` | défi + soumission existante (pré-remplissage) |
| `POST` | `/api/soumissions` | multipart `{defi_id, texte?, photo?}` → upsert, statut `soumis`, déclenche la pré-qualif. **Répond tout de suite.** |
| `GET`  | `/uploads/*` | photos (noms aléatoires non devinables) |

**Admin** (session cookie `admin=1` après mot de passe) :

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/admin/login` | `{password}` vs `ADMIN_PASSWORD` |
| `GET`  | `/admin/soumissions` | filtres `binome,defi,statut,verdict` + tri |
| `POST` | `/admin/soumissions/:id/valider` | `{points}` → `valide` |
| `POST` | `/admin/soumissions/:id/refuser` | → `refuse` |
| `POST` | `/admin/soumissions/:id/reevaluer` | relance la pré-qualif IA |
| `GET/POST/PUT/DELETE` | `/admin/defis[...]` | CRUD défis (tous champs §4) |
| `GET/POST/PUT/DELETE` | `/admin/binomes[...]` | CRUD binômes + génération de codes |
| `GET`  | `/admin/classement` | Σ points des soumissions `valide` par binôme |
| `GET/POST` | `/admin/parametres` | jour_courant, j2_ouvert, ia_activee, verrou_final |

**Garde verrou final** : si `verrou_final=1`, toutes les routes d'écriture (participant + admin de notation) renvoient 423 (lecture seule).

## 6. Parcours d'upload résilient (le cœur n°1)

**Côté navigateur (`public/app.js`) :**
1. Sélection/capture photo → si HEIC non décodable, `heic2any` → JPEG.
2. `browser-image-compression` : `maxWidthOrHeight: 1600`, `initialQuality: 0.8`, `maxSizeMB: 1`, `useWebWorker: true` (gère aussi l'orientation EXIF en redessinant sur canvas).
3. **Avant tout envoi** : écrire `{defiId, texte, blob, état:'en_attente'}` dans **IndexedDB** (store `pending`). Le texte va aussi en localStorage (saisie progressive).
4. Tenter `POST /api/soumissions` (FormData). Succès → retirer de `pending`, marquer le défi coché, retour accueil. Échec réseau → laisser dans `pending`, afficher **« en attente d'envoi »**.
5. **Renvoi automatique** : sur l'évènement `online`, au chargement, et toutes les ~20 s, rejouer la file `pending`. Aucune réponse n'est perdue tant qu'elle n'a pas été acceptée par le serveur.

**Côté serveur :**
- `multer` (stockage disque, limite ~8 Mo) → `sharp`: `.rotate()` (auto-orient) + re-encode JPEG (≈1600 px) + **miniature** (≈1024 px pour la revue et l'IA).
- Upsert idempotent sur `(binome_id, defi_id)` ; toute réédition **réinitialise** le cycle (`statut='soumis'`, `ia_verdict='non_evalue'`, points effacés) puis **re-déclenche** la pré-qualif.

## 7. Moteur de validation & pré-qualification (le cœur n°2)

`prequalif.js` — déclenché après la réponse au participant (ne bloque jamais l'upload). File in-process à **concurrence limitée** (ex. 3) ; à cette échelle, pas besoin de broker externe.

```
enqueue(soumissionId):
  defi = get(defi)
  switch defi.mode_validation:
    case 'auto':
      ok = normalise(soumission.texte) === normalise(defi.reponse_attendue)
      if ok:  statut='valide', validation_auto=1, points_attribues=defi.points_max
      else:   statut='refuse', validation_auto=1            # refus auto = réponses objectives
      # (refus NON visible du participant — cf. PRD Q1 = caché)
    case 'ia':
      if param('ia_activee') != '1':  return   # interrupteur off → reste 'soumis', verdict non_evalue
      try:   v = await ai.prequalifier(thumbBuffer, defi.critere_ia)   # voir §8
             set ia_verdict=v.verdict, ia_confiance=clamp01(v.confiance),
                 ia_commentaire=v.justification, ia_evalue_at=now()
      catch: set ia_verdict='erreur'                         # dégradation propre, file humaine
      # statut reste 'soumis' dans tous les cas : l'humain tranche
    case 'manuel':
      return                                                 # file de revue humaine
```

`normalise()` : minuscules, suppression des accents, `trim`, espaces multiples réduits. **L'IA n'écrit jamais `valide`/`refuse`** ; seul le mode `auto` (déterministe) le fait automatiquement.

## 8. Intégration IA (Claude Haiku vision)

`ai.js` — modèle **`claude-haiku-4-5`** (le moins cher/rapide, vision, adapté à la classification simple). Pas de `thinking`/`effort`. Sortie contrainte par **JSON schema** (`output_config.format`).

```js
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic();              // lit ANTHROPIC_API_KEY

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confiance", "justification"],
  properties: {
    verdict:       { type: "string", enum: ["bon", "mauvais", "incertain"] },
    confiance:     { type: "number" },          // 0..1 (clampé côté serveur)
    justification: { type: "string" }           // courte, en français
  }
};

export async function prequalifier(jpegBuffer, critere) {
  const data = jpegBuffer.toString("base64");
  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 300,
    system:
      "Tu juges un rallye photo. On te donne un critère et une photo. " +
      "Dis si la photo satisfait le critère : 'bon', 'mauvais' ou 'incertain' " +
      "(incertain si tu n'es pas sûr ou si la photo est ambiguë), avec une confiance " +
      "0-1 et une justification courte en français. Sois indulgent sur la qualité " +
      "(flou, cadrage), strict sur le contenu effectivement demandé.",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
        { type: "text",  text: `Critère du défi : ${critere}\n\nLa photo satisfait-elle ce critère ?` }
      ]
    }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } }
  });
  const text = resp.content.find(b => b.type === "text").text;
  const out = JSON.parse(text);
  out.confiance = Math.max(0, Math.min(1, Number(out.confiance) || 0));
  return out;
}
```

- On envoie **la miniature** (~1024 px), pas l'original → moins de tokens, plus rapide.
- **Coût** ≈ 0,002–0,003 €/photo (image ~1,5–2k tokens entrée @ $1/1M + ~80 tokens sortie @ $5/1M). Tout le week-end (~240 photos, ~500 appels avec ré-essais) : **< 2 €**.
- **Robustesse** : timeout + retries gérés par le SDK ; toute erreur → `ia_verdict='erreur'`, soumission en file humaine, **relançable** depuis l'admin. `output_config.format` ne contraint pas les bornes numériques → on clampe `confiance`.
- **Confidentialité** : en mode `ia`, la miniature part chez Anthropic. L'interrupteur `ia_activee=0` coupe tout appel (aucune photo ne sort du VPS).

## 9. Logique des jours

`params.js` calcule le **jour effectif** :
- `jour_courant` = `auto` → déduit de la date Europe/Paris (27 = J1, 28 = J2) ; sinon valeur forcée par l'admin (`weekend`/`J1`/`J2`).
- Un défi est visible si : `disponibilite='weekend'`, **ou** `='J1'` et jour effectif = J1, **ou** `='J2'` et **`j2_ouvert='1'`** (bascule admin du dimanche matin — prime sur la date pour ne jamais ouvrir J2 trop tôt). *(Décision : bascule admin simple, pas d'heure programmée — cf. PRD Q2.)*

## 10. Sécurité & configuration (variables d'env)

`.env` (jamais commité) :
```
PORT=3000
DB_PATH=./data/rallye.db
UPLOADS_DIR=./uploads
ADMIN_PASSWORD=•••••           # mot de passe admin
SESSION_SECRET=•••••           # signature des cookies de session
ANTHROPIC_API_KEY=sk-ant-•••   # clé API Claude (pré-qualif IA)
BACKUP_DIR=/mnt/backup/rallye  # 2e emplacement (autre disque/montage)
```
- Codes binômes **non devinables**, mot de passe admin et clé API **hors code**.
- Classement **jamais** exposé côté participant (routes séparées sous `/admin`).
- HTTPS **obligatoire** (caméra + PWA) → assuré par Caddy.

## 11. Déploiement

**Caddyfile** (HTTPS auto + limite de taille d'upload) :
```
app.latrace.bike {
    encode gzip
    request_body { max_size 10MB }
    reverse_proxy localhost:3000
}
```

**DNS** : créer un enregistrement **A `app.latrace.bike` → IP du VPS** avant de lancer Caddy (nécessaire à l'émission du certificat Let's Encrypt).

**Process** : pm2 (`ecosystem.config.js`, `pm2 startup` + `pm2 save`) **ou** unité systemd avec `Restart=always`. Express sert `/public` en statique et `/uploads`.

## 12. Sauvegarde & restauration

`scripts/backup.js` (lancé par cron, horaire pendant l'événement) :
1. Backup SQLite **à chaud, WAL-safe** : `db.backup(\`${BACKUP_DIR}/rallye-<horodatage>.db\`)` (API `better-sqlite3`).
2. Synchronisation des photos : `rsync -a uploads/ $BACKUP_DIR/uploads/` (ou copie incrémentale).
3. Rotation : conserver N dernières copies.

**Emplacement (`BACKUP_DIR`) — à finaliser avant J0 (pas de solution actuelle) :**
- **Par défaut maintenant (zéro infra)** : un **2ᵉ dossier sur le VPS** (ex. `/opt/rallye-backup`). Protège contre corruption de la base, suppression accidentelle, mauvais déploiement — **mais pas** contre la perte du VPS lui-même.
- **Protection réelle (recommandé, ~10 min)** : `rclone` vers un stockage objet bon marché (Backblaze B2 / Scaleway / OVH, quelques centimes), **ou** `rsync`/`scp` vers une autre machine que tu contrôles (laptop, autre serveur). La base est minuscule : au pire on n'envoie hors-VPS que `rallye.db` (les scores) toutes les heures, et les photos moins souvent.

```
# crontab (pendant le week-end)
0 * * * * cd /opt/rallye && node scripts/backup.js >> data/backup.log 2>&1
```

**Restauration** (à tester **avant J0**) : arrêter l'app, remplacer `rallye.db` par la dernière copie, restaurer `uploads/`, redémarrer. Procédure détaillée dans le README.

## 13. Décisions tranchées (questions ouvertes du PRD)

| Question | Décision |
|---|---|
| Refus auto visible au participant (Q1) | **Caché** : le participant voit « soumis », peut rééditer librement |
| Ouverture J2 (Q2) | **Bascule admin** `j2_ouvert` (dimanche matin), pas d'heure programmée |
| Modèle IA (Q3) | **`claude-haiku-4-5`**, sortie JSON schema, miniature envoyée |
| 2e emplacement de sauvegarde (Q4) | **Défaut : 2ᵉ dossier VPS** ; off-VPS (rclone B2 / rsync) **à finaliser avant J0** — pas de solution actuelle |
| Domaine/sous-domaine (Q5) | **`app.latrace.bike`** (enreg. A → IP VPS avant Caddy) |

## 14. Risques techniques résiduels

- **HEIC non décodable** sur un vieux navigateur → `heic2any` en secours + re-encode `sharp` ; si tout échoue, la photo brute est quand même stockée et jugeable à la main.
- **localStorage/IndexedDB plein** (plusieurs brouillons photo) → stocker les blobs en IndexedDB (quota large), purger après envoi confirmé.
- **API Claude indisponible** → `ia_verdict='erreur'`, file humaine, relance possible ; l'événement n'est jamais bloqué.
- **PWA/Service Worker** : périmètre minimal (shell + installabilité) ; la résilience des données repose sur la file IndexedDB, pas sur le SW.

## 15. Prochaine étape (Gate 4)

Découpage en **epics & stories** implémentables, ordonné Epic 1→5 (fondations → participant → validation/IA → admin → exploitation), prêt à coder.
