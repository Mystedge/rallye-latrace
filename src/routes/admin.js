import { Router } from 'express';
import { config } from '../config.js';
import { getParam, setParam, jourEffectif } from '../params.js';
import {
  listSoumissions, getSoumissionById, validerSoumission, refuserSoumission,
  listDefisOrdonnes, getDefi, creerDefi, majDefi, supprimerDefi,
  listBinomes, getBinomeById, creerBinome, majBinome, supprimerBinome, genererCodeUnique,
  classement,
} from '../repo.js';
import { reevaluer } from '../prequalif.js';

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
  const filtres = {
    binome: req.query.binome || '', defi: req.query.defi || '',
    statut: req.query.statut || '', verdict: req.query.verdict || '',
  };
  const soumissions = listSoumissions({
    binome: filtres.binome ? Number(filtres.binome) : null,
    defi: filtres.defi ? Number(filtres.defi) : null,
    statut: filtres.statut || null,
    verdict: filtres.verdict || null,
  });
  res.render('admin/revue', {
    soumissions, filtres, binomes: listBinomes(), defis: listDefisOrdonnes(), verrou: verrouille(),
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
function defiDepuisBody(body) {
  return {
    titre: String(body.titre || '').trim(),
    description: String(body.description || ''),
    type: ['photo', 'texte', 'mixte'].includes(body.type) ? body.type : 'photo',
    disponibilite: ['weekend', 'J1', 'J2'].includes(body.disponibilite) ? body.disponibilite : 'weekend',
    mode_validation: ['manuel', 'auto', 'ia'].includes(body.mode_validation) ? body.mode_validation : 'manuel',
    critere_ia: body.critere_ia ? String(body.critere_ia) : null,
    reponse_attendue: body.reponse_attendue ? String(body.reponse_attendue) : null,
    points_max: Math.max(0, Number(body.points_max) || 0),
    ordre: Number(body.ordre) || 0,
  };
}

admin.get('/admin/defis', requireAdmin, (req, res) => res.render('admin/defis', { defis: listDefisOrdonnes() }));
admin.get('/admin/defis/nouveau', requireAdmin, (req, res) => res.render('admin/defi-form', { defi: null }));
admin.get('/admin/defis/:id', requireAdmin, (req, res) => {
  const defi = getDefi(Number(req.params.id));
  if (!defi) return res.redirect('/admin/defis');
  res.render('admin/defi-form', { defi });
});
admin.post('/admin/defis', requireAdmin, (req, res) => { const d = defiDepuisBody(req.body); if (d.titre) creerDefi(d); res.redirect('/admin/defis'); });
admin.post('/admin/defis/:id', requireAdmin, (req, res) => { const d = defiDepuisBody(req.body); if (d.titre) majDefi(Number(req.params.id), d); res.redirect('/admin/defis'); });
admin.post('/admin/defis/:id/supprimer', requireAdmin, (req, res) => { supprimerDefi(Number(req.params.id)); res.redirect('/admin/defis'); });

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
  jour_effectif: jourEffectif(),
  cle_ia: Boolean(config.anthropicApiKey),
}));

admin.post('/admin/reglages', requireAdmin, (req, res) => {
  const jc = ['auto', 'weekend', 'J1', 'J2'].includes(req.body.jour_courant) ? req.body.jour_courant : 'auto';
  setParam('jour_courant', jc);
  setParam('j2_ouvert', req.body.j2_ouvert ? '1' : '0');
  setParam('ia_activee', req.body.ia_activee ? '1' : '0');
  setParam('verrou_final', req.body.verrou_final ? '1' : '0');
  res.redirect('/admin/reglages');
});
