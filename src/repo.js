import { db } from './db.js';
import { randomInt } from 'node:crypto';

// Ordre d'affichage piloté par la catégorie = le jour (week-end, puis J1, puis J2),
// puis ordre interne. Plus besoin de gérer un numéro d'ordre global à la main.
const _ORDRE_JOUR = "CASE disponibilite WHEN 'weekend' THEN 0 WHEN 'J1' THEN 1 WHEN 'J2' THEN 2 ELSE 3 END";

// --- Lectures ---
const _binomeByCode = db.prepare('SELECT * FROM binomes WHERE code = ?');
const _binomeById   = db.prepare('SELECT * FROM binomes WHERE id = ?');
const _defisOrdered  = db.prepare(`SELECT * FROM defis ORDER BY ${_ORDRE_JOUR}, ordre, id`);
const _defi          = db.prepare('SELECT * FROM defis WHERE id = ?');
const _soumission    = db.prepare('SELECT * FROM soumissions WHERE binome_id = ? AND defi_id = ?');
const _soumissionsBinome = db.prepare('SELECT defi_id, statut, points_attribues FROM soumissions WHERE binome_id = ?');

export const getBinomeByCode = (code) => _binomeByCode.get(code);
export const getBinomeById   = (id) => _binomeById.get(id);
export const listDefisOrdonnes = () => _defisOrdered.all();

// Défis filtrés (gestion admin)
export function listDefisFiltres({ disponibilite, type, mode_validation, bonus } = {}) {
  let sql = 'SELECT * FROM defis WHERE 1=1'; const p = [];
  if (disponibilite) { sql += ' AND disponibilite = ?'; p.push(disponibilite); }
  if (type)          { sql += ' AND type = ?'; p.push(type); }
  if (mode_validation) { sql += ' AND mode_validation = ?'; p.push(mode_validation); }
  if (bonus === '1' || bonus === '0') { sql += ' AND bonus = ?'; p.push(Number(bonus)); }
  return db.prepare(`${sql} ORDER BY ${_ORDRE_JOUR}, ordre, id`).all(...p);
}

// Prochain numéro d'ordre dans une catégorie (le jour), pour appendre un défi à la fin de son groupe
const _maxOrdreJour = db.prepare('SELECT COALESCE(MAX(ordre), 0) + 1 AS n FROM defis WHERE disponibilite = ?');
export const prochainOrdreJour = (dispo) => _maxOrdreJour.get(dispo).n;
export const getDefi = (id) => _defi.get(id);
export const getSoumission = (binomeId, defiId) => _soumission.get(binomeId, defiId);

// defiId -> { statut, points } (état + points attribués, pour l'affichage participant)
export function mapSoumissions(binomeId) {
  const m = Object.create(null);
  for (const r of _soumissionsBinome.all(binomeId)) m[r.defi_id] = { statut: r.statut, points: r.points_attribues };
  return m;
}

// --- Écriture : upsert idempotent (1 ligne par binôme×défi), réinitialise le cycle de validation ---
const _upsert = db.prepare(`
  INSERT INTO soumissions (binome_id, defi_id, texte, photo_path, thumb_path, statut, ia_verdict, submitted_at, updated_at)
  VALUES (@binomeId, @defiId, @texte, @photo_path, @thumb_path, 'soumis', 'non_evalue', datetime('now'), datetime('now'))
  ON CONFLICT(binome_id, defi_id) DO UPDATE SET
    texte            = excluded.texte,
    photo_path       = excluded.photo_path,
    thumb_path       = excluded.thumb_path,
    statut           = 'soumis',
    points_attribues = NULL,
    validation_auto  = 0,
    ia_verdict       = 'non_evalue',
    ia_confiance     = NULL,
    ia_commentaire   = NULL,
    ia_evalue_at     = NULL,
    validated_at     = NULL,
    updated_at       = datetime('now')
`);

export function upsertSoumission({ binomeId, defiId, texte, photo_path, thumb_path }) {
  _upsert.run({ binomeId, defiId, texte: texte ?? null, photo_path: photo_path ?? null, thumb_path: thumb_path ?? null });
  return _soumission.get(binomeId, defiId).id;
}

// --- Écritures de validation (Epic 3) ---
const _soumissionById = db.prepare('SELECT * FROM soumissions WHERE id = ?');
export const getSoumissionById = (id) => _soumissionById.get(id);

const _setStatutAuto = db.prepare(`
  UPDATE soumissions
  SET statut = ?, points_attribues = ?, validation_auto = 1,
      validated_at = datetime('now'), updated_at = datetime('now')
  WHERE id = ?
`);
export const setStatutAuto = (id, statut, points) => _setStatutAuto.run(statut, points, id);

const _setIaVerdict = db.prepare(`
  UPDATE soumissions
  SET ia_verdict = ?, ia_confiance = ?, ia_commentaire = ?,
      ia_evalue_at = datetime('now'), updated_at = datetime('now')
  WHERE id = ?
`);
export const setIaVerdict = (id, verdict, confiance, commentaire) =>
  _setIaVerdict.run(verdict, confiance, commentaire, id);

const _setIaErreur = db.prepare(`
  UPDATE soumissions
  SET ia_verdict = 'erreur', ia_evalue_at = datetime('now'), updated_at = datetime('now')
  WHERE id = ?
`);
export const setIaErreur = (id) => _setIaErreur.run(id);

// ─────────── Admin : revue & notation (Epic 4) ───────────
const _listBase = `
  SELECT s.*, b.nom AS binome_nom, d.titre AS defi_titre, d.reponse_attendue,
         d.points_max, d.mode_validation, d.type AS defi_type
  FROM soumissions s
  JOIN binomes b ON b.id = s.binome_id
  JOIN defis   d ON d.id = s.defi_id
  WHERE 1=1`;
// Tri : à juger d'abord (soumis), puis incertain/mauvais/erreur avant bon, puis récent
const _listTri = `
  ORDER BY (s.statut='soumis') DESC,
           CASE s.ia_verdict WHEN 'incertain' THEN 0 WHEN 'mauvais' THEN 1 WHEN 'erreur' THEN 2 WHEN 'bon' THEN 3 ELSE 4 END,
           s.updated_at DESC`;

function _filtreSoum({ binome, defi, statut, verdict }) {
  let sql = ''; const p = [];
  if (binome)  { sql += ' AND s.binome_id = ?'; p.push(binome); }
  if (defi)    { sql += ' AND s.defi_id = ?';   p.push(defi); }
  if (statut)  { sql += ' AND s.statut = ?';    p.push(statut); }
  if (verdict) { sql += ' AND s.ia_verdict = ?'; p.push(verdict); }
  return { sql, p };
}
// Liste paginée si limit fourni ; sinon toutes les soumissions filtrées
export function listSoumissions(f = {}) {
  const { sql, p } = _filtreSoum(f);
  let q = _listBase + sql + _listTri;
  if (f.limit != null) { q += ' LIMIT ? OFFSET ?'; p.push(f.limit, f.offset || 0); }
  return db.prepare(q).all(...p);
}
export function countSoumissions(f = {}) {
  const { sql, p } = _filtreSoum(f);
  return db.prepare('SELECT COUNT(*) AS n FROM soumissions s WHERE 1=1' + sql).get(...p).n;
}

const _valider = db.prepare(`UPDATE soumissions SET statut='valide', points_attribues=?, validation_auto=0, validated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`);
const _refuser = db.prepare(`UPDATE soumissions SET statut='refuse', points_attribues=NULL, validation_auto=0, validated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`);
const _supprimerSoumission = db.prepare('DELETE FROM soumissions WHERE id=?');
export const validerSoumission = (id, points) => _valider.run(points, id);
export const refuserSoumission = (id) => _refuser.run(id);
export const supprimerSoumission = (id) => _supprimerSoumission.run(id);

// ─────────── Épreuves en direct : attribution manuelle de points ───────────
// Crée/met à jour une soumission VALIDÉE (compte directement dans le classement).
const _upsertLive = db.prepare(`
  INSERT INTO soumissions (binome_id, defi_id, statut, points_attribues, validation_auto, validated_at, submitted_at, updated_at)
  VALUES (@binomeId, @defiId, 'valide', @points, 0, datetime('now'), datetime('now'), datetime('now'))
  ON CONFLICT(binome_id, defi_id) DO UPDATE SET
    statut='valide', points_attribues=@points, validation_auto=0, validated_at=datetime('now'), updated_at=datetime('now')
`);
export const attribuerPointsLive = (binomeId, defiId, points) => _upsertLive.run({ binomeId, defiId, points });
const _delSoumBinome = db.prepare('DELETE FROM soumissions WHERE binome_id = ? AND defi_id = ?');
export const retirerSoumissionBinome = (binomeId, defiId) => _delSoumBinome.run(binomeId, defiId);
// binomeId -> points attribués pour un défi (pré-remplissage de l'écran « Points en direct »)
const _soumParDefi = db.prepare('SELECT binome_id, points_attribues FROM soumissions WHERE defi_id = ?');
export function pointsParBinome(defiId) {
  const m = Object.create(null);
  for (const r of _soumParDefi.all(defiId)) m[r.binome_id] = r.points_attribues;
  return m;
}

// ─────────── Admin : CRUD défis ───────────
const _creerDefi = db.prepare(`INSERT INTO defis (titre,description,emoji,bonus,media,live,image_consigne,type,disponibilite,mode_validation,critere_ia,reponse_attendue,points_max,ordre)
  VALUES (@titre,@description,@emoji,@bonus,@media,@live,@image_consigne,@type,@disponibilite,@mode_validation,@critere_ia,@reponse_attendue,@points_max,@ordre)`);
const _majDefi = db.prepare(`UPDATE defis SET titre=@titre,description=@description,emoji=@emoji,bonus=@bonus,media=@media,live=@live,image_consigne=@image_consigne,type=@type,disponibilite=@disponibilite,
  mode_validation=@mode_validation,critere_ia=@critere_ia,reponse_attendue=@reponse_attendue,points_max=@points_max,ordre=@ordre WHERE id=@id`);
export const creerDefi = (d) => _creerDefi.run(d).lastInsertRowid;
export const majDefi = (id, d) => _majDefi.run({ ...d, id });
export const supprimerDefi = db.transaction((id) => {
  db.prepare('DELETE FROM soumissions WHERE defi_id=?').run(id);
  db.prepare('DELETE FROM defis WHERE id=?').run(id);
});

// ─────────── Admin : CRUD binômes ───────────
export const listBinomes = () => db.prepare('SELECT * FROM binomes ORDER BY id').all();
const _creerBinome = db.prepare('INSERT INTO binomes (nom, code) VALUES (?, ?)');
const _majBinome = db.prepare('UPDATE binomes SET nom=?, code=? WHERE id=?');
export const creerBinome = (nom, code) => _creerBinome.run(nom, code).lastInsertRowid;
export const majBinome = (id, nom, code) => _majBinome.run(nom, code, id);
export const supprimerBinome = db.transaction((id) => {
  db.prepare('DELETE FROM soumissions WHERE binome_id=?').run(id);
  db.prepare('DELETE FROM binomes WHERE id=?').run(id);
});

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = (n = 6) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export function genererCodeUnique() {
  const used = new Set(db.prepare('SELECT code FROM binomes').all().map((r) => r.code));
  let c; do { c = genCode(); } while (used.has(c));
  return c;
}

// ─────────── Admin : classement ───────────
export const classement = () => db.prepare(`
  SELECT b.id, b.nom,
         COALESCE(SUM(CASE WHEN s.statut='valide' THEN s.points_attribues ELSE 0 END), 0) AS total,
         SUM(CASE WHEN s.statut='valide' THEN 1 ELSE 0 END) AS nb_valides
  FROM binomes b LEFT JOIN soumissions s ON s.binome_id = b.id
  GROUP BY b.id ORDER BY total DESC, b.nom`).all();
