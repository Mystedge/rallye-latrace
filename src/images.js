import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from './config.js';

// Image de consigne (illustration d'un défi) : une seule image redimensionnée.
export async function traiterImage(buffer) {
  const nom = `${randomUUID()}.jpg`;
  await sharp(buffer, { failOn: 'none' }).rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(join(config.uploadsDir, nom));
  return nom;
}

// Vidéo : stockée telle quelle (pas de ré-encodage serveur). Extension dérivée du
// type MIME, restreinte à une liste sûre. Pas de miniature.
const EXT_VIDEO = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/3gpp': '3gp' };
const VIDEO_EXTS = new Set(Object.values(EXT_VIDEO));
export async function stockerVideo(buffer, mimetype, originalname) {
  let ext = EXT_VIDEO[mimetype];
  if (!ext && originalname) { const m = /\.([a-z0-9]{2,4})$/i.exec(originalname); if (m) ext = m[1].toLowerCase(); }
  if (!VIDEO_EXTS.has(ext)) ext = 'mp4';
  const nom = `${randomUUID()}.${ext}`;
  await writeFile(join(config.uploadsDir, nom), buffer);
  return nom;
}

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
