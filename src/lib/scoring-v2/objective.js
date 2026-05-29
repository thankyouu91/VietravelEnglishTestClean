function scoreObjective(question, answer) {
  switch (question.type) {
    case 'mcq':
      return scoreMCQ(question, answer);
    case 'fill_blank':
      return scoreFillBlank(question, answer);
    case 'error_correction':
      return scoreErrorCorrection(question, answer);
    case 'sentence_order':
      return scoreSentenceOrder(question, answer);
    case 'sentence_transform':
      return scoreSentenceTransform(question, answer);
    default:
      return { score: 0, pointsMax: question.points || 1, correct: false };
  }
}

function scoreMCQ(q, answer) {
  const isCorrect = answer !== undefined && answer !== null && Number(answer) === Number(q.correct);
  return {
    score: isCorrect ? 1 : 0,
    pointsMax: q.points || 1,
    correct: isCorrect,
    userAnswer: answer,
    expected: q.correct
  };
}

function scoreFillBlank(q, answer) {
  const blanks = q.blanks || {};
  const total = Object.keys(blanks).length;
  if (total === 0) return { score: 0, pointsMax: q.points || 1, correct: false };

  let correctCount = 0;
  const details = {};

  for (const [key, expected] of Object.entries(blanks)) {
    const given = String(answer[key] || '').trim().toLowerCase().replace(/\s+/g, ' ');
    
    let acceptedList = [];
    if (Array.isArray(expected)) {
      acceptedList = expected.map(e => String(e).trim().toLowerCase().replace(/\s+/g, ' '));
    } else {
      acceptedList = [String(expected).trim().toLowerCase().replace(/\s+/g, ' ')];
    }
    
    const isCorrect = acceptedList.includes(given);
    if (isCorrect) correctCount++;
    details[key] = { given: answer[key], expected: acceptedList, correct: isCorrect };
  }

  const rawScore = correctCount / total;
  return {
    score: rawScore,
    pointsMax: q.points || 1,
    correct: rawScore === 1,
    details
  };
}

function scoreErrorCorrection(q, answer) {
  const sentences = q.sentences || [];
  const total = sentences.length;
  if (total === 0) return { score: 0, pointsMax: q.points || 1, correct: false };

  let correctCount = 0;
  const details = [];

  sentences.forEach((s, i) => {
    const selected = Number(answer[String(i)]);
    const isCorrect = selected === s.correct;
    if (isCorrect) correctCount++;
    details.push({ selected, expected: s.correct, correct: isCorrect });
  });

  const rawScore = correctCount / total;
  return {
    score: rawScore,
    pointsMax: q.points || 1,
    correct: rawScore === 1,
    details
  };
}

function scoreSentenceOrder(q, answer) {
  const correctOrder = q.correct || q.correct_order || [];
  if (!Array.isArray(answer) || answer.length !== correctOrder.length) {
    return { score: 0, pointsMax: q.points || 1, correct: false, details: 'Invalid answer format' };
  }

  let correctCount = 0;
  for (let i = 0; i < correctOrder.length; i++) {
    if (Number(answer[i]) === correctOrder[i]) correctCount++;
  }

  const rawScore = correctCount / correctOrder.length;
  return {
    score: rawScore,
    pointsMax: q.points || 1,
    correct: rawScore === 1,
    details: { given: answer, expected: correctOrder }
  };
}

function tokenSimilarity(s1, s2) {
  const t1 = s1.split(/\s+/);
  const t2 = s2.split(/\s+/);
  const intersection = t1.filter(t => t2.includes(t)).length;
  const union = new Set([...t1, ...t2]).size;
  if (union === 0) return 0;
  return intersection / union;
}

function scoreSentenceTransform(q, answer) {
  const sentences = q.sentences || [];
  const total = sentences.length;
  if (total === 0) return { score: 0, pointsMax: q.points || 1, correct: false };

  let correctCount = 0;
  const details = [];

  sentences.forEach((s, i) => {
    const givenRaw = String(answer[String(i)] || '').trim();
    const given = givenRaw.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
    
    let acceptedList = [];
    if (s.accept) {
      acceptedList = Array.isArray(s.accept) ? s.accept : [s.accept];
    } else if (s.answer) {
      acceptedList = [s.answer];
    }
    
    let isCorrect = false;
    let maxSim = 0;
    
    for (const accRaw of acceptedList) {
      const acc = String(accRaw || '').toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
      if (given === acc) {
        isCorrect = true;
        maxSim = 1;
        break;
      }
      
      const tokens = acc.split(/\s+/).length;
      if (tokens >= 5) {
        const sim = tokenSimilarity(given, acc);
        if (sim >= 0.85) {
          isCorrect = true;
          maxSim = Math.max(maxSim, sim);
        }
      }
    }
    
    if (isCorrect) correctCount++;
    details.push({ given: givenRaw, accepted: acceptedList, correct: isCorrect, similarity: maxSim });
  });

  const rawScore = correctCount / total;
  return {
    score: rawScore,
    pointsMax: q.points || 1,
    correct: rawScore === 1,
    details
  };
}

module.exports = {
  scoreObjective
};
