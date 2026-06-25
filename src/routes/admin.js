import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { getParam, setParam, jourEffectif } from '../params.js';
import {
  listSoumissions, countSoumissions, getSoumissionById, validerSoumission, refuserSoumission, supprimerSoumission,
  listDefisOrdonnes, listDefisFiltres, prochainOrdreJour, getDefi, creerDefi, majDefi, supprimerDefi,
  attribuerPointsLive, retirerSoumissionBinome, pointsParBinome,
  listBinomes, getBinomeById, creerBinome, majBinome, supprimerBinome, genererCodeUnique,
  classement,
} from '../repo.js';
import { traiterImage } from '../images.js';
import { reevaluer } from '../prequalif.js';

const TAILLES_PAGE = [10, 25, 50, 100];

// Upload de l'image de consigne (défi). Tolérant : si erreur (trop lourde), on ignore le fichier.
const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
function uploadConsigne(req, res, next) {
  uploadImage.single('image_consigne')(req, res, () => next());
}

export const admin = Router();

const requireAdmin = (req, res, next) => (req.session?.admin ? next() : res.redirect('/admin/login'));
const verrouille = () => getParam('verrou_final') === '1';

// ── Authentification ──
admin.get('/admin/login', (req, res) =>
  req.session?.admin ? res.redirect('/admin/revue') : res.render('admin/login', { erreur: null }));

admin.post('/admin/login', (req, res) => {
  if (String(req.body.password || '') === config.adminPassword) {
    req.session.admin = true;
    return res.redirect('/admin/revue');
  }
  res.status(401).render('admin/login', { erreur: 'Mot de passe incorrect.' });
});

admin.post('/admin/logout', (req, res) => { if (req.session) req.session.admin = false; res.redirect('/admin/login'); });
admin.get('/admin', requireAdmin, (req, res) => res.redirect('/admin/revue'));

// ── Revue ──
admin.get('/admin/revue', requireAdmin, (req, res) => {
  // Par défaut (aucun filtre dans l'URL, ex. clic sur « Soumissions ») : seulement les soumissions à juger.
  const filtres = {
    binome: req.query.binome || '', defi: req.query.defi || '',
    statut: req.query.statut === undefined ? 'soumis' : req.query.statut, verdict: req.query.verdict || '',
  };
  const f = {
    binome: filtres.binome ? Number(filtres.binome) : null,
    defi: filtres.defi ? Number(filtres.defi) : null,
    statut: filtres.statut || null,
    verdict: filtres.verdict || null,
  };
  const taille = TAILLES_PAGE.includes(Number(req.query.taille)) ? Number(req.query.taille) : 25;
  const total = countSoumissions(f);
  const pages = Math.max(1, Math.ceil(total / taille));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  const soumissions = listSoumissions({ ...f, limit: taille, offset: (page - 1) * taille });
  const qp = new URLSearchParams();
  for (const k of ['binome', 'defi', 'verdict']) if (filtres[k]) qp.set(k, filtres[k]);
  qp.set('statut', filtres.statut); // toujours présent pour conserver le choix en pagination (y compris « tout » = '')
  qp.set('taille', String(taille));
  res.render('admin/revue', {
    soumissions, filtres, binomes: listBinomes(), defis: listDefisOrdonnes(), verrou: verrouille(),
    pagination: { page, pages, taille, total, tailles: TAILLES_PAGE, qsBase: qp.toString() },
  });
});

admin.post('/admin/api/soumissions/:id/valider', requireAdmin, (req, res) => {
  if (verrouille()) return res.status(423).json({ ok: false, erreur: 'Rallye verrouillé.' });
  const s = getSoumissionById(Number(req.params.id));
  if (!s) return res.status(404).json({ ok: false });
  let pts = Number(req.body.points);
  if (!Number.isFinite(pts)) pts = getDefi(s.defi_id)?.points_max ?? 0;
  pts = Math.max(0, Math.round(pts));
  validerSoumission(s.id, pts);
  res.json({ ok: true, statut: 'valide', points: pts });
});

admin.post('/admin/api/soumissions/:id/refuser', requireAdmin, (req, res) => {
  if (verrouille()) return res.status(423).json({ ok: false, erreur: 'Rallye verrouillé.' });
  const s = getSoumissionById(Number(req.params.id));
  if (!s) return res.status(404).json({ ok: false });
  refuserSoumission(s.id);
  res.json({ ok: true, statut: 'refuse' });
});

admin.post('/admin/api/soumissions/:id/supprimer', requireAdmin, (req, res) => {
  if (verrouille()) return res.status(423).json({ ok: false, erreur: 'Rallye verrouillé.' });
  const s = getSoumissionById(Number(req.params.id));
  if (!s) return res.status(404).json({ ok: false });
  supprimerSoumission(s.id);
  for (const f of [s.photo_path, s.thumb_path]) {
    if (f) unlink(join(config.uploadsDir, f)).catch(() => {});
  }
  res.json({ ok: true });
});

admin.post('/admin/api/soumissions/:id/reevaluer', requireAdmin, (req, res) => {
  const s = getSoumissionById(Number(req.params.id));
  if (!s) return res.status(404).json({ ok: false });
  reevaluer(s.id);
  res.json({ ok: true });
});

admin.post('/admin/api/valider-lot', requireAdmin, (req, res) => {
  if (verrouille()) return res.status(423).json({ ok: false, erreur: 'Rallye verrouillé.' });
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  let n = 0;
  for (const raw of ids) {
    const s = getSoumissionById(Number(raw));
    if (s) { validerSoumission(s.id, getDefi(s.defi_id)?.points_max ?? 0); n++; }
  }
  res.json({ ok: true, n });
});

// ── CRUD défis ──
// « Type de réponse » (un seul menu admin) -> structure (type) + média attendu (media).
const TYPE_REPONSE = {
  photo:             { type: 'photo', media: 'photo' },
  video:             { type: 'photo', media: 'video' },
  photo_video:       { type: 'photo', media: 'photo_video' },
  texte:             { type: 'texte', media: 'photo' },
  photo_texte:       { type: 'mixte', media: 'photo' },
  video_texte:       { type: 'mixte', media: 'video' },
  photo_video_texte: { type: 'mixte', media: 'photo_video' },
};
function defiDepuisBody(body) {
  const tr = TYPE_REPONSE[body.type_reponse] || TYPE_REPONSE.photo;
  return {
    titre: String(body.titre || '').trim(),
    description: String(body.description || ''),
    emoji: body.emoji ? String(body.emoji).trim() : null,
    bonus: body.bonus ? 1 : 0,
    media: tr.media,
    live: body.live ? 1 : 0,
    multi_photos: body.multi_photos ? 1 : 0,
    nb_choix_binomes: Math.min(8, Math.max(0, Number(body.nb_choix_binomes) || 0)),
    type: tr.type,
    disponibilite: ['weekend', 'J1', 'J2'].includes(body.disponibilite) ? body.disponibilite : 'weekend',
    mode_validation: ['manuel', 'auto', 'ia'].includes(body.mode_validation) ? body.mode_validation : 'manuel',
    critere_ia: body.critere_ia ? String(body.critere_ia) : null,
    reponse_attendue: body.reponse_attendue ? String(body.reponse_attendue) : null,
    points_max: Math.max(0, Number(body.points_max) || 0),
    ordre: Number(body.ordre) || 0, // position dans la catégorie (le jour) ; 0 => auto à la création
  };
}

admin.get('/admin/defis', requireAdmin, (req, res) => {
  const filtres = {
    disponibilite: req.query.disponibilite || '', type: req.query.type || '',
    mode_validation: req.query.mode_validation || '', bonus: req.query.bonus || '',
  };
  res.render('admin/defis', { defis: listDefisFiltres(filtres), filtres });
});
admin.get('/admin/defis/nouveau', requireAdmin, (req, res) => res.render('admin/defi-form', { defi: null }));
admin.get('/admin/defis/:id', requireAdmin, (req, res) => {
  const defi = getDefi(Number(req.params.id));
  if (!defi) return res.redirect('/admin/defis');
  res.render('admin/defi-form', { defi });
});
admin.post('/admin/defis', requireAdmin, uploadConsigne, async (req, res) => {
  const d = defiDepuisBody(req.body);
  if (!d.titre) return res.redirect('/admin/defis');
  let image_consigne = null;
  if (req.file?.buffer?.length) image_consigne = await traiterImage(req.file.buffer);
  creerDefi({ ...d, image_consigne, ordre: d.ordre || prochainOrdreJour(d.disponibilite) });
  res.redirect('/admin/defis');
});
admin.post('/admin/defis/:id', requireAdmin, uploadConsigne, async (req, res) => {
  const d = defiDepuisBody(req.body);
  const actuel = getDefi(Number(req.params.id));
  if (!d.titre || !actuel) return res.redirect('/admin/defis');
  let image_consigne = actuel.image_consigne;
  if (req.body.supprimer_image && image_consigne) {
    unlink(join(config.uploadsDir, image_consigne)).catch(() => {});
    image_consigne = null;
  }
  if (req.file?.buffer?.length) {
    if (image_consigne) unlink(join(config.uploadsDir, image_consigne)).catch(() => {});
    image_consigne = await traiterImage(req.file.buffer);
  }
  majDefi(actuel.id, { ...d, image_consigne, ordre: d.ordre || actuel.ordre });
  res.redirect('/admin/defis');
});
admin.post('/admin/defis/:id/supprimer', requireAdmin, (req, res) => { supprimerDefi(Number(req.params.id)); res.redirect('/admin/defis'); });

// ── Épreuves en direct : attribution manuelle de points par binôme (défis « live » uniquement) ──
admin.get('/admin/defis/:id/points', requireAdmin, (req, res) => {
  const defi = getDefi(Number(req.params.id));
  if (!defi || !defi.live) return res.redirect('/admin/defis');
  res.render('admin/defi-points', { defi, binomes: listBinomes(), points: pointsParBinome(defi.id), verrou: verrouille() });
});
admin.post('/admin/defis/:id/points', requireAdmin, (req, res) => {
  const defi = getDefi(Number(req.params.id));
  if (!defi || !defi.live) return res.redirect('/admin/defis');
  if (verrouille()) return res.redirect(`/admin/defis/${defi.id}/points`);
  for (const b of listBinomes()) {
    const raw = req.body['pts_' + b.id];
    if (raw === undefined || String(raw).trim() === '') retirerSoumissionBinome(b.id, defi.id);
    else attribuerPointsLive(b.id, defi.id, Math.max(0, Math.round(Number(raw) || 0)));
  }
  res.redirect(`/admin/defis/${defi.id}/points`);
});

// ── Dépouillement des votes (défis « choix de binômes ») ──
admin.get('/admin/defis/:id/votes', requireAdmin, (req, res) => {
  const defi = getDefi(Number(req.params.id));
  if (!defi || !defi.nb_choix_binomes) return res.redirect('/admin/defis');
  const binomes = listBinomes();
  const compte = new Map(binomes.map((b) => [b.nom, 0])); // tous les binômes, même 0 vote
  const votants = [];
  for (const s of listSoumissions({ defi: defi.id })) {
    if (!s.texte) continue;
    const choix = s.texte.split(',').map((x) => x.trim()).filter(Boolean);
    votants.push({ nom: s.binome_nom, choix });
    for (const c of choix) compte.set(c, (compte.get(c) || 0) + 1);
  }
  const classementVotes = [...compte.entries()]
    .map(([nom, votes]) => ({ nom, votes }))
    .sort((a, b) => b.votes - a.votes || a.nom.localeCompare(b.nom));
  res.render('admin/defi-votes', { defi, classementVotes, votants, nbVotants: votants.length });
});

// ── CRUD binômes ──
admin.get('/admin/binomes', requireAdmin, (req, res) =>
  res.render('admin/binomes', { binomes: listBinomes(), erreur: req.query.erreur || null }));

admin.post('/admin/binomes', requireAdmin, (req, res) => {
  const nom = String(req.body.nom || '').trim();
  let code = String(req.body.code || '').trim().toUpperCase();
  if (!nom) return res.redirect('/admin/binomes');
  if (!code) code = genererCodeUnique();
  try { creerBinome(nom, code); }
  catch { return res.redirect('/admin/binomes?erreur=' + encodeURIComponent('Code déjà utilisé.')); }
  res.redirect('/admin/binomes');
});

admin.post('/admin/binomes/:id', requireAdmin, (req, res) => {
  const nom = String(req.body.nom || '').trim();
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!nom || !code) return res.redirect('/admin/binomes');
  try { majBinome(Number(req.params.id), nom, code); }
  catch { return res.redirect('/admin/binomes?erreur=' + encodeURIComponent('Code déjà utilisé.')); }
  res.redirect('/admin/binomes');
});

admin.post('/admin/binomes/:id/code', requireAdmin, (req, res) => {
  const b = getBinomeById(Number(req.params.id));
  if (b) majBinome(b.id, b.nom, genererCodeUnique());
  res.redirect('/admin/binomes');
});

admin.post('/admin/binomes/:id/supprimer', requireAdmin, (req, res) => { supprimerBinome(Number(req.params.id)); res.redirect('/admin/binomes'); });

// ── Classement ──
admin.get('/admin/classement', requireAdmin, (req, res) => res.render('admin/classement', { lignes: classement() }));

// ── Réglages ──
admin.get('/admin/reglages', requireAdmin, (req, res) => res.render('admin/reglages', {
  jour_courant: getParam('jour_courant'),
  j2_ouvert: getParam('j2_ouvert'),
  ia_activee: getParam('ia_activee'),
  verrou_final: getParam('verrou_final'),
  classement_visible: getParam('classement_visible'),
  jour_effectif: jourEffectif(),
  cle_ia: Boolean(config.anthropicApiKey),
}));

admin.post('/admin/reglages', requireAdmin, (req, res) => {
  const jc = ['auto', 'weekend', 'J1', 'J2'].includes(req.body.jour_courant) ? req.body.jour_courant : 'auto';
  setParam('jour_courant', jc);
  setParam('j2_ouvert', req.body.j2_ouvert ? '1' : '0');
  setParam('ia_activee', req.body.ia_activee ? '1' : '0');
  setParam('verrou_final', req.body.verrou_final ? '1' : '0');
  setParam('classement_visible', req.body.classement_visible ? '1' : '0');
  res.redirect('/admin/reglages');
});
