# Product Brief — Application de soumission des défis · Rallye La Trace 2026

> Artefact BMAD (BMM) · Gate 1/4 du cycle de planification
> Projet : Rallye La Trace 2026 · Auteur : TRISTAN · Rédigé le 21/06/2026 (J-6) · Révision 2 (intègre IA de pré-qualification, 8 binômes, ouverture J2) · Statut : à valider

---

## 1. Résumé exécutif

Application web **mobile-first** permettant aux **8 binômes** d'un rallye vélo de 2 jours (27-28 juin 2026, Quercy Blanc) de **soumettre leurs réponses aux défis** (texte et/ou photo) depuis leur téléphone, et aux organisateurs de **valider** chaque soumission et d'attribuer des points. Aucun classement n'est visible des participants : le suspense fait partie du jeu.

Deux enjeux portent le projet :
- **Robustesse en conditions dégradées** : réseau intermittent en pleine campagne, photos lourdes en HEIC, usage à une main au soleil. Critère de succès n°1 : **aucune réponse perdue, tout le week-end.**
- **Validation assistée par IA** : pour absorber le volume de jugement, les réponses texte à réponse connue se valident automatiquement, et les photos sont **pré-qualifiées par un modèle vision** (bon / mauvais / incertain) avant un contrôle humain rapide. **L'humain tranche toujours en dernier.**

## 2. Problème

Un rallye de ce type se gère traditionnellement au papier ou via un groupe de messagerie : photos noyées dans un fil, réponses perdues, comptage des points fastidieux et source de litiges. À 8 binômes et ~30 défis (jusqu'à ~240 soumissions), le jugement à la main reste lourd et lent, surtout en soirée après une journée de vélo.

Contraintes qui rendent une solution générique inadaptée :
- **Réseau faible ou absent** (zones blanches du Quercy Blanc) : un upload qui échoue ne doit jamais faire perdre la saisie.
- **Photos lourdes (5-12 Mo), souvent HEIC, mal orientées (EXIF)** : un envoi brut sature une 4G faible et échoue.
- **Usage terrain** : une main, soleil, pas de patience pour une UI complexe.
- **Volume de validation** : beaucoup de défis se jugent à l'œil ; sans assistance, l'organisateur passe sa soirée à trier des photos.

## 3. Solution proposée

Une application web auto-hébergée sur VPS, accessible par simple URL (pas d'app store), pensée pour le terrain :

- **Connexion sans friction** : un code de binôme, pas de mot de passe, session mémorisée.
- **Liste de défis filtrée par jour**, avec coche verte sur ce qui est déjà soumis.
- **Soumission résiliente** : compression de la photo dans le navigateur avant envoi, brouillon sauvegardé en local dès la saisie, renvoi automatique si le réseau lâche.
- **Validation à 3 modes (par défi)** :
  - `manuel` : jugement humain (créativité, photos subjectives).
  - `auto` : la réponse (chiffre ou texte à réponse définie) est comparée à la réponse attendue → **validée** automatiquement si correspondance (points max), **refusée** automatiquement sinon (réponse objective). Les deux restent surchargeables par l'admin.
  - `ia` : la photo (ou le texte) est évaluée par un modèle vision Claude contre un critère que tu définis → verdict **bon / mauvais / incertain** + indice de confiance + courte justification. Sert de **pré-tri** ; l'admin confirme ou corrige.
- **Console admin** : file de revue triée par l'IA pour catégoriser vite, validation/refus, attribution libre des points, classement réservé aux organisateurs, édition complète des défis (question, format, points, ajout), gestion des binômes, ouverture du jour courant, **bascule globale d'activation de l'IA**, verrouillage final.
- **Exploitation sereine** : sauvegarde horaire automatique (base + photos), HTTPS automatique, redémarrage auto en cas de crash.

## 4. Utilisateurs cibles

| Persona | Contexte | Besoins prioritaires |
|---|---|---|
| **Participant (binôme)** | À vélo, en extérieur, réseau aléatoire, téléphone en main | Saisir/modifier vite, ne rien reperdre, voir ce qui reste à faire |
| **Organisateur / juge (admin)** | Au PC ou tablette, en base ou en soirée | Trier vite (aidé par l'IA), juger et noter en un geste, éditer/ajouter des défis, suivre le classement |
| **Toi (exploitant)** | Déploie et veille sur le VPS le week-end | Déploiement simple, sauvegarde fiable, restauration testée, README clair |

**Les 8 binômes (connus à ce stade, codes à générer) :**

| # | Binôme |
|---|---|
| 1 | Eric & Christine/Chloé |
| 2 | Eric & Nathalie |
| 3 | Tanguy & Fanny |
| 4 | Fred & Yannick |
| 5 | Pascal & Virginie |
| 6 | Stephane & Christophe |
| 7 | Nico & Jean |
| 8 | Constance & Leo |

*(Noms éditables en admin. Deux « Eric » distincts : les codes de connexion les différencieront. Binôme 1 libellé « Christine / Chloé » tel que fourni, à confirmer.)*

## 5. Objectifs & métriques de succès

| Objectif | Métrique | Cible |
|---|---|---|
| Zéro perte de réponse | Réponses saisies puis perdues à cause du réseau | **0** |
| Upload qui passe en réseau faible | Poids moyen d'une photo après compression | **< 1 Mo** (≈1600 px, JPEG 0.8) |
| Adoption sans support | Binômes capables de soumettre seuls dès le 1er défi | **8/8** |
| Charge humaine maîtrisée | Soumissions que l'admin doit juger entièrement à la main | **Seulement les cas incertains / litigieux** (le reste auto ou pré-trié IA) |
| Notation rapide | Temps moyen pour traiter une soumission pré-qualifiée | **< 15 s** (confirmation en un geste) |
| Disponibilité | Indisponibilité ressentie pendant l'événement | **≈ 0** (pm2/systemd + sauvegarde horaire) |
| Récupération possible | Test de restauration de sauvegarde réalisé avant J0 | **Fait et concluant** |

## 6. Périmètre

**Dans le MVP (à livrer pour le 27/06) :**
- Connexion binôme par code, session persistante.
- Liste des défis filtrée par jour (week-end / J1 / J2) avec état "soumis".
- Formulaire de défi (texte / photo / mixte), pré-rempli en mode édition, photo précédente visible.
- Compression photo navigateur + correction EXIF + gestion HEIC ; miniature serveur (sharp).
- Résilience hors-ligne : brouillon localStorage + file de renvoi automatique + statut visible.
- Soumission idempotente (1 ligne par binôme×défi, upsert).
- **Validation à 3 modes** : `manuel`, `auto` (texte vs réponse attendue), `ia` (pré-qualification photo/texte par modèle vision Claude).
- **Pré-qualification IA en tâche de fond** : ne bloque jamais la soumission du participant ; produit verdict + confiance + justification.
- **Admin — file de revue** triée par verdict IA : confirmer / refuser en un geste, confirmation en masse des « bon » haute confiance, override humain systématique possible, attribution des points 0→max.
- **Admin — édition complète des défis** : titre, consigne, type (photo/texte/mixte), mode de validation, critère IA, réponse attendue, disponibilité, points, ordre, **ajout de nouveaux défis**.
- Admin : classement (réservé), gestion des binômes & codes, **ouverture du jour courant / des défis J2**, verrouillage final.
- Horodatage UTC stocké / Europe-Paris affiché.
- Sauvegarde horaire automatisée + procédure de restauration documentée et testée.
- Déploiement VPS : Caddy (HTTPS auto), pm2/systemd, variables d'environnement, jeu de données de test.
- README d'exploitation.

**Hors périmètre (volontairement, pour tenir le délai) :**
- Classement visible des participants.
- Validation IA *contraignante* (l'IA ne valide jamais seule un refus/une acceptation sans que l'humain puisse trancher ; le mode `auto` texte reste, lui, déterministe).
- Notifications push, messagerie, fil social.
- Comptes individuels / multi-rôles fins (un seul mot de passe admin partagé suffit).
- Internationalisation (français uniquement).

**PWA** (manifest + icône + plein écran) : *nice-to-have*, fait si le temps le permet une fois le cœur stable.

## 7. Fonctionnalités clés (vue macro, détaillées en PRD)

1. Authentification binôme par code + session.
2. Logique des jours (week-end/J1/J2) avec **ouverture J2 le dimanche matin** pilotée par l'admin.
3. Catalogue de défis et état de soumission par binôme.
4. Soumission résiliente (compression, EXIF/HEIC, brouillon offline, renvoi auto).
5. Édition idempotente d'une soumission.
6. **Moteur de validation 3 modes** (manuel / auto-texte / IA-vision) avec pré-qualification asynchrone.
7. Console admin : file de revue IA-assistée, notation, classement, **CRUD complet des défis**, gestion binômes, réglages, verrouillage.
8. Sauvegarde & restauration.
9. Déploiement & exploitation.

## 8. Stack & contraintes techniques (cadre, arbitré en Architecture)

Stack imposé par le brief, retenu tel quel :
- **Backend** : Node.js + Express.
- **Base** : SQLite via `better-sqlite3` (fichier unique, mode WAL pour les accès concurrents).
- **Photos** : disque local du VPS (`/uploads`), servies en statique ; pas de S3.
- **Images** : compression navigateur (`browser-image-compression`) + re-encodage et miniature serveur (`sharp`) ; upload multipart via `multer`.
- **IA de pré-qualification** : API Claude (vision). Pressenti : **Claude Haiku** (vision, rapide et peu coûteux) pour classer photo/texte contre un critère par défi ; appel **serveur, asynchrone**, après upload. Modèle exact + format d'appel arbitrés en Architecture (réf. skill `claude-api`).
- **Frontend** : HTML rendu côté serveur + JavaScript vanilla (débogable sans framework).
- **Proxy** : Caddy (HTTPS automatique Let's Encrypt) ; HTTPS obligatoire pour l'accès caméra et le mode PWA.
- **Process** : pm2 ou service systemd.
- **Config** : variables d'environnement (mot de passe admin, **clé API Anthropic**, port, chemin base, chemin uploads).

## 9. Risques & mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Zones blanches : upload échoue | Réponse perdue, frustration | Compression < 1 Mo + brouillon localStorage + file de renvoi auto + statut "en attente d'envoi" |
| Photos HEIC / EXIF (iPhone) | Photo illisible ou pivotée | Conversion JPEG + correction orientation côté navigateur, re-encodage `sharp` côté serveur |
| **VPS = point unique de défaillance** | Perte totale des données le week-end | Sauvegarde horaire (base + `/uploads`) vers second emplacement + **test de restauration avant J0** |
| **L'IA se trompe** (faux bon / faux mauvais) | Mauvaise note si on lui fait aveuglément confiance | L'IA ne fait que **pré-trier** ; verdict + confiance + justification affichés ; **l'humain confirme/corrige toujours**, en priorité les "incertain" |
| Pré-qualification IA indisponible (API down, quota) | Pas de pré-tri | Dégradation propre : la soumission reste en file "à juger à la main", aucun blocage ; possibilité de relancer l'évaluation |
| **Partage des photos avec un tiers (Anthropic)** | Données de participants envoyées hors VPS | Acté côté organisateur ; à cette échelle et pour un événement privé, négligeable. Un défi peut rester en `manuel` si une photo est sensible |
| Pic d'uploads simultanés (8 binômes) | Lenteurs, échecs | SQLite WAL, limites de taille Express + Caddy, traitement image léger, miniatures, IA asynchrone |
| Modification après dépouillement | Litige sur le classement | Verrouillage final admin (lecture seule) |

## 10. Hypothèses & questions ouvertes

- **Binômes** : **8, connus** (cf. §4). Codes de connexion à générer (mot ou PIN simple), modifiables en admin.
- **Défis** : ~30 listés sans points/mode/jour assignés. Je les seede (type inféré, mode `manuel` par défaut, dispo = week-end, points par défaut) ; tu affines en admin, défi par défi (notamment quels défis passent en `auto` ou `ia` et avec quel critère). Le **roadbook** s'intègre via la gestion des défis.
- **Ouverture J2** : déclenchée par l'admin le dimanche matin. À trancher en Architecture : simple bascule admin "J2 ouvert" et/ou heure d'ouverture programmée.
- **Modèle IA** : Haiku (vision) pressenti pour le coût/vitesse ; coût à cette échelle (~quelques dizaines de photos) négligeable. Confirmé en Architecture via `claude-api`.
- **Déploiement** : domaine/sous-domaine VPS à confirmer ; 2ᵉ emplacement de sauvegarde (autre disque vs distant) à trancher.
- **Clé API Anthropic** : à fournir en variable d'environnement.

## 11. Jalons (fenêtre J-6 → J0)

| Date | Jalon |
|---|---|
| **21/06 (J-6, aujourd'hui)** | Planification BMAD : brief → PRD → architecture → epics/stories |
| 22-23/06 (J-5/J-4) | Dev cœur : modèle de données, auth binôme, parcours participant, compression + offline, moteur de validation 3 modes + pré-qualification IA |
| 24/06 (J-3) | Admin : file de revue IA-assistée, notation, classement, CRUD défis, gestion binômes, ouverture du jour, verrouillage |
| 25/06 (J-2) | Déploiement VPS (Caddy, pm2, sauvegarde), tests bout-en-bout, calibrage IA sur photos d'exemple, jeu de test |
| 26/06 (J-1) | Saisie des vrais binômes + défis (roadbook), réglage des modes/critères de validation, répétition, test de restauration |
| **27-28/06 (J0)** | Événement, monitoring, sauvegardes horaires ; ouverture des défis J2 dimanche matin |

## 12. Prochaines étapes (chaîne BMAD)

1. ✅/⏳ **Product Brief** (ce document, révision 2) — *en validation*.
2. **PRD** : exigences fonctionnelles détaillées, **machine à états des soumissions** (soumis → pré-qualifié IA → validé/refusé), règles des 3 modes de validation, parcours écran par écran (participant + admin), exigences non-fonctionnelles.
3. **Architecture** : schéma de données précis (champs IA sur `defis` et `soumissions`), structure du projet, API, flux d'upload résilient, flux de pré-qualification asynchrone, déploiement, sauvegarde.
4. **Epics & Stories** : découpage implémentable, ordonné (modèle + participant → validation/IA → admin → déploiement).
5. **Implémentation** puis **déploiement**.
