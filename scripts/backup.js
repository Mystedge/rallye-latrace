import Database from 'better-sqlite3';
import { mkdir, cp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';

const KEEP = 24; // nombre de snapshots de base à conserver

function horodatage() {
  // YYYY-MM-DD_HH-MM-SS (Date.now() est autorisé hors workflow)
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

async function main() {
  await mkdir(config.backupDir, { recursive: true });

  // 1) Snapshot de la base, à chaud et WAL-safe (API de sauvegarde en ligne better-sqlite3)
  const dbDest = join(config.backupDir, `rallye-${horodatage()}.db`);
  const db = new Database(config.dbPath, { readonly: true });
  await db.backup(dbDest);
  db.close();

  // 2) Photos : copie incrémentale vers le 2e emplacement
  if (existsSync(config.uploadsDir)) {
    await cp(config.uploadsDir, join(config.backupDir, 'uploads'), { recursive: true });
  }

  // 3) Rotation : ne garder que les KEEP derniers snapshots de base
  const snaps = (await readdir(config.backupDir))
    .filter((f) => /^rallye-.*\.db$/.test(f))
    .sort();
  for (const f of snaps.slice(0, Math.max(0, snaps.length - KEEP))) {
    await rm(join(config.backupDir, f), { force: true });
  }

  console.log(`[${new Date().toISOString()}] Sauvegarde OK -> ${dbDest} (+ uploads). Snapshots: ${Math.min(snaps.length, KEEP)}/${KEEP}`);
}

main().catch((e) => { console.error('Sauvegarde échouée:', e); process.exit(1); });
