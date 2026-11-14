const samples = [
  { bricks: 20, min: 20, max: 30 },
  { bricks: 100, min: 30, max: 50 },
  { bricks: 500, min: 55, max: 175 },
  { bricks: 2000, min: 75, max: 125 },
  { bricks: 8000, min: 115, max: 185 },
];

export function copilotPlanningEstimate(brief: string): string {
  const unknown = 'Estimate unknown; sampled Copilot requests took about 20–183 seconds.';
  // Only compare an unambiguous single numeric brick target; do not infer one from a complex brief.
  if ([...brief.matchAll(/\d+(?:,\d{3})*/g)].length !== 1
      || /\b(?:budget|maximum|minimum|max|min|at most|at least|less than|more than|up to|under|over|between|without|remove|removed|not|no)\b/i.test(brief))
    return unknown;
  const match = brief.match(/(?<![\p{L}\p{N}.,+\-])(\d+(?:,\d{3})*)\s*(?:-\s*)?bricks?\b/iu);
  if (!match) return unknown;
  const size = Number(match[1].replaceAll(',', ''));
  if (size < samples[0].bricks || size > samples[samples.length - 1].bricks) return unknown;
  const upper = samples.findIndex(sample => sample.bricks >= size);
  const lower = samples[upper].bricks === size ? upper : upper - 1;
  const min = Math.min(samples[lower].min, samples[upper].min);
  const max = Math.max(samples[lower].max, samples[upper].max);
  return `For ${size.toLocaleString('en-US')} requested bricks, a small Copilot study suggests about ${min}–${max} seconds.`;
}
