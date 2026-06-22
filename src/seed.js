import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Code de connexion lisible et non devinable (sans I, O, 0, 1)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = (n = 6) =>
  Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const BINOMES = [
  'Eric & Christine/Chloé',
  'Eric & Nathalie',
  'Tanguy & Fanny',
  'Fred & Yannick',
  'Pascal & Virginie',
  'Stephane & Christophe',
  'Nico & Jean',
  'Constance & Leo',
];

// Défis issus des roadbooks (week-end + J1 + J2). Source de vérité : src/data/defis.json
let DEFIS = [];
try {
  DEFIS = JSON.parse(readFileSync(join(__dirname, 'data', 'defis.json'), 'utf8'));
} catch (e) {
  console.error('⚠ src/data/defis.json introuvable — seed des défis ignoré:', e.message);
}

const findBinome = db.prepare('SELECT id, code FROM binomes WHERE nom = ?');
const insBinome = db.prepare('INSERT INTO binomes (nom, code) VALUES (?, ?)');
const findDefi = db.prepare('SELECT id FROM defis WHERE titre = ?');
const insDefi = db.prepare(`
  INSERT INTO defis (titre, description, emoji, bonus, media, type, disponibilite, mode_validation, reponse_attendue, critere_ia, points_max, ordre)
  VALUES (@titre, @description, @emoji, @bonus, @media, @type, @disponibilite, @mode_validation, @reponse_attendue, @critere_ia, @points_max, @ordre)
`);

function codeUnique() {
  const utilises = new Set(db.prepare('SELECT code FROM binomes').all().map((r) => r.code));
  let c;
  do { c = genCode(); } while (utilises.has(c));
  return c;
}

// Idempotent : ajoute les binômes manquants (codes préservés) et les défis manquants.
export function executerSeed() {
  const tx = db.transaction(() => {
    const binomes = [];
    for (const nom of BINOMES) {
      let row = findBinome.get(nom);
      if (!row) {
        const code = codeUnique();
        insBinome.run(nom, code);
        row = { code };
      }
      binomes.push({ nom, code: row.code });
    }
    for (const d of DEFIS) {
      if (!findDefi.get(d.titre)) {
        insDefi.run({
          titre: d.titre,
          description: d.description || '',
          emoji: d.emoji ?? null,
          bonus: d.bonus ? 1 : 0,
          media: d.media ?? null,
          type: d.type || 'photo',
          disponibilite: d.disponibilite || 'weekend',
          mode_validation: d.mode_validation || 'manuel',
          reponse_attendue: d.reponse_attendue ?? null,
          critere_ia: d.critere_ia ?? null,
          points_max: d.points_max ?? 10,
          ordre: d.ordre ?? 0,
        });
      }
    }
    return binomes;
  });
  return tx();
}

// Backfill des émojis depuis defis.json — idempotent, joué à chaque démarrage.
// Ne remplit que les défis sans émoji (les éditions faites en admin sont préservées).
const _backfillEmoji = db.prepare(
  "UPDATE defis SET emoji = @emoji WHERE titre = @titre AND (emoji IS NULL OR emoji = '')"
);
export function synchroniserEmojis() {
  let n = 0;
  db.transaction(() => {
    for (const d of DEFIS) {
      if (d.emoji) n += _backfillEmoji.run({ titre: d.titre, emoji: d.emoji }).changes;
    }
  })();
  return n;
}

// Backfill du média attendu (photo/vidéo) depuis defis.json — ne touche que les défis
// dont le média n'a jamais été défini (NULL), pour préserver les choix faits en admin.
const _backfillMedia = db.prepare('UPDATE defis SET media = @media WHERE titre = @titre AND media IS NULL');
export function synchroniserMedia() {
  let n = 0;
  db.transaction(() => {
    for (const d of DEFIS) {
      if (d.media) n += _backfillMedia.run({ titre: d.titre, media: d.media }).changes;
    }
  })();
  return n;
}

// Renumérote l'ordre des défis par catégorie (1, 2, 3… par jour) au lieu d'un classement
// global. À jouer UNE SEULE FOIS (sinon écraserait les ordres édités en admin) — voir le
// garde-fou par paramètre dans server.js. Conserve l'ordre relatif existant.
const _defisDuJour = db.prepare('SELECT id FROM defis WHERE disponibilite = ? ORDER BY ordre, id');
const _setOrdre = db.prepare('UPDATE defis SET ordre = ? WHERE id = ?');
export function renumeroterOrdreParJour() {
  let n = 0;
  db.transaction(() => {
    for (const dispo of ['weekend', 'J1', 'J2']) {
      _defisDuJour.all(dispo).forEach((r, i) => { _setOrdre.run(i + 1, r.id); n++; });
    }
  })();
  return n;
}

// Migration unique : le statut « bonus » devient un champ. On le déduit du préfixe
// « Bonus — » des titres existants, qu'on retire au passage. Idempotent (rien à faire
// une fois les titres nettoyés). Joué à chaque démarrage.
const PREFIXE_BONUS = /^bonus\s*[—–-]\s*/i;
const _rowsBonus = db.prepare("SELECT id, titre FROM defis WHERE titre LIKE 'Bonus%'");
const _setBonus = db.prepare('UPDATE defis SET bonus = 1, titre = ? WHERE id = ?');
export function migrerBonusDepuisTitre() {
  let n = 0;
  db.transaction(() => {
    for (const r of _rowsBonus.all()) {
      const m = PREFIXE_BONUS.exec(r.titre);
      if (m) { _setBonus.run(r.titre.slice(m[0].length).trim(), r.id); n++; }
    }
  })();
  return n;
}

// Exécution directe : `npm run seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const binomes = executerSeed();
  const compte = (dispo) => db.prepare('SELECT COUNT(*) n FROM defis WHERE disponibilite = ?').get(dispo).n;
  console.log('— Seed Rallye La Trace 2026 —');
  console.log(`Binômes : ${db.prepare('SELECT COUNT(*) n FROM binomes').get().n}`);
  console.log(`Défis : week-end ${compte('weekend')} · J1 ${compte('J1')} · J2 ${compte('J2')} · total ${db.prepare('SELECT COUNT(*) n FROM defis').get().n}`);
  console.log('\nCodes de connexion des binômes :');
  for (const b of binomes) console.log(`  ${b.code}   →   ${b.nom}`);
  console.log('\n(Modes/réponses/critères à affiner dans l\'espace admin.)');
}
