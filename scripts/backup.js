import Database from 'better-sqlite3';
import { mkdir, cp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';

const KEEP = 24; // nombre de snapshots de base à conserver localement (rotation)

function horodatage() {
  // YYYY-MM-DD_HH-MM-SS (Date.now() est autorisé hors workflow)
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// Snapshot de la base à chaud et WAL-safe (API de sauvegarde en ligne better-sqlite3),
// + rotation. C'est ce snapshot consistant que rclone embarque ensuite vers le cloud.
export async function snapshotBase() {
  await mkdir(config.backupDir, { recursive: true });
  const dbDest = join(config.backupDir, `rallye-${horodatage()}.db`);
  const db = new Database(config.dbPath, { readonly: true });
  await db.backup(dbDest);
  db.close();

  const snaps = (await readdir(config.backupDir))
    .filter((f) => /^rallye-.*\.db$/.test(f))
    .sort();
  for (const f of snaps.slice(0, Math.max(0, snaps.length - KEEP))) {
    await rm(join(config.backupDir, f), { force: true });
  }
  return dbDest;
}

// Sauvegarde complète locale (snapshot base + copie des uploads) — pour `npm run backup`.
async function complet() {
  const dbDest = await snapshotBase();
  if (existsSync(config.uploadsDir)) {
    await cp(config.uploadsDir, join(config.backupDir, 'uploads'), { recursive: true });
  }
  console.log(`[${new Date().toISOString()}] Sauvegarde OK -> ${dbDest} (+ uploads).`);
}

// Exécution directe : `npm run backup`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  complet().catch((e) => { console.error('Sauvegarde échouée:', e); process.exit(1); });
}
