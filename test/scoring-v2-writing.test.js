const test = require('node:test');
const assert = require('node:assert');
const { scoreControlledResponse } = require('../src/lib/scoring-v2/writing');

test('scoreControlledResponse - happy path', () => {
  const q = {
    type: 'controlled_response',
    prompt: 'Write an email confirming the reservation for three nights. Bring ID.',
    minWords: 20,
    maxWords: 50,
    requiredElements: [
      { id: 'confirm', weight: 1, phrases: ['confirm'] },
      { id: 'nights', weight: 1, phrases: ['three nights'] }
    ],
    domainTerms: ['reservation', 'id']
  };
  
  const ans = 'Dear guest, I confirm your reservation for three nights. Please bring your ID when you arrive. Thank you.';
  const res = scoreControlledResponse(q, ans);
  
  assert.strictEqual(res.pendingReview, false, 'Should have high confidence');
  assert.ok(res.score > 0.7, 'Should have high score');
});

test('scoreControlledResponse - low confidence', () => {
  const q = {
    type: 'controlled_response',
    prompt: 'Write an email confirming the reservation for three nights. Bring ID.',
    minWords: 20,
    maxWords: 50
  };
  
  const resEmpty = scoreControlledResponse(q, '');
  assert.strictEqual(resEmpty.pendingReview, true);
  
  const resShort = scoreControlledResponse(q, 'I confirm.');
  assert.strictEqual(resShort.pendingReview, true);
  assert.ok(resShort.reasons.includes('too_short'));
  
  const resCopy = scoreControlledResponse(q, 'Write an email confirming the reservation for three nights. Bring ID.');
  assert.strictEqual(resCopy.pendingReview, true);
  assert.ok(resCopy.reasons.includes('prompt_copy'));
});
