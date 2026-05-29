const { tokenize, countWords, getUniqueTokens } = require('./text-metrics');

function calculateConfidence(question, answer, scoreDetails) {
  const text = String(answer || '').trim();
  const wordCount = countWords(text);
  
  if (wordCount === 0) {
    return { confidence: 0, pendingReview: true, reasons: ['blank_answer'] };
  }
  
  const minWords = question.minWords || 30;
  if (wordCount < minWords * 0.5) {
    return { confidence: 0.2, pendingReview: true, reasons: ['too_short'] };
  }

  const tokens = tokenize(text);
  const unique = getUniqueTokens(tokens).size;
  if (unique / wordCount < 0.2) {
    return { confidence: 0.3, pendingReview: true, reasons: ['highly_repetitive'] };
  }

  // Prompt copy check
  if (question.prompt) {
    const promptTokens = tokenize(question.prompt);
    const promptUnique = getUniqueTokens(promptTokens);
    let promptOverlap = 0;
    for (const t of tokens) {
      if (promptUnique.has(t)) promptOverlap++;
    }
    if (promptOverlap / wordCount > 0.7) {
      return { confidence: 0.4, pendingReview: true, reasons: ['prompt_copy'] };
    }
  }

  // Threshold checks
  const minConf = parseFloat(process.env.OFFLINE_SCORING_MIN_CONFIDENCE || '0.75');
  let confidence = 0.9; // Base good confidence if checks pass

  // If the score is very borderline (e.g. 50%), lower confidence
  const score = scoreDetails.score;
  if (score >= 0.4 && score <= 0.6) {
    confidence = 0.6; 
  }

  const pendingReview = confidence < minConf;
  const reasons = [];
  if (pendingReview) {
    reasons.push('low_confidence_score');
  }

  return { confidence, pendingReview, reasons };
}

module.exports = {
  calculateConfidence
};
