import { db } from './db.js';

const qGet = db.prepare('SELECT valeur FROM parametres WHERE cle = ?');
const qSet = db.prepare(`
  INSERT INTO parametres (cle, valeur) VALUES (?, ?)
  ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur
`);

export const getParam = (cle) => qGet.get(cle)?.valeur;
export const setParam = (cle, valeur) => qSet.run(cle, String(valeur));

// Date du jour en Europe/Paris au format YYYY-MM-DD
const dateParis = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

// Jour effectif : forçage admin prioritaire, sinon déduit de la date.
export function jourEffectif() {
  const force = getParam('jour_courant');
  if (force && force !== 'auto') return force; // 'weekend' | 'J1' | 'J2'
  const d = dateParis();
  if (d === '2026-06-27') return 'J1';
  if (d === '2026-06-28') return 'J2';
  return 'J1'; // hors dates de l'évènement : J1 par défaut (utile pour les tests)
}

// Un défi est-il visible aujourd'hui ?
export function defiVisible(defi) {
  if (defi.disponibilite === 'weekend') return true;
  if (defi.disponibilite === 'J1') return jourEffectif() === 'J1';
  if (defi.disponibilite === 'J2') return getParam('j2_ouvert') === '1'; // ouverture dimanche matin
  return false;
}
