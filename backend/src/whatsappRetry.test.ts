import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRetryDelayMs, isTransientWhatsAppError } from './whatsappRetry';

test('isTransientWhatsAppError detects retryable transport failures', () => {
  assert.equal(isTransientWhatsAppError(new Error('Socket disconnected unexpectedly')), true);
  assert.equal(isTransientWhatsAppError(new Error('Request timeout reached')), true);
  assert.equal(isTransientWhatsAppError(new Error('Validation failed: invalid jid')), false);
});

test('computeRetryDelayMs applies backoff and jitter deterministically with custom random', () => {
  const noJitter = (_max: number) => 0;
  assert.equal(computeRetryDelayMs(1, 5000, 120000, noJitter), 5000);
  assert.equal(computeRetryDelayMs(2, 5000, 120000, noJitter), 15000);
  assert.equal(computeRetryDelayMs(3, 5000, 120000, noJitter), 45000);
});

test('computeRetryDelayMs caps exponential growth', () => {
  const noJitter = (_max: number) => 0;
  assert.equal(computeRetryDelayMs(8, 5000, 120000, noJitter), 120000);
});
