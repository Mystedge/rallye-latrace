import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { getParam, jourEffectif, defiVisible } from '../params.js';
import {
  getBinomeByCode, getBinomeById, listDefisOrdonnes, getDefi,
  getSoumission, mapSoumissions, upsertSoumission,
} from '../repo.js';
import { traiterPhoto, stockerVideo } from '../images.js';
import { enqueue } from '../prequalif.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
// Enveloppe multer : transforme une erreur (fichier trop volumineux) en 413 propre
// pour que le client abandonne l'envoi au lieu de boucler.
function uploadPhoto(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ ok: false, erreur: 'Fichier trop volumineux.' });
    next();
  });
}

export const participant = Router();

function requireBinome(req, res, next) {
  if (!req.session?.binomeId) return res.redirect('/');
  next();
}

// Connexion
participant.get('/', (req, res) => {
  if (req.session?.binomeId) return res.redirect('/accueil');
  res.render('connexion', { erreur: null });
});

participant.post('/api/login', (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const binome = code && getBinomeByCode(code);
  if (!binome) {
    return res.status(401).render('connexion', { erreur: "Code inconnu. Vérifie auprès de l'organisation." });
  }
  req.session.binomeId = binome.id;
  res.redirect('/accueil');
});

participant.post('/api/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// Accueil : défis visibles, groupés, avec état de soumission
participant.get('/accueil', requireBinome, (req, res) => {
  const binome = getBinomeById(req.session.binomeId);
  if (!binome) { req.session = null; return res.redirect('/'); }
  const etat = mapSoumissions(binome.id);
  const score = Object.values(etat).reduce((s, e) => s + (e.statut === 'valide' && e.points ? e.points : 0), 0);
  const visibles = listDefisOrdonnes().filter(defiVisible);
  const groupes = {
    weekend: visibles.filter((d) => d.disponibilite === 'weekend'),
    jour: visibles.filter((d) => d.disponibilite !== 'weekend'),
  };
  res.render('accueil', { binome, groupes, etat, jour: jourEffectif(), score });
});

// Formulaire d'un défi (pré-rempli si déjà soumis)
participant.get('/defi/:id', requireBinome, (req, res) => {
  const defi = getDefi(Number(req.params.id));
  if (!defi || !defiVisible(defi)) return res.redirect('/accueil');
  const soumission = getSoumission(req.session.binomeId, defi.id);
  res.render('defi', { defi, soumission });
});

// Soumission (multipart) : upsert idempotent, réponse immédiate, pré-qualif déclenchée ensuite
participant.post('/api/soumissions', requireBinome, uploadPhoto, async (req, res) => {
  try {
    if (getParam('verrou_final') === '1') {
      return res.status(423).json({ ok: false, erreur: 'Le rallye est verrouillé.' });
    }
    const defiId = Number(req.body.defi_id);
    const defi = getDefi(defiId);
    if (!defi || !defiVisible(defi)) {
      return res.status(400).json({ ok: false, erreur: 'Défi indisponible.' });
    }

    const existante = getSoumission(req.session.binomeId, defiId);
    const anciennePhoto = existante?.photo_path ?? null;
    const ancienneThumb = existante?.thumb_path ?? null;
    let photo_path = anciennePhoto;
    let thumb_path = ancienneThumb;
    let remplacee = false;
    if (req.file?.buffer?.length) {
      if ((req.file.mimetype || '').startsWith('video/')) {
        photo_path = await stockerVideo(req.file.buffer, req.file.mimetype, req.file.originalname);
        thumb_path = null;
      } else {
        ({ photo_path, thumb_path } = await traiterPhoto(req.file.buffer));
      }
      remplacee = true;
    }
    const texte = req.body.texte ?? existante?.texte ?? null;

    if (texte == null && !photo_path) {
      return res.status(400).json({ ok: false, erreur: 'Réponse vide.' });
    }

    const id = upsertSoumission({ binomeId: req.session.binomeId, defiId, texte, photo_path, thumb_path });
    res.json({ ok: true, id });

    // Nettoyage : supprimer l'ancienne photo remplacée (best-effort, après réponse)
    if (remplacee && anciennePhoto && anciennePhoto !== photo_path) {
      for (const f of [anciennePhoto, ancienneThumb]) {
        if (f) unlink(join(config.uploadsDir, f)).catch(() => {});
      }
    }

    enqueue(id); // Epic 3 : pré-qualification asynchrone (no-op pour l'instant)
  } catch (e) {
    console.error('POST /api/soumissions :', e);
    res.status(500).json({ ok: false, erreur: 'Erreur serveur.' });
  }
});
