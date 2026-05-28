/**
 * Deduplicate writing-bank.json — remove questions with identical content
 * Keeps only the first occurrence of each unique question.
 */
const fs = require('fs');
const path = require('path');

const WRITING_BANK = path.join(__dirname, '..', 'data', 'writing-bank.json');

function fingerprint(q) {
  return (q.instruction || '') + '|' + (q.passage || '').slice(0, 60) + '|' + (q.type || '');
}

function dedup(arr) {
  const seen = new Set();
  const unique = [];
  for (const q of arr) {
    const fp = fingerprint(q);
    if (seen.has(fp)) continue;
    seen.add(fp);
    unique.push(q);
  }
  return unique;
}

const wb = JSON.parse(fs.readFileSync(WRITING_BANK, 'utf8'));

const before = {};
const after = {};

for (const key of Object.keys(wb)) {
  if (Array.isArray(wb[key])) {
    before[key] = wb[key].length;
    wb[key] = dedup(wb[key]);
    after[key] = wb[key].length;
    console.log(`${key}: ${before[key]} → ${after[key]} (removed ${before[key] - after[key]} duplicates)`);
  }
}

fs.writeFileSync(WRITING_BANK, JSON.stringify(wb, null, 2) + '\n');
console.log('\n✅ writing-bank.json deduplicated and saved.');
