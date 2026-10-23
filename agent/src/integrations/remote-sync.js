// Lamps linked to the same IKEA remote go back to one brightness after it's
// used. Dimming with a remote moves every lamp by the same step from where it
// was, so lamps that started apart stay apart (and one at 100% can't go any
// higher while the others still can).

// What to send once the remote is put down: the lamps that are lit set the
// level (the middle one, so a single lamp stuck at 0% or 100% doesn't win),
// and every lamp that's off or differs goes to it. Nothing when all are off.
// lamps: [{ id, on, level }]
export function remoteSyncPlan(lamps) {
  const levels = lamps.filter((l) => l.on && typeof l.level === 'number').map((l) => l.level).sort((a, b) => a - b);
  if (lamps.length < 2 || !levels.length) return null;
  const level = levels[Math.floor((levels.length - 1) / 2)];
  const ids = lamps.filter((l) => !l.on || typeof l.level !== 'number' || Math.abs(l.level - level) > 1).map((l) => l.id);
  return ids.length ? { level, ids } : null;
}
