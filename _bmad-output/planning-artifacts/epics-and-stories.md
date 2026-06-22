# Epics & Stories — Application Rallye La Trace 2026

> Artefact BMAD (BMM) · Gate 4/4 du cycle de planification
> Projet : Rallye La Trace 2026 · Auteur : TRISTAN · Rédigé le 21/06/2026 (J-6) · Statut : à valider
> Amont : [product-brief.md](product-brief.md) · [prd.md](prd.md) · [architecture.md](architecture.md)

---

## Convention

Stories `Sx.y`, traçant les FR du PRD. Ordre de réalisation : **Epic 1 → 5**, en priorisant dans les Epics 2/3 les pièges techniques (photos, offline). Chaque story porte des **critères d'acceptation** (CA) vérifiables.

**Definition of Done (globale)** : code en place, parcours testable en local, pas de secret en dur, horodatage UTC stocké / Europe-Paris affiché, écrit en français côté UI.

---

## Epic 1 — Fondations

*But : un serveur qui démarre, une base au schéma correct, des données de test.*

### S1.1 — Initialisation du projet
- CA : `package.json` (Node ≥ 20, type module), dépendances installées (express, better-sqlite3, multer, sharp, @anthropic-ai/sdk, cookie-session, ejs ; dev : browser-image-compression/heic2any servis côté public).
- CA : arborescence `src/`, `public/`, `scripts/`, `data/`, `uploads/` ; `.gitignore` (data, uploads, .env, node_modules) ; `.env.example` complet (§10 archi).

### S1.2 — Base de données & schéma
- CA : `db.js` ouvre SQLite (`DB_PATH`), `PRAGMA journal_mode=WAL`, `foreign_keys=ON`.
- CA : tables `binomes`, `defis`, `soumissions`, `parametres` créées au démarrage si absentes (schéma §4 archi), avec les `CHECK` et l'unicité `(binome_id, defi_id)`.
- CA : migrations idempotentes (relancer le serveur ne casse rien).

### S1.3 — Paramètres & logique des jours
- CA : `params.js` lit/écrit `parametres` ; seed des 4 clés (`jour_courant='auto'`, `j2_ouvert='0'`, `ia_activee='1'`, `verrou_final='0'`).
- CA : fonction `jourEffectif()` (auto = date Europe/Paris ; sinon valeur forcée) et `defiVisible(defi)` selon §9 archi (J2 visible seulement si `j2_ouvert='1'`).

### S1.4 — Seed des données
- CA : `seed.js` insère les **8 binômes** (cf. brief §4) avec un **code généré** non devinable (imprimé en console pour remise).
- CA : insère les **~30 défis** du brief avec défauts (`type` inféré, `disponibilite='weekend'`, `mode_validation='manuel'`, `points_max=10`, `ordre` séquentiel), éditables ensuite en admin.
- CA : seed ré-exécutable sans doublonner (upsert sur un identifiant stable).

### S1.5 — Serveur Express de base
- CA : `server.js` démarre sur `PORT`, sert `/public` et `/uploads` en statique, sessions cookie signées (`SESSION_SECRET`), moteur EJS.
- CA : page d'accueil de connexion accessible en HTTP local ; 404 propre.

---

## Epic 2 — Parcours participant *(prioriser S2.4 + S2.6)*

*But : un binôme se connecte, voit ses défis, soumet et réédite sans rien perdre.*

### S2.1 — Authentification binôme `[FR-A]`
- CA : `POST /api/login {code}` ouvre la session (`binome_id`), code inconnu → 401 + message clair ; session persistante (pas de reconnexion à chaque visite) ; `POST /api/logout`.

### S2.2 — Accueil & liste des défis `[FR-B]`
- CA : `GET /api/defis` renvoie les défis visibles selon `jourEffectif()`, **groupés** (week-end / jour courant), triés par `ordre`, avec l'état pour ce binôme (non soumis / soumis = coche verte).
- CA : **ni verdict ni points exposés** au participant ; bandeau « en attente d'envoi » si la file `pending` n'est pas vide.

### S2.3 — Formulaire de défi `[FR-C1, C5]`
- CA : champs selon `type` (texte / photo / mixte) ; si soumission existante → **pré-rempli** + **photo précédente visible** (mode édition).
- CA : après envoi accepté → retour accueil, défi coché.

### S2.4 — Compression & normalisation photo (navigateur) `[FR-C2]` ⭐
- CA : `browser-image-compression` (≈1600 px, qualité 0.8, cible < 1 Mo) ; orientation **EXIF corrigée** ; **HEIC → JPEG** (heic2any en secours).
- CA : une photo iPhone de 10 Mo aboutit à un JPEG < 1 Mo, bien orienté, avant tout envoi.

### S2.5 — Réception & traitement serveur `[FR-C, FR-D1]`
- CA : `POST /api/soumissions` (multipart) ; `multer` (limite ~8 Mo) → `sharp` `.rotate()` + re-encode + **miniature** (~1024 px) ; chemins en base.
- CA : **upsert idempotent** `(binome_id, defi_id)` ; réédition réinitialise le cycle (`statut='soumis'`, verdict `non_evalue`, points effacés) ; **réponse immédiate** puis pré-qualif déclenchée (Epic 3).

### S2.6 — Résilience hors-ligne `[FR-C3, C4, C6]` ⭐
- CA : à la saisie, brouillon en **IndexedDB** (`pending` : defiId, texte, blob) + texte en localStorage, **avant** tout envoi.
- CA : échec réseau → reste en `pending`, statut **« en attente d'envoi »** visible ; **renvoi auto** sur `online`, au chargement, et toutes les ~20 s ; retrait de `pending` seulement après acceptation serveur.
- CA : **aucune réponse perdue** en coupant le réseau pendant la saisie/l'envoi (test explicite).

---

## Epic 3 — Moteur de validation & IA

*But : auto-validation des réponses objectives, pré-tri IA des photos, humain décideur.*

### S3.1 — File de pré-qualification `[FR-D1]`
- CA : `prequalif.js` traite les soumissions après réponse au participant, **concurrence limitée** (≈3), sans bloquer l'upload ; relançable sur une soumission donnée.

### S3.2 — Mode `auto` (texte objectif) `[FR-D2]`
- CA : normalisation (minuscule, sans accents, trim, espaces) ; match → `valide` + `points_max` + `validation_auto=1` ; non-match → `refuse` (objectif) ; **surchargeable** par l'admin ; refus **non visible** du participant.

### S3.3 — Mode `ia` (vision Claude) `[FR-D3]`
- CA : si `ia_activee='1'`, appel `ai.prequalifier(miniature, critere_ia)` → modèle `claude-haiku-4-5`, `output_config.format` (schema verdict/confiance/justification), `confiance` clampée 0–1 (code §8 archi).
- CA : stocke `ia_verdict`, `ia_confiance`, `ia_commentaire`, `ia_evalue_at` ; **statut reste `soumis`** (l'humain tranche).

### S3.4 — Robustesse IA & interrupteur global `[FR-D4, D5, D6, D7]`
- CA : `ia_activee='0'` ⇒ **aucun appel externe**, défis `ia` → file humaine (`non_evalue`) ; mode `manuel` → file humaine sans appel.
- CA : échec d'appel (panne/quota/timeout) → `ia_verdict='erreur'`, file humaine, **ré-évaluation** possible depuis l'admin ; l'IA n'écrit jamais d'état final seule.

---

## Epic 4 — Console admin

*But : trier vite (aidé IA), noter en un geste, éditer/ajouter défis & binômes.*

### S4.1 — Authentification admin `[FR-E1]`
- CA : `POST /admin/login {password}` vs `ADMIN_PASSWORD` (env) ; session `admin=1` ; toutes les routes `/admin/*` protégées.

### S4.2 — Dashboard de revue `[FR-E2, E3]`
- CA : liste **filtrable** (binôme/défi/statut/verdict) et **triable** (verdict, date) ; **photo en grand** + miniature ; texte ; `reponse_attendue` affichée ; **verdict IA + confiance + justification** visibles.

### S4.3 — Notation rapide `[FR-E4, E5, E6]` ⭐
- CA : **valider / refuser en un geste** + champ points (0→`points_max`) ; **raccourcis clavier** ; **confirmation en masse** des « bon » haute confiance ; **override** de tout verdict (y compris `auto`) tant que non verrouillé.

### S4.4 — CRUD défis `[FR-F2]`
- CA : créer/éditer/supprimer un défi : titre, consigne, `type`, `mode_validation`, `critere_ia`, `reponse_attendue`, `disponibilite`, `points_max`, `ordre` ; **ajout** de nouveaux défis (intégration du roadbook).

### S4.5 — CRUD binômes & codes `[FR-F1]`
- CA : créer/éditer/supprimer un binôme (nom, code) ; **génération** de code ; codes listables pour remise aux équipes.

### S4.6 — Réglages `[FR-F3, F4, F5]`
- CA : réglage `jour_courant` + **ouverture J2** (`j2_ouvert`) ; **bascule IA** (`ia_activee`) à chaud ; **verrouillage final** (`verrou_final`) ⇒ écriture bloquée (423) partout.

### S4.7 — Classement `[FR-F6]`
- CA : Σ `points_attribues` des soumissions `valide` par binôme, **réservé admin**, jamais exposé aux participants.

---

## Epic 5 — Exploitation

*But : déployable, sauvegardé, restaurable, documenté.*

### S5.1 — Sauvegarde & restauration `[FR-G1, G2]`
- CA : `scripts/backup.js` : `db.backup()` WAL-safe + `rsync` uploads vers `BACKUP_DIR` + rotation ; cron horaire documenté.
- CA : procédure de **restauration testée** (README) ; défaut = 2ᵉ dossier VPS, off-VPS à finaliser avant J0.

### S5.2 — Déploiement `[NFR ops]`
- CA : `Caddyfile` (`app.latrace.bike`, HTTPS auto, limite 10 Mo) ; **enreg. A** documenté ; pm2 (`ecosystem.config.js`) ou systemd `Restart=always` ; `.env` renseigné.

### S5.3 — PWA *(optionnel)*
- CA : `manifest.webmanifest` + icône + Service Worker « shell » → « ajouter à l'écran d'accueil », plein écran. *Fait seulement si le cœur est stable.*

### S5.4 — Jeu de test & recette bout-en-bout `[FR-G3]`
- CA : jeu de données de test (2–3 binômes + défis des 3 types/modes) ; parcours complet validé : soumission photo en réseau coupé → renvoi auto → pré-qualif IA → revue admin → notation → classement.
- CA : **calibrage IA** sur quelques photos d'exemple (ajuster les `critere_ia`).

### S5.5 — README `[livrable]`
- CA : lancer en local et en prod ; ajouter binômes/défis ; accéder à l'admin ; lancer/restaurer la sauvegarde ; renseigner les variables d'env.

---

## Séquencement conseillé (fenêtre J-6 → J0)

| Quand | Epics/Stories |
|---|---|
| J-5/J-4 | Epic 1 ; Epic 2 (priorité S2.4 compression + S2.6 offline) ; Epic 3 (S3.1→S3.4) |
| J-3 | Epic 4 (revue + notation + CRUD + réglages + classement) |
| J-2 | Epic 5 : S5.1 sauvegarde, S5.2 déploiement, S5.4 recette + calibrage IA |
| J-1 | Saisie réelle (8 binômes + défis roadbook), répétition, **test de restauration**, S5.3 PWA si temps |
| J0 (27-28) | Événement ; ouverture J2 dimanche matin ; sauvegardes horaires |
