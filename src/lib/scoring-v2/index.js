const { scoreObjective } = require('./objective');
const { scoreControlledResponse } = require('./writing');

async function scoreAnswersV2(questionSet, answers, options = {}) {
  const scores = { listening: 0, reading: 0, writing: 0 };
  const details = { listening: [], reading: [], writing: [] };
  const flags = { scoring_version: 'v2', writing_pending_review: false, review_reasons: [] };
  const itemBreakdown = { listening: [], reading: [], writing: [] };

  const addPendingReason = (reason) => {
    flags.writing_pending_review = true;
    if (!flags.review_reasons.includes(reason)) {
      flags.review_reasons.push(reason);
    }
  };

  // Listening & Reading
  for (const track of ['listening', 'reading']) {
    let earned = 0;
    let max = 0;
    
    (questionSet[track] || []).forEach(q => {
      const ans = (answers[track] || {})[q.id];
      const result = scoreObjective(q, ans);
      
      earned += result.score * result.pointsMax;
      max += result.pointsMax;
      
      details[track].push({ id: q.id, userAnswer: ans, correct: result.expected, isCorrect: result.correct });
      itemBreakdown[track].push({ id: q.id, score: result.score, pointsMax: result.pointsMax });
    });
    
    scores[track] = max > 0 ? Number(((earned / max) * 10).toFixed(1)) : 0;
  }

  // Writing
  let wEarned = 0;
  let wMax = 0;
  
  (questionSet.writing || []).forEach(q => {
    const ans = (answers.writing || {})[q.id];
    let result;
    
    if (q.type === 'controlled_response') {
      result = scoreControlledResponse(q, ans);
      if (result.pendingReview) {
        result.reasons.forEach(r => addPendingReason(r));
      }
    } else if (q.type === 'short_answer') {
      // Default to pending review if it's short_answer in V2
      result = { score: 0, pointsMax: q.points || 1, correct: false, details: 'short_answer disabled in V2' };
      addPendingReason('short_answer_unsupported_in_v2');
    } else {
      result = scoreObjective(q, ans);
    }
    
    wEarned += result.score * result.pointsMax;
    wMax += result.pointsMax;
    
    details.writing.push({ id: q.id, type: q.type, points: result.score, pending: result.pendingReview || false, ...result.details });
    itemBreakdown.writing.push({ id: q.id, score: result.score, pointsMax: result.pointsMax });
  });

  if (flags.writing_pending_review) {
    scores.writing = null;
  } else {
    scores.writing = wMax > 0 ? Number(((wEarned / wMax) * 10).toFixed(1)) : 0;
  }

  // If any writing was very low score, flag it
  if (!flags.writing_pending_review && scores.writing < 4) {
    // We could add this to review_reasons, but spec says gating rules handled in bands.js
  }

  const total = flags.writing_pending_review ? null : Math.round(scores.listening + scores.reading + scores.writing);
  
  return {
    scores,
    total,
    details,
    flags,
    scoring_v2: {
      skillBreakdown: scores,
      itemBreakdown
    }
  };
}

module.exports = {
  scoreAnswersV2
};
