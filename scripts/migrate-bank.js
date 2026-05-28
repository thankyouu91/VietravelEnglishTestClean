#!/usr/bin/env node
/**
 * Extract BANK_STAFF + BANK_OFFICE_MGR from the original
 * "Placement Test Vietravel.html" file and dump to data/banks.json.
 *
 * Usage:
 *   node scripts/migrate-bank.js <path-to-Placement-Test.html>
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('Usage: node scripts/migrate-bank.js <Placement Test Vietravel.html>');
  process.exit(1);
}
if (!fs.existsSync(htmlPath)) {
  console.error(`File không tồn tại: ${htmlPath}`);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

function extractDecl(src, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`Không tìm thấy "${name}" trong file HTML.`);

  const start = m.index + m[0].length - 1;
  let depth = 0, i = start, inStr = false, strCh = '', esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === '\\') { esc = true; continue; }
      if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

console.log('• Đang trích BANK_STAFF…');
const bankStaffSrc = extractDecl(html, 'BANK_STAFF');
console.log('• Đang trích BANK_OFFICE_MGR…');
const bankMgrSrc   = extractDecl(html, 'BANK_OFFICE_MGR');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`var BANK_STAFF = ${bankStaffSrc}; var BANK_OFFICE_MGR = ${bankMgrSrc};`, sandbox);

const banks = {
  BANK_STAFF:      sandbox.BANK_STAFF,
  BANK_OFFICE_MGR: sandbox.BANK_OFFICE_MGR,
};

for (const [name, bank] of Object.entries(banks)) {
  for (const track of ['listening', 'reading', 'writing']) {
    if (!Array.isArray(bank[track])) {
      console.warn(`⚠️  ${name}.${track} không phải array, skip`);
      bank[track] = [];
    }
  }
}

const out = path.join(__dirname, '..', 'data', 'banks.json');
fs.writeFileSync(out, JSON.stringify(banks, null, 2), 'utf8');

const stats = (b) => ({
  listening: b.listening.length, reading: b.reading.length, writing: b.writing.length,
  total: b.listening.length + b.reading.length + b.writing.length,
});
console.log(`\n✓ Đã ghi ${out}\n`);
console.log('  BANK_STAFF     :', stats(banks.BANK_STAFF));
console.log('  BANK_OFFICE_MGR:', stats(banks.BANK_OFFICE_MGR));
console.log('\n→ Restart server để load bank mới.');
