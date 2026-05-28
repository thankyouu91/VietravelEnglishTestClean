const d = require('/opt/vietravel-exam/data/banks.json');
const ls = (d.BANK_STAFF || {}).listening || [];
console.log('Total listening:', ls.length);
ls.slice(0,7).forEach(function(q){ 
  console.log('  id:', q.id, '| audioFile:', q.audioFile); 
});
