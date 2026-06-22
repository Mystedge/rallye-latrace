import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from './config.js';

// Buffer image reçu -> photo (~1600 px) + miniature (~1024 px) sur disque.
// Filet de sécurité serveur : auto-orientation EXIF + re-encodage JPEG (la compression
// principale est déjà faite côté navigateur).
export async function traiterPhoto(buffer) {
  const base = randomUUID();
  const photo = `${base}.jpg`;
  const thumb = `${base}.thumb.jpg`;

  const pipeline = sharp(buffer, { failOn: 'none' }).rotate(); // .rotate() sans arg = auto-orient EXIF

  await pipeline.clone()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(join(config.uploadsDir, photo));

  await pipeline.clone()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(join(config.uploadsDir, thumb));

  return { photo_path: photo, thumb_path: thumb };
}
