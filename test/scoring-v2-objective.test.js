const test = require('node:test');
const assert = require('node:assert');
const { scoreObjective } = require('../src/lib/scoring-v2/objective');

test('scoreObjective - mcq', () => {
  const q = { type: 'mcq', correct: '2', points: 1 };
  
  const res1 = scoreObjective(q, '2');
  assert.strictEqual(res1.score, 1);
  assert.strictEqual(res1.correct, true);
  
  const res2 = scoreObjective(q, '1');
  assert.strictEqual(res2.score, 0);
  assert.strictEqual(res2.correct, false);
});

test('scoreObjective - fill_blank', () => {
  const q = { 
    type: 'fill_blank', 
    blanks: { b1: 'apple', b2: ['banana', 'orange'] },
    points: 1
  };
  
  const res1 = scoreObjective(q, { b1: 'apple', b2: 'orange' });
  assert.strictEqual(res1.score, 1);
  
  const res2 = scoreObjective(q, { b1: 'Apple ', b2: '  BANANA' });
  assert.strictEqual(res2.score, 1);
  
  const res3 = scoreObjective(q, { b1: 'apple', b2: 'grape' });
  assert.strictEqual(res3.score, 0.5);
});

test('scoreObjective - sentence_transform', () => {
  const q = {
    type: 'sentence_transform',
    sentences: [
      { answer: 'He said he was fine' },
      { accept: ['She is tall', 'She is very tall'] }
    ],
    points: 1
  };
  
  const res1 = scoreObjective(q, { '0': 'He said he was fine.', '1': 'She is tall' });
  assert.strictEqual(res1.score, 1);
  
  // Fuzzy match on long sentence (>5 tokens)
  const qFuzzy = {
    type: 'sentence_transform',
    sentences: [{ answer: 'I really love eating pizza on the weekends' }]
  };
  const resFuzzy = scoreObjective(qFuzzy, { '0': 'I love eating pizza on the weekends' });
  assert.strictEqual(resFuzzy.score, 1); // high similarity
});
