import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, isAbsolute } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Charge .env s'il existe (Node >= 20.12). Optionnel : tout a un défaut.
try {
  if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
} catch { /* .env optionnel */ }

const depuisRacine = (valeur, defaut) => {
  const v = valeur || defaut;
  return isAbsolute(v) ? v : resolve(root, v);
};

export const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-non-securise',
  dbPath: depuisRacine(process.env.DB_PATH, './data/rallye.db'),
  uploadsDir: depuisRacine(process.env.UPLOADS_DIR, './uploads'),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  backupDir: depuisRacine(process.env.BACKUP_DIR, './backup'),
};
