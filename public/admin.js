/* Rallye La Trace — console admin : notation rapide, validation en masse, raccourcis. */
(() => {
  'use strict';

  async function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function majSel() {
    const n = document.querySelectorAll('.sub .sel:checked').length;
    const el = document.getElementById('n-sel');
    if (el) el.textContent = n;
  }

  function marquer(li, statut, points) {
    li.classList.remove('statut-soumis', 'statut-valide', 'statut-refuse');
    li.classList.add('statut-' + statut);
    const badge = li.querySelector('.sub-head .badge');
    if (badge) { badge.textContent = statut; badge.className = 'badge b-' + statut; }
    if (statut === 'valide' && points != null) {
      const pts = li.querySelector('.points'); if (pts) pts.value = points;
    }
    const chk = li.querySelector('.sel'); if (chk) chk.checked = false;
    majSel();
  }

  document.addEventListener('click', async (e) => {
    const li = e.target.closest('.sub');
    if (!li) return;
    if (e.target.closest('.btn-suppr')) {
      if (!confirm('Supprimer définitivement cette soumission ?')) return;
      const r = await post(`/admin/api/soumissions/${li.dataset.id}/supprimer`);
      if (r.ok) { li.remove(); majSel(); }
      else alert('Suppression refusée (rallye verrouillé ?).');
      return;
    }
    if (e.target.classList.contains('btn-valider')) {
      const points = Number(li.querySelector('.points')?.value);
      const r = await post(`/admin/api/soumissions/${li.dataset.id}/valider`, { points });
      if (r.ok) { const j = await r.json(); marquer(li, 'valide', j.points); }
      else alert('Action refusée (rallye verrouillé ?).');
    } else if (e.target.classList.contains('btn-refuser')) {
      const r = await post(`/admin/api/soumissions/${li.dataset.id}/refuser`);
      if (r.ok) marquer(li, 'refuse');
      else alert('Action refusée (rallye verrouillé ?).');
    } else if (e.target.classList.contains('btn-reeval')) {
      e.target.disabled = true;
      e.target.textContent = 'Réévaluation…';
      await post(`/admin/api/soumissions/${li.dataset.id}/reevaluer`);
      setTimeout(() => location.reload(), 1500);
    }
  });

  document.addEventListener('change', (e) => { if (e.target.classList.contains('sel')) majSel(); });

  const btnTout = document.getElementById('btn-tout-sel');
  if (btnTout) {
    btnTout.addEventListener('click', () => {
      const boxes = [...document.querySelectorAll('.sub .sel:not(:disabled)')];
      const toutCoche = boxes.length > 0 && boxes.every((c) => c.checked);
      boxes.forEach((c) => { c.checked = !toutCoche; });
      btnTout.textContent = toutCoche ? 'Tout sélectionner' : 'Tout désélectionner';
      majSel();
    });
  }

  const btnLot = document.getElementById('btn-valider-lot');
  if (btnLot) {
    btnLot.addEventListener('click', async () => {
      const ids = [...document.querySelectorAll('.sub .sel:checked')].map((c) => c.closest('.sub').dataset.id);
      if (!ids.length) return;
      const r = await post('/admin/api/valider-lot', { ids });
      if (r.ok) ids.forEach((id) => { const li = document.querySelector(`.sub[data-id="${id}"]`); if (li) marquer(li, 'valide'); });
      else alert('Action refusée (rallye verrouillé ?).');
    });
  }

  // Recherche instantanée sur la liste des défis (admin) — insensible aux accents/casse.
  const inputDefis = document.getElementById('recherche-defis');
  if (inputDefis) {
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const lignes = [...document.querySelectorAll('.tbl tbody tr')].map((tr) => ({ tr, txt: norm(tr.textContent) }));
    inputDefis.addEventListener('input', () => {
      const q = norm(inputDefis.value.trim());
      lignes.forEach((l) => { l.tr.hidden = q !== '' && !l.txt.includes(q); });
    });
  }

  // Raccourcis : V valide / R refuse la carte survolée
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const li = document.querySelector('.sub:hover');
    if (!li) return;
    if (e.key === 'v' || e.key === 'V') li.querySelector('.btn-valider')?.click();
    if (e.key === 'r' || e.key === 'R') li.querySelector('.btn-refuser')?.click();
  });
})();
