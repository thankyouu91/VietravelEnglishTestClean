const fs = require('fs');
const banks = JSON.parse(fs.readFileSync('data/banks.json', 'utf8'));
const py = fs.readFileSync('scripts/gen_audio_edge.py', 'utf8');

const scripts = {};
const conversationsBlock = py.split('CONVERSATIONS = {')[1].split('}')[0];

conversationsBlock.split('"l').forEach(part => {
  if (!part.includes('": [')) return;
  const id = 'l' + part.split('": [')[0];
  const listBlock = part.split('": [')[1].split('],')[0];
  const matches = listBlock.match(/"([^"]+)"/g) || [];
  // The structure is (FEMALE, "Text"), so we just take the text inside quotes
  // Since FEMALE is a variable, it doesn't have quotes. So match(/"([^"]+)"/g) captures all the spoken text!
  const text = matches.map(s => s.replace(/"/g, '')).join(' ');
  scripts[id] = text;
});

Object.values(banks).forEach(bank => {
  (bank.listening || []).forEach(q => {
    if (scripts[q.audioFile]) {
      q.audio = scripts[q.audioFile];
    }
  });
});

fs.writeFileSync('data/banks.json', JSON.stringify(banks, null, 2));
console.log('Transcripts injected!');
