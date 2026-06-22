# PRD — Application de soumission des défis · Rallye La Trace 2026

> Artefact BMAD (BMM) · Gate 2/4 du cycle de planification
> Projet : Rallye La Trace 2026 · Auteur : TRISTAN · Rédigé le 21/06/2026 (J-6) · Statut : à valider
> Amont : [product-brief.md](product-brief.md)

---

## 1. Contexte & objectif

Application web mobile-first pour les **8 binômes** du Rallye La Trace 2026 (27-28 juin, Quercy Blanc). Les binômes soumettent des réponses (texte et/ou photo) aux défis ; les organisateurs valident et notent, **assistés par une pré-qualification IA** des photos et une **auto-validation** des réponses objectives. Aucun classement n'est visible des participants.

**Critères non négociables** : (1) aucune réponse perdue malgré un réseau intermittent ; (2) charge de validation absorbée par l'auto-validation + le pré-tri IA, l'humain ne tranchant que l'incertain et le subjectif.

## 2. Objectifs / Non-objectifs

**Objectifs**
- Soumission fiable et éditable depuis un téléphone en réseau dégradé.
- Validation à trois modes (manuel / auto / IA) avec humain décideur final.
- Console admin permettant d'éditer/ajouter des défis et de trier les soumissions très vite.
- Déploiement VPS robuste, sauvegardé, restaurable.

**Non-objectifs (MVP)**
- Classement visible des participants ; notifications push ; messagerie ; comptes individuels ; i18n ; validation IA contraignante (l'IA ne décide jamais seule, sauf le cas déterministe `auto`).

## 3. Personas

- **Participant (binôme)** — à vélo, une main, soleil, réseau aléatoire. Veut soumettre/modifier vite et ne rien reperdre.
- **Admin (organisateur/juge)** — PC ou tablette, en base/soirée. Veut trier vite (aidé IA), noter en un geste, éditer les défis.
- **Exploitant (toi)** — déploie et veille sur le VPS. Veut simplicité, sauvegarde, restauration testée.

## 4. Règles de gestion (le cœur)

### 4.1 Modes de validation (par défi)

| Mode | S'applique à | Comportement automatique | Décision finale |
|---|---|---|---|
| `manuel` | Photos/défis subjectifs (créativité, interactions) | Aucun | Humain seul |
| `auto` | Réponse **chiffre ou texte définie** (énigmes à réponse unique) | Match → **validé** + points max · Non-match → **refusé** | Auto, **surchargeable** par l'admin |
| `ia` | Photos (ou texte à juger) | Pré-qualification : verdict **bon/mauvais/incertain** + confiance + justification. **Aucune validation/refus auto.** | Humain, aidé du verdict |

### 4.2 Machine à états d'une soumission

États **serveur** : `soumis` · `validé` · `refusé`.
Pseudo-états **client** (résilience) : `brouillon` (localStorage) · `en_attente_envoi` (file de renvoi).
Attribut IA orthogonal (sur `soumis` en mode `ia`) : `non_évalué` · `bon` · `mauvais` · `incertain` · `erreur`.

```
[brouillon] --saisie--> [en_attente_envoi] --réseau OK--> (POST) --> [soumis]
   (localStorage)            (renvoi auto)                              |
                                                                        | pré-qualification (tâche de fond)
                                          +-----------------------------+-----------------------------+
                                          | mode auto            | mode ia                | mode manuel |
                                          v                      v                        v            |
                                   match? oui -> [validé]   verdict IA stocké         (rien)           |
                                         non  -> [refusé]   reste [soumis] en file    reste [soumis]   |
                                                            triée par verdict         en file          |
                                          +-----------------------------+-----------------------------+
                                                                        | revue admin
                                                          valider (+points) -> [validé]
                                                          refuser           -> [refusé]
                                                          (override possible de tout verdict, y compris auto)
                                                                        |
                                                            verrouillage final -> lecture seule
```

### 4.3 Notation
- `auto` validé : points = `points_max` (préremplis, modifiables).
- `ia` / `manuel` : points saisis par l'admin à la validation (0 → `points_max`).
- Classement admin = somme des `points_attribués` des soumissions `validé`, par binôme.

### 4.4 Logique des jours
- `week-end` : toujours visible.
- `J1` : visible le samedi 27 (jour courant = J1).
- `J2` : visible **uniquement** quand l'admin a **ouvert J2** (dimanche matin). Défaut par date (28 = J2) **mais** bascule admin explicite qui prime, pour ne jamais ouvrir J2 trop tôt ni trop tard.
- Le jour courant et l'ouverture J2 sont des réglages admin (override de la date).

### 4.5 Idempotence
- Contrainte d'unicité `(binome_id, defi_id)` : une seule soumission par binôme et par défi. Toute nouvelle soumission **met à jour** la ligne (upsert) et **réinitialise** le cycle de validation (repasse en `soumis`, re-pré-qualifie).

### 4.6 Activation IA (interrupteur global)
- Réglage admin `ia_activee` (on/off). **Off** → aucun appel à l'API, aucune photo envoyée hors VPS ; les défis `ia` vont directement en file de revue manuelle (verdict `non_évalué`). Bascule à chaud, sans redéploiement.

## 5. Exigences fonctionnelles

### A. Authentification & session
- **FR-A1** Connexion par **code binôme** (champ unique), sans mot de passe ni création de compte.
- **FR-A2** Session persistante (cookie signé httpOnly, ou token localStorage) : pas de reconnexion à chaque visite.
- **FR-A3** Code inconnu → message clair, pas d'accès.
- **FR-A4** Déconnexion possible (mineur).

### B. Catalogue & jours
- **FR-B1** Afficher les défis disponibles selon le jour courant, **groupés** par disponibilité (week-end / jour courant).
- **FR-B2** Indiquer l'état par défi pour ce binôme : non soumis / soumis (coche verte). **Le verdict (validé/refusé) et les points ne sont pas exposés au participant** (cohérent avec « pas de classement »).
- **FR-B3** Respecter la visibilité : week-end toujours ; J1 le jour 1 ; J2 seulement si ouvert par l'admin.
- **FR-B4** Trier l'affichage par `ordre`.

### C. Soumission (participant)
- **FR-C1** Formulaire selon `type` : texte / bouton photo / les deux.
- **FR-C2** **Compression navigateur** avant envoi : redimensionner ~1600 px grand côté, JPEG qualité 0.8, cible < 1 Mo ; **corriger l'orientation EXIF** ; **convertir HEIC → JPEG**.
- **FR-C3** **Brouillon localStorage** dès la saisie (texte + photo compressée), avant tout envoi.
- **FR-C4** Envoi : succès → soumission enregistrée, retour accueil, défi coché. Échec réseau → brouillon conservé, mise en **file de renvoi automatique**, statut **« en attente d'envoi »** visible.
- **FR-C5** Édition d'une soumission existante : formulaire **pré-rempli**, **photo précédente visible**, upsert idempotent (cf. 4.5).
- **FR-C6** Statut de soumission toujours lisible (soumis / en attente d'envoi).

### D. Moteur de validation
- **FR-D1** À réception : créer/mettre à jour en `soumis`, déclencher la **pré-qualification en tâche de fond** (ne bloque pas la réponse au participant).
- **FR-D2** Mode `auto` : normaliser (minuscule, sans accents, trim, espaces multiples) la réponse et la comparer à `reponse_attendue`. Match → `validé` (+points max). Non-match → `refusé`. Surchargeable.
- **FR-D3** Mode `ia` **et** `ia_activee=on` : appeler le modèle vision avec la photo (ou le texte) + `critere_ia` → stocker verdict {bon/mauvais/incertain} + confiance + justification. Soumission reste `soumis`, placée en file triée.
- **FR-D4** Mode `ia` **et** `ia_activee=off`, ou mode `manuel` : pas d'appel externe ; soumission `soumis` → file de revue humaine (verdict `non_évalué`).
- **FR-D5** Robustesse IA : échec d'appel (panne/quota/timeout) → verdict `erreur`, soumission en file humaine, **ré-évaluation relançable** depuis l'admin.
- **FR-D6** L'IA ne fixe jamais un état final seule ; seul le mode `auto` (déterministe) écrit `validé`/`refusé` automatiquement.

### E. Admin — revue & notation
- **FR-E1** Accès protégé par **mot de passe admin** (variable d'environnement, jamais en dur).
- **FR-E2** Dashboard des soumissions, **filtrable** par binôme / défi / statut / verdict IA, et **triable** (verdict, date).
- **FR-E3** Pour chaque soumission : **photo en grand**, texte, `reponse_attendue` affichée, **verdict IA + confiance + justification**.
- **FR-E4** Actions rapides : **valider / refuser en un geste** + champ points (0→`points_max`), raccourcis clavier.
- **FR-E5** **Confirmation en masse** des « bon » à haute confiance (multi-sélection → valider).
- **FR-E6** **Override** de tout verdict (y compris `auto`) tant que non verrouillé. Relance de l'évaluation IA.

### F. Admin — gestion
- **FR-F1** CRUD **binômes** (nom, code) ; **génération** et édition des codes.
- **FR-F2** CRUD **défis** : titre, consigne, `type`, `mode_validation`, `critere_ia`, `reponse_attendue`, `disponibilite`, `points_max`, `ordre` ; **ajout** de défis.
- **FR-F3** Réglage du **jour courant** et **ouverture J2**.
- **FR-F4** **Bascule globale IA** (cf. 4.6).
- **FR-F5** **Verrouillage final** (lecture seule de toutes les soumissions).
- **FR-F6** **Classement** (somme des points des soumissions validées par binôme), **réservé admin**.

### G. Exploitation
- **FR-G1** **Sauvegarde horaire** (fichier SQLite + dossier `/uploads`) vers un 2ᵉ emplacement, pendant l'événement.
- **FR-G2** Procédure de **restauration** documentée et testée avant J0.
- **FR-G3** **Jeu de données de test** (2-3 binômes, défis des 3 types/modes) pour valider le parcours.

## 6. Exigences non-fonctionnelles

| Domaine | Exigence |
|---|---|
| **Résilience** | Jamais perdre une réponse ; offline-first (brouillon + renvoi auto) ; pré-qualification asynchrone non bloquante |
| **Performance** | Photo < 1 Mo après compression ; SQLite **WAL** ; miniatures `sharp` ; IA hors du chemin critique |
| **Sécurité** | Mot de passe admin + clé API en **env** ; codes binômes non devinables ; classement non exposé ; **HTTPS obligatoire** (caméra + PWA) |
| **Données** | Horodatage **UTC stocké / Europe-Paris affiché** ; unicité binôme×défi ; sauvegarde |
| **Exploitation** | pm2/systemd **auto-restart** ; Caddy HTTPS auto ; logs lisibles |
| **Utilisabilité** | Gros boutons, fort contraste, usage une main, plein soleil, français |
| **Confidentialité** | En mode `ia` on, photos envoyées à l'API Anthropic ; bascule off = aucune sortie de données |

## 7. Parcours écran par écran

**Participant**
1. **Connexion** — un champ « code binôme » → Accueil.
2. **Accueil** — défis groupés (week-end / jour courant), coche verte sur les soumis, bandeau « en attente d'envoi » si renvoi en cours. Clic → Formulaire.
3. **Formulaire de défi** — consigne + champ(s) selon `type` ; si déjà soumis : pré-rempli + photo précédente. Envoi → retour Accueil, défi coché.

**Admin**
1. **Connexion admin** — mot de passe.
2. **Revue (dashboard)** — file filtrable/triable, photos en grand, verdict IA, valider/refuser + points, bulk-confirm. *Vue par défaut.*
3. **Défis** — liste + édition/ajout (tous les champs, dont mode et critère IA).
4. **Binômes** — liste + édition/ajout, codes.
5. **Classement** — totaux par binôme (réservé).
6. **Réglages** — jour courant / ouverture J2, bascule IA, verrouillage final.

## 8. Entités de données (vue PRD ; détail en Architecture)

- **binomes** : `id`, `nom`, `code` (unique), `created_at`.
- **defis** : `id`, `titre`, `description`, `type` (photo/texte/mixte), `disponibilite` (week-end/J1/J2), `mode_validation` (manuel/auto/ia) **[nouveau]**, `critere_ia` (text, nullable) **[nouveau]**, `reponse_attendue` (text, nullable), `points_max`, `ordre`.
- **soumissions** : `id`, `binome_id`, `defi_id`, `texte`, `photo_path`, `statut` (soumis/validé/refusé), `points_attribues`, `validation_auto` (bool) **[nouveau]**, `ia_verdict` (non_évalué/bon/mauvais/incertain/erreur) **[nouveau]**, `ia_confiance` (real) **[nouveau]**, `ia_commentaire` (text) **[nouveau]**, `ia_evalue_at` **[nouveau]**, `submitted_at`, `updated_at`, `validated_at`. Unicité `(binome_id, defi_id)`.
- **parametres** (clé/valeur) **[nouveau]** : `jour_courant`, `j2_ouvert`, `ia_activee`, `verrou_final`.

## 9. Découpage en epics (préfigure le Gate 4)

- **Epic 1 — Fondations** : init projet, SQLite + schéma + migrations, config env, seed (8 binômes + ~30 défis), serveur statique `/uploads`.
- **Epic 2 — Parcours participant** : auth code, accueil/jours, formulaire, **compression + EXIF/HEIC**, **brouillon offline + renvoi auto**, édition idempotente.
- **Epic 3 — Moteur de validation** : machine à états, mode `auto`, **pré-qualification IA asynchrone**, robustesse/erreurs, **bascule IA globale**.
- **Epic 4 — Console admin** : revue IA-assistée + notation + bulk, CRUD défis, CRUD binômes/codes, réglages (jour/J2/IA), verrouillage, classement.
- **Epic 5 — Exploitation** : sauvegarde horaire + restauration testée, déploiement Caddy + pm2/systemd, README, jeu de test.

Ordre de réalisation demandé : **Epic 1 → 2 → 3 → 4 → 5**, en priorisant dans l'Epic 2/3 les pièges techniques (photos, offline).

## 10. Questions ouvertes (à trancher en Architecture ou avec toi)

1. **Refus auto visible au participant ?** En mode `auto`, un non-match refuse la réponse. Faut-il afficher « réponse incorrecte, réessaie » au binôme (utile pour corriger une faute, mais transforme une énigme en jeu de devinettes), ou garder l'état caché (défaut proposé : **caché**, le binôme peut éditer librement) ? *Réglable par défi si tu veux.*
2. **Ouverture J2** : simple bascule admin, ou aussi une heure programmée automatique ? (défaut proposé : **bascule admin**, suffisante et sans surprise).
3. **Modèle IA exact** + format de réponse structurée (verdict + confiance) → Architecture (réf. `claude-api`).
4. **2ᵉ emplacement de sauvegarde** : autre disque VPS ou stockage distant ?
5. **Domaine/sous-domaine** pour Caddy.
