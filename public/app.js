/* Rallye La Trace — client participant : compression photo + file offline + renvoi auto. */
(() => {
  'use strict';

  // ───────────────────────── IndexedDB : file des soumissions en attente ─────────────────────────
  const DB_NAME = 'rallye';
  const STORE = 'pending'; // keyPath: defiId  → 1 enregistrement par défi (la réédition écrase)

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'defiId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(rec) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbDelete(defiId) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(defiId);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbAll() {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    });
  }

  // ───────────────────────── Envoi au serveur ─────────────────────────
  // 'ok' : accepté · 'abandon' : refus définitif (4xx hors 423) · throw : réseau/5xx/423 → on réessaiera
  async function envoyer(rec) {
    const fd = new FormData();
    fd.append('defi_id', rec.defiId);
    if (rec.texte != null) fd.append('texte', rec.texte);
    if (rec.blob) {
      const estVideo = rec.blob.type && rec.blob.type.startsWith('video/');
      fd.append('photo', rec.blob, estVideo ? ('video.' + (rec.blob.type.split('/')[1] || 'mp4')) : 'photo.jpg');
    }
    const r = await fetch('/api/soumissions', { method: 'POST', body: fd });
    if (r.ok) return 'ok';
    if (r.status >= 400 && r.status < 500 && r.status !== 423) return 'abandon';
    throw new Error('HTTP ' + r.status);
  }

  let syncEnCours = false;
  async function sync() {
    if (syncEnCours || !navigator.onLine) return;
    syncEnCours = true;
    try {
      for (const rec of await idbAll()) {
        try {
          const r = await envoyer(rec);
          if (r === 'ok' || r === 'abandon') await idbDelete(rec.defiId);
        } catch { /* on garde l'enregistrement, prochain essai */ }
      }
    } finally {
      syncEnCours = false;
      majBanniere();
    }
  }

  async function majBanniere() {
    const b = document.getElementById('banniere-attente');
    if (!b) return;
    const n = (await idbAll()).length;
    if (n > 0) {
      b.hidden = false;
      b.textContent = `⏳ ${n} réponse(s) en attente d'envoi — renvoi automatique dès que le réseau revient.`;
    } else {
      b.hidden = true;
    }
  }

  // ───────────────────────── Compression photo (EXIF + HEIC) ─────────────────────────
  async function compresser(file) {
    let input = file;
    if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '')) {
      const converti = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      input = new File([converti], 'photo.jpg', { type: 'image/jpeg' });
    }
    return imageCompression(input, {
      maxWidthOrHeight: 1600,
      maxSizeMB: 1,
      initialQuality: 0.8,
      useWebWorker: true,
      fileType: 'image/jpeg',
    });
  }

  // ───────────────────────── Page formulaire de défi ─────────────────────────
  function wireDefi(form) {
    const defiId = Number(form.dataset.defiId);
    const type = form.dataset.type;
    const media = form.dataset.media;
    const inputPhoto = document.getElementById('photo');
    const apercu = document.getElementById('apercu-conteneur');
    const etat = document.getElementById('etat-envoi');
    const btn = document.getElementById('btn-envoyer');

    if (inputPhoto && apercu) {
      inputPhoto.addEventListener('change', () => {
        apercu.textContent = ''; // efface les aperçus précédents (rien tant qu'aucun fichier choisi)
        for (const f of inputPhoto.files) {
          const el = f.type.startsWith('video/') ? document.createElement('video') : document.createElement('img');
          el.className = 'apercu';
          if (el.tagName === 'VIDEO') el.controls = true;
          el.src = URL.createObjectURL(f);
          apercu.appendChild(el);
        }
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const texte = (type === 'texte' || type === 'mixte')
          ? (document.getElementById('texte')?.value ?? '')
          : null;

        let blob = null;
        const f = inputPhoto?.files?.[0];
        if (f) {
          if (f.type.startsWith('video/')) { // détection par type de fichier (gère photo, vidéo, ou « photo ou vidéo »)
            if (f.size > 150 * 1024 * 1024) {
              etat.textContent = '⚠️ Vidéo trop lourde (150 Mo max, ≈ 1 min). Filme plus court, ou envoie-la par WhatsApp ci-dessous.';
              btn.disabled = false;
              return;
            }
            blob = f; // pas de compression vidéo (on garde le fichier tel quel)
          } else {
            etat.textContent = '📸 Compression de la photo…';
            blob = await compresser(f);
          }
        }

        const aDuTexte = texte != null && texte.trim() !== '';
        if (!aDuTexte && !blob) {
          etat.textContent = '⚠️ Ajoute une réponse ou une photo.';
          btn.disabled = false;
          return;
        }

        // 1) Sécuriser localement AVANT tout envoi — c'est la garantie « zéro perte »
        const rec = { defiId, texte: aDuTexte ? texte : null, blob, ts: Date.now() };
        await idbPut(rec);

        etat.textContent = '⬆️ Envoi…';
        try {
          const r = await envoyer(rec);
          if (r === 'ok') {
            await idbDelete(defiId);
            window.location.href = '/accueil';
            return;
          }
          if (r === 'abandon') {
            await idbDelete(defiId);
            etat.textContent = '⚠️ Réponse refusée par le serveur (défi indisponible ?).';
            btn.disabled = false;
            return;
          }
        } catch {
          etat.textContent = '📶 Pas de réseau — ta réponse est enregistrée, elle partira automatiquement.';
          btn.disabled = false;
          return;
        }
      } catch (err) {
        etat.textContent = '⚠️ Erreur : ' + (err && err.message ? err.message : err);
        btn.disabled = false;
      }
    });

    // Bouton « J'ai envoyé par WhatsApp » (défis vidéo) : crée une soumission à valider en admin.
    const btnWa = document.getElementById('btn-whatsapp');
    if (btnWa) {
      btnWa.addEventListener('click', async () => {
        btnWa.disabled = true;
        const rec = { defiId, texte: 'Vidéo envoyée à Tristan par WhatsApp 📲', blob: null, ts: Date.now() };
        await idbPut(rec);
        etat.textContent = '⬆️ Envoi du signalement…';
        try {
          const r = await envoyer(rec);
          if (r === 'ok') { await idbDelete(defiId); window.location.href = '/accueil'; return; }
          if (r === 'abandon') { await idbDelete(defiId); etat.textContent = '⚠️ Refusé par le serveur.'; btnWa.disabled = false; return; }
        } catch {
          etat.textContent = '📶 Pas de réseau — ton signalement partira automatiquement.';
          btnWa.disabled = false;
        }
      });
    }
  }

  // ───────────────────────── Accueil : recherche instantanée + onglets ─────────────────────────
  // Recherche : filtre les défis (jour + week-end d'un coup), insensible aux accents/majuscules.
  // Onglets : amélioration progressive (sans JS, les deux groupes restent empilés).
  const normaliser = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function wireAccueil() {
    const sections = [...document.querySelectorAll('.groupe')];
    if (!sections.length) return;
    const nav = document.querySelector('.onglets');
    const input = document.getElementById('recherche');
    const vide = document.getElementById('recherche-vide');
    const boutons = nav ? [...nav.querySelectorAll('.onglet')] : [];

    const cartes = [];
    sections.forEach((s) => s.querySelectorAll('.defis > li').forEach((li) => {
      const a = li.querySelector('.defi');
      cartes.push({ li, section: s, txt: normaliser(a ? (a.dataset.recherche || a.textContent) : li.textContent) });
    }));
    let actif = boutons[0] ? boutons[0].dataset.cible : null;

    function rendre() {
      const q = input ? normaliser(input.value.trim()) : '';
      if (q) {
        if (nav) nav.hidden = true;
        const compte = new Map(sections.map((s) => [s, 0]));
        cartes.forEach((c) => { const ok = c.txt.includes(q); c.li.hidden = !ok; if (ok) compte.set(c.section, compte.get(c.section) + 1); });
        let total = 0;
        sections.forEach((s) => { const n = compte.get(s); s.hidden = n === 0; total += n; });
        if (vide) vide.hidden = total > 0;
      } else {
        if (nav) nav.hidden = false;
        if (vide) vide.hidden = true;
        cartes.forEach((c) => { c.li.hidden = false; });
        if (boutons.length && actif) {
          boutons.forEach((b) => b.classList.toggle('on', b.dataset.cible === actif));
          sections.forEach((s) => { s.hidden = s.dataset.groupe !== actif; });
        } else {
          sections.forEach((s) => { s.hidden = false; });
        }
      }
    }

    boutons.forEach((b) => b.addEventListener('click', () => { actif = b.dataset.cible; rendre(); }));
    if (input) input.addEventListener('input', rendre);
    rendre(); // défaut : 1er onglet actif (= Aujourd'hui), pas de filtre
  }

  // ───────────────────────── Démarrage ─────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-defi');
    if (form) wireDefi(form);
    wireAccueil();
    majBanniere();
    sync();
  });
  window.addEventListener('online', sync);
  setInterval(sync, 20000);

  // PWA : service worker (coquille hors-ligne ; les données passent par IndexedDB)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
