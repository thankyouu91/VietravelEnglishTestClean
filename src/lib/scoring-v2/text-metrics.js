function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase()
    .replace(/[.,!?;:'"()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function countWords(text) {
  return tokenize(text).length;
}

function countSentences(text) {
  if (!text) return 0;
  return String(text).split(/[.!?]+/).filter(s => s.trim().length > 0).length;
}

function getUniqueTokens(tokens) {
  return new Set(tokens);
}

function checkPhraseCoverage(text, phrases) {
  if (!phrases || !phrases.length) return false;
  const lower = String(text).toLowerCase();
  return phrases.some(p => lower.includes(String(p).toLowerCase()));
}

function checkDomainTerms(tokens, domainTerms) {
  if (!domainTerms || !domainTerms.length) return 0;
  const tokenSet = getUniqueTokens(tokens);
  let match = 0;
  for (const term of domainTerms) {
    if (tokenSet.has(term.toLowerCase())) {
      match++;
    }
  }
  return match;
}

module.exports = {
  tokenize,
  countWords,
  countSentences,
  getUniqueTokens,
  checkPhraseCoverage,
  checkDomainTerms
};
