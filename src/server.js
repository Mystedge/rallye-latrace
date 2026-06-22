import express from 'express';
import cookieSession from 'cookie-session';
import { join } from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { jourEffectif, getParam, setParam } from './params.js';
import { participant } from './routes/participant.js';
import { admin } from './routes/admin.js';
import { executerSeed, synchroniserEmojis, synchroniserMedia, migrerBonusDepuisTitre, renumeroterOrdreParJour } from './seed.js';
import { snapshotBase } from '../scripts/backup.js';

// Seed automatique au tout premier démarrage si la base est vide
// (permet un déploiement via panel, sans aucune commande à taper).
if (db.prepare('SELECT COUNT(*) n FROM binomes').get().n === 0) {
  const binomes = executerSeed();
  console.log('Base vide -> seed initial. Codes de connexion des binômes :');
  for (const b of binomes) console.log(`  ${b.code}  ->  ${b.nom}`);
}

// Migre le statut « bonus » du titre vers le champ dédié (idempotent).
const nBonus = migrerBonusDepuisTitre();
if (nBonus > 0) console.log(`Défis bonus migrés depuis le titre : ${nBonus}.`);

// Synchronise les émojis des défis depuis defis.json (idempotent, préserve les éditions admin).
const nEmojis = synchroniserEmojis();
if (nEmojis > 0) console.log(`Émojis des défis synchronisés : ${nEmojis} mis à jour.`);

// Synchronise le média attendu (photo/vidéo) depuis defis.json (préserve les choix admin).
const nMedia = synchroniserMedia();
if (nMedia > 0) console.log(`Média des défis synchronisé : ${nMedia} mis à jour.`);

// Migration unique : ordre des défis renuméroté par catégorie (1..N par jour) au lieu d'un
// classement global. Joué une seule fois (sinon écraserait les ordres édités ensuite en admin).
if (getParam('ordre_par_jour') !== '1') {
  const n = renumeroterOrdreParJour();
  setParam('ordre_par_jour', '1');
  console.log(`Ordre des défis renuméroté par catégorie : ${n}.`);
}

// Snapshots réguliers de la base (WAL-safe, dans /data/backup) — embarqués hors-VPS par rclone.
const BACKUP_INTERVAL_MS = 15 * 60 * 1000;
snapshotBase().catch((e) => console.error('Snapshot initial échoué :', e.message));
setInterval(() => snapshotBase().catch((e) => console.error('Snapshot périodique échoué :', e.message)), BACKUP_INTERVAL_MS);

const app = express();

app.set('view engine', 'ejs');
app.set('views', join(config.root, 'src', 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieSession({
  name: 'rallye',
  keys: [config.sessionSecret],
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  httpOnly: true,
  sameSite: 'lax',
}));

// Photos (servies en statique) puis assets publics
app.use('/uploads', express.static(config.uploadsDir));
app.use(express.static(join(config.root, 'public')));

// Routes participant (connexion, accueil, défis, soumissions)
app.use(participant);
// Routes admin (revue, notation, CRUD, réglages, classement)
app.use(admin);

// Santé / preuve de vie
app.get('/sante', (req, res) => {
  res.json({
    ok: true,
    binomes: db.prepare('SELECT COUNT(*) n FROM binomes').get().n,
    defis: db.prepare('SELECT COUNT(*) n FROM defis').get().n,
    soumissions: db.prepare('SELECT COUNT(*) n FROM soumissions').get().n,
    jour_effectif: jourEffectif(),
    j2_ouvert: getParam('j2_ouvert'),
    ia_activee: getParam('ia_activee'),
    verrou_final: getParam('verrou_final'),
  });
});

app.listen(config.port, () => {
  console.log(`Rallye La Trace — en écoute sur http://localhost:${config.port}`);
});
