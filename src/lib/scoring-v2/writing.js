const { tokenize, countWords, countSentences, checkPhraseCoverage, checkDomainTerms, getUniqueTokens } = require('./text-metrics');
const { calculateConfidence } = require('./confidence');

// Normalizes the score to 0-1
function scoreControlledResponse(q, answer) {
  const text = String(answer || '').trim();
  const wordCount = countWords(text);
  const sentenceCount = countSentences(text);
  const tokens = tokenize(text);
  
  if (wordCount === 0) {
    return {
      score: 0,
      pointsMax: q.points || 1,
      correct: false,
      details: { wordCount: 0 },
      confidence: 0,
      pendingReview: true,
      reasons: ['blank_answer']
    };
  }

  // Task Fulfilment: 30%
  let taskFulfilment = 0;
  const elements = q.requiredElements || [];
  let totalElementWeight = elements.reduce((s, e) => s + (e.weight || 1), 0);
  if (totalElementWeight === 0) totalElementWeight = 1;
  
  let earnedElementWeight = 0;
  for (const el of elements) {
    if (checkPhraseCoverage(text, el.phrases)) {
      earnedElementWeight += (el.weight || 1);
    }
  }
  taskFulfilment = (earnedElementWeight / totalElementWeight) * 0.3;

  // Language Accuracy (Deterministic Proxy): 25%
  // Deduct for no punctuation/capitalization or missing sentence structure
  let accuracy = 0.25;
  if (sentenceCount < 1) accuracy -= 0.1;
  if (wordCount > 0 && sentenceCount / wordCount > 0.5) accuracy -= 0.15; // single-word "sentences"

  // Vocabulary & Domain Use: 20%
  let vocab = 0;
  const domainMatches = checkDomainTerms(tokens, q.domainTerms || []);
  if (q.domainTerms && q.domainTerms.length > 0) {
    vocab += Math.min(0.1, (domainMatches / Math.min(3, q.domainTerms.length)) * 0.1);
  } else {
    vocab += 0.1;
  }
  
  const formalMatches = checkDomainTerms(tokens, q.formalPhrases || []);
  if (q.formalPhrases && q.formalPhrases.length > 0) {
    vocab += Math.min(0.1, (formalMatches / 1) * 0.1);
  } else {
    vocab += 0.1;
  }

  // Coherence & Organization: 15%
  let coherence = 0.15;
  if (q.format === 'email') {
    const hasGreeting = checkPhraseCoverage(text, ['dear', 'hello', 'hi', 'good morning', 'good afternoon']);
    const hasClosing = checkPhraseCoverage(text, ['regards', 'sincerely', 'best', 'thank you']);
    if (!hasGreeting) coherence -= 0.05;
    if (!hasClosing) coherence -= 0.05;
  }

  // Fluency & Range: 10%
  let fluency = 0.1;
  const uniqueTokens = getUniqueTokens(tokens).size;
  if (wordCount > 0 && uniqueTokens / wordCount < 0.3) fluency -= 0.05;
  if (sentenceCount > 0 && wordCount / sentenceCount < 4) fluency -= 0.05; // extremely short sentences

  const rawScore = Math.max(0, Math.min(1, taskFulfilment + accuracy + vocab + coherence + fluency));
  
  const scoreDetails = {
    wordCount, sentenceCount, taskFulfilment, accuracy, vocab, coherence, fluency, rawScore
  };

  const conf = calculateConfidence(q, text, { score: rawScore });

  return {
    score: rawScore,
    pointsMax: q.points || 1,
    correct: rawScore > 0.5, // Arbitrary for controlled
    details: scoreDetails,
    confidence: conf.confidence,
    pendingReview: conf.pendingReview,
    reasons: conf.reasons
  };
}

module.exports = {
  scoreControlledResponse
};
