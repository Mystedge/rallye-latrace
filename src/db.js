import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
mkdirSync(config.uploadsDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL'); // accès concurrents fiables
db.pragma('foreign_keys = ON');

// Schéma — idempotent (CREATE TABLE IF NOT EXISTS). Cf. architecture §4.
db.exec(`
CREATE TABLE IF NOT EXISTS binomes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nom        TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS defis (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  titre            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  emoji            TEXT,
  bonus            INTEGER NOT NULL DEFAULT 0,
  media            TEXT,
  type             TEXT NOT NULL CHECK (type IN ('photo','texte','mixte')),
  disponibilite    TEXT NOT NULL CHECK (disponibilite IN ('weekend','J1','J2')),
  mode_validation  TEXT NOT NULL DEFAULT 'manuel' CHECK (mode_validation IN ('manuel','auto','ia')),
  critere_ia       TEXT,
  reponse_attendue TEXT,
  points_max       INTEGER NOT NULL DEFAULT 10,
  ordre            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS soumissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  binome_id        INTEGER NOT NULL REFERENCES binomes(id),
  defi_id          INTEGER NOT NULL REFERENCES defis(id),
  texte            TEXT,
  photo_path       TEXT,
  thumb_path       TEXT,
  statut           TEXT NOT NULL DEFAULT 'soumis' CHECK (statut IN ('soumis','valide','refuse')),
  points_attribues INTEGER,
  validation_auto  INTEGER NOT NULL DEFAULT 0,
  ia_verdict       TEXT NOT NULL DEFAULT 'non_evalue'
                     CHECK (ia_verdict IN ('non_evalue','bon','mauvais','incertain','erreur')),
  ia_confiance     REAL,
  ia_commentaire   TEXT,
  ia_evalue_at     TEXT,
  submitted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at     TEXT,
  UNIQUE (binome_id, defi_id)
);

CREATE TABLE IF NOT EXISTS parametres (
  cle    TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);
`);

// Migrations légères — idempotentes, jouées à chaque démarrage (bases déjà créées en prod).
// Ajoute les colonnes manquantes sans toucher aux données existantes.
const colonnesDefis = db.prepare('PRAGMA table_info(defis)').all().map((c) => c.name);
if (!colonnesDefis.includes('emoji')) {
  db.exec("ALTER TABLE defis ADD COLUMN emoji TEXT");
}
if (!colonnesDefis.includes('bonus')) {
  db.exec("ALTER TABLE defis ADD COLUMN bonus INTEGER NOT NULL DEFAULT 0");
}
if (!colonnesDefis.includes('media')) {
  db.exec("ALTER TABLE defis ADD COLUMN media TEXT");
}

// Paramètres par défaut (insérés une seule fois)
const PARAM_DEFAUTS = {
  jour_courant: 'auto',  // auto | weekend | J1 | J2
  j2_ouvert: '0',        // 0 | 1 — ouvert le dimanche matin par l'admin
  ia_activee: '1',       // 0 | 1 — interrupteur global de la pré-qualification IA
  verrou_final: '0',     // 0 | 1 — lecture seule après dépouillement
};
const insParam = db.prepare('INSERT OR IGNORE INTO parametres (cle, valeur) VALUES (?, ?)');
for (const [cle, valeur] of Object.entries(PARAM_DEFAUTS)) insParam.run(cle, valeur);
