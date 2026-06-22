import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { getParam } from './params.js';
import { getSoumissionById, getDefi, setStatutAuto, setIaVerdict, setIaErreur } from './repo.js';
import { prequalifier } from './ai.js';

// File in-process à concurrence limitée — suffisant à cette échelle (8 binômes).
const MAX_CONCURRENT = 3;
let actifs = 0;
const file = [];

export function enqueue(id) {
  file.push(id);
  pomper();
}
// Relance d'évaluation (utilisée par l'admin à l'Epic 4)
export const reevaluer = enqueue;

function pomper() {
  while (actifs < MAX_CONCURRENT && file.length) {
    const id = file.shift();
    actifs++;
    traiterSoumission(id)
      .catch((e) => console.error('prequalif', id, e?.message || e))
      .finally(() => { actifs--; pomper(); });
  }
}

// minuscules + sans accents + espaces normalisés
const normaliser = (t) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

// Cœur du moteur (awaitable — utilisé directement par les tests).
export async function traiterSoumission(id) {
  const s = getSoumissionById(id);
  if (!s) return;
  const defi = getDefi(s.defi_id);
  if (!defi) return;
  if (defi.mode_validation === 'auto') return traiterAuto(s, defi);
  if (defi.mode_validation === 'ia') return traiterIa(s, defi);
  // 'manuel' : file de revue humaine, rien à faire automatiquement
}

function traiterAuto(s, defi) {
  const attendu = normaliser(defi.reponse_attendue);
  if (!attendu) return; // mal configuré (pas de réponse attendue) -> on laisse à l'humain
  if (normaliser(s.texte) === attendu) {
    setStatutAuto(s.id, 'valide', defi.points_max); // match -> validé + points max
  } else {
    setStatutAuto(s.id, 'refuse', null);            // non-match -> refusé (réponse objective)
  }
}

async function traiterIa(s, defi) {
  if (getParam('ia_activee') !== '1') return;        // interrupteur global off -> file humaine (non_evalue)
  const rel = s.thumb_path || s.photo_path;
  if (!rel) return;                                   // pas de photo -> rien à juger
  if (!config.anthropicApiKey) { setIaErreur(s.id); return; } // clé absente -> erreur, file humaine
  try {
    const buf = await readFile(join(config.uploadsDir, rel));
    const v = await prequalifier(buf, defi.critere_ia || defi.titre);
    setIaVerdict(s.id, v.verdict, v.confiance, v.justification);
  } catch (e) {
    console.error('IA soumission', s.id, e?.message || e);
    setIaErreur(s.id);                                // panne/quota/timeout -> erreur, relançable
  }
}
