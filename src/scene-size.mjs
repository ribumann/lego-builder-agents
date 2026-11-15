export const SCENE_SIZES = Object.freeze([100, 500, 1000, 2000, 3000, 5000, 8192]);

export function resolveSceneSize(brief, selected) {
  if (!SCENE_SIZES.includes(selected)) throw new Error('Use a supported approximate scene size.');
  const numbers = [...brief.matchAll(/\d+(?:,\d{3})*/g)];
  const qualified = /\b(?:budget|maximum|minimum|max|min|at most|at least|less than|more than|up to|under|over|between|without|remove|removed|not|no|nicht|kein|keine|keinen|aucun|aucune|non|senza|nessun|nessuna|sin|ningún|ninguna|sem|nenhum|nenhuma)\b|não/iu;
  const match = brief.match(/(?<![\p{L}\p{N}.,+\-−])(\d+(?:,\d{3})*)\s*(?:-\s*)?(?:bricks?|steine?n?|briques?|mattoncin[io]|bloques?|blocos?|tijolos?)\b(?!\s+(?:wide|high|tall|long|deep|each|per|for each|in each|breit|hoch|lang|large|chaque|chacun|de large|de haut|ciascuno|cada|ancho|largo)\b)/iu);
  if (numbers.length !== 1 || qualified.test(brief) || !match) return { target: selected, source: 'selection' };
  const target = Number(match[1].replaceAll(',', ''));
  if (!Number.isSafeInteger(target) || target < 1 || target > 8192)
    throw new Error('Requested brick count must be between 1 and 8192.');
  return { target, source: 'brief' };
}
