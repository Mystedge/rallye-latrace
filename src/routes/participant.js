import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { getParam, jourEffectif, defiVisible } from '../params.js';
import {
  getBinomeByCode, getBinomeById, listDefisOrdonnes, getDefi,
  getSoumission, mapSoumissions, upsertSoumission, classement,
} from '../repo.js';
import { traiterPhoto, stockerVideo } from '../images.js';
import { enqueue } from '../prequalif.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 160 * 1024 * 1024, files: 10 } });
// Enveloppe multer : jusqu'à 10 fichiers (défis multi-photos). Erreur (trop gros / trop
// nombreux) -> 413/400 propre pour que le client abandonne au lieu de boucler.
function uploadPhotos(req, res, next) {
  upload.array('photo', 10)(req, res, (err) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ ok: false, erreur: 'Fichier trop volumineux ou trop nombreux.' });
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
  // Défis « en direct » : masqués tant que l'orga n'a pas attribué de points à ce binôme.
  const visibles = listDefisOrdonnes().filter((d) => (d.live ? !!etat[d.id] : defiVisible(d)));
  const groupes = {
    weekend: visibles.filter((d) => d.disponibilite === 'weekend'),
    jour: visibles.filter((d) => d.disponibilite !== 'weekend'),
  };
  res.render('accueil', { binome, groupes, etat, jour: jourEffectif(), score, classementVisible: getParam('classement_visible') === '1' });
});

// Classement général (visible seulement si l'orga l'a activé dans les réglages)
participant.get('/classement', requireBinome, (req, res) => {
  if (getParam('classement_visible') !== '1') return res.redirect('/accueil');
  res.render('classement', { lignes: classement(), binomeId: req.session.binomeId });
});

// Formulaire d'un défi (pré-rempli si déjà soumis)
participant.get('/defi/:id', requireBinome, (req, res) => {
  const defi = getDefi(Number(req.params.id));
  if (!defi) return res.redirect('/accueil');
  const soumission = getSoumission(req.session.binomeId, defi.id);
  // Défi live : accessible seulement si l'orga a attribué des points à ce binôme.
  const accessible = defi.live ? !!soumission : defiVisible(defi);
  if (!accessible) return res.redirect('/accueil');
  res.render('defi', { defi, soumission });
});

// Soumission (multipart, 1..N fichiers) : upsert idempotent, réponse immédiate, pré-qualif ensuite
participant.post('/api/soumissions', requireBinome, uploadPhotos, async (req, res) => {
  try {
    if (getParam('verrou_final') === '1') {
      return res.status(423).json({ ok: false, erreur: 'Le rallye est verrouillé.' });
    }
    const defiId = Number(req.body.defi_id);
    const defi = getDefi(defiId);
    if (!defi || !defiVisible(defi) || defi.live) {
      return res.status(400).json({ ok: false, erreur: 'Défi indisponible.' });
    }

    const existante = getSoumission(req.session.binomeId, defiId);
    let photo_path = existante?.photo_path ?? null;
    let thumb_path = existante?.thumb_path ?? null;
    let photos = existante?.photos ?? null;
    let remplacee = false;

    const fichiers = (req.files || []).filter((f) => f.buffer?.length);
    if (fichiers.length) {
      const medias = [];
      for (const f of fichiers) {
        if ((f.mimetype || '').startsWith('video/')) {
          medias.push({ p: await stockerVideo(f.buffer, f.mimetype, f.originalname), t: null });
        } else {
          const r = await traiterPhoto(f.buffer);
          medias.push({ p: r.photo_path, t: r.thumb_path });
        }
      }
      photo_path = medias[0].p;          // 1er média = compat (classement, IA, affichage simple)
      thumb_path = medias[0].t;
      photos = medias.length > 1 ? JSON.stringify(medias) : null;
      remplacee = true;
    }
    const texte = req.body.texte ?? existante?.texte ?? null;

    if (texte == null && !photo_path) {
      return res.status(400).json({ ok: false, erreur: 'Réponse vide.' });
    }

    const id = upsertSoumission({ binomeId: req.session.binomeId, defiId, texte, photo_path, thumb_path, photos });
    res.json({ ok: true, id });

    // Nettoyage : supprimer les anciens fichiers remplacés (best-effort, après réponse)
    if (remplacee) {
      const anciens = [existante?.photo_path, existante?.thumb_path];
      if (existante?.photos) { try { for (const m of JSON.parse(existante.photos)) anciens.push(m.p, m.t); } catch { /* ignore */ } }
      const nouveaux = new Set([photo_path, thumb_path, ...(photos ? JSON.parse(photos).flatMap((m) => [m.p, m.t]) : [])]);
      for (const f of anciens) {
        if (f && !nouveaux.has(f)) unlink(join(config.uploadsDir, f)).catch(() => {});
      }
    }

    enqueue(id); // Epic 3 : pré-qualification asynchrone (no-op pour l'instant)
  } catch (e) {
    console.error('POST /api/soumissions :', e);
    res.status(500).json({ ok: false, erreur: 'Erreur serveur.' });
  }
});
