export const isTransientWhatsAppError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return ['timeout', 'timed out', 'socket', 'temporarily', 'disconnected', 'rate', '429'].some((token) =>
    message.includes(token)
  );
};

export const computeRetryDelayMs = (
  attempt: number,
  baseMs: number,
  capMs: number,
  randomIntInclusive: (max: number) => number = (max) => Math.floor(Math.random() * (max + 1))
): number => {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(capMs, baseMs * 3 ** exponent);
  const jitterCeil = Math.max(500, Math.floor(base * 0.3));
  return base + randomIntInclusive(jitterCeil);
};
