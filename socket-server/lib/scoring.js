// I tempi provengono esclusivamente dall'orologio del server.
function timeScore(elapsedMs, durationMs) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('Tempi di risposta non validi.');
  }
  const elapsed = Math.max(0, Math.min(durationMs, elapsedMs));
  return Math.max(1, Math.round(100 * (1 - elapsed / durationMs)));
}

module.exports = { timeScore };
