/**
 * Writing auto-scorer — grades fill_blank, error_correction, sentence_order, sentence_transform
 * No AI needed — all answers are deterministic.
 */

function scoreWritingQuestion(question, userAnswer) {
  if (!userAnswer) return { score: 0, maxScore: 1, details: 'No answer' };

  switch (question.type) {
    case 'fill_blank':
      return scoreFillBlank(question, userAnswer);
    case 'error_correction':
      return scoreErrorCorrection(question, userAnswer);
    case 'sentence_order':
      return scoreSentenceOrder(question, userAnswer);
    case 'sentence_transform':
      return scoreSentenceTransform(question, userAnswer);
    default:
      return { score: 0, maxScore: 1, details: 'Unknown type' };
  }
}

function scoreFillBlank(q, answer) {
  // answer = { "1": "word", "2": "word", ... }
  const blanks = q.blanks || {};
  const total = Object.keys(blanks).length;
  let correct = 0;
  const details = {};

  for (const [key, expected] of Object.entries(blanks)) {
    const given = String(answer[key] || '').trim().toLowerCase();
    const exp = String(expected).trim().toLowerCase();
    const isCorrect = given === exp;
    if (isCorrect) correct++;
    details[key] = { given: answer[key], expected, correct: isCorrect };
  }

  return { score: correct / total, maxScore: 1, correct, total, details };
}

function scoreErrorCorrection(q, answer) {
  // answer = { "0": selectedIndex, "1": selectedIndex, ... }
  const sentences = q.sentences || [];
  const total = sentences.length;
  let correct = 0;
  const details = [];

  sentences.forEach((s, i) => {
    const selected = Number(answer[String(i)]);
    const isCorrect = selected === s.correct;
    if (isCorrect) correct++;
    details.push({ selected, expected: s.correct, correct: isCorrect });
  });

  return { score: correct / total, maxScore: 1, correct, total, details };
}

function scoreSentenceOrder(q, answer) {
  // answer = [index, index, ...] — user's ordering
  const correctOrder = q.correct || q.correct_order || [];
  if (!Array.isArray(answer) || answer.length !== correctOrder.length) {
    return { score: 0, maxScore: 1, details: 'Invalid answer format' };
  }

  let correct = 0;
  for (let i = 0; i < correctOrder.length; i++) {
    if (Number(answer[i]) === correctOrder[i]) correct++;
  }

  return { score: correct / correctOrder.length, maxScore: 1, correct, total: correctOrder.length };
}

function scoreSentenceTransform(q, answer) {
  // answer = { "0": "user text", "1": "user text", ... }
  const sentences = q.sentences || [];
  const total = sentences.length;
  let correct = 0;
  const details = [];

  sentences.forEach((s, i) => {
    const given = String(answer[String(i)] || '').trim().toLowerCase()
      .replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
    
    let acceptedList = [];
    if (s.accept) {
      acceptedList = Array.isArray(s.accept) ? s.accept : [s.accept];
    } else if (s.answer) {
      acceptedList = [s.answer];
    }
    
    const accepted = acceptedList.map(a => String(a || '').toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' '));

    // Check if user answer contains any accepted pattern or matches exactly
    const isCorrect = accepted.some(acc => given === acc || given.includes(acc) || acc.includes(given));
    if (isCorrect) correct++;
    details.push({ given: answer[String(i)], accepted: acceptedList, correct: isCorrect });
  });

  return { score: correct / total, maxScore: 1, correct, total, details };
}

/**
 * Score all writing questions for an exam session
 * @param {Array} questions - writing questions from bank
 * @param {Object} answers - { questionId: userAnswer }
 * @returns {{ score: number, max: 10, details: Array }}
 */
function scoreAllWriting(questions, answers) {
  if (!questions || questions.length === 0) return { score: 0, max: 10, details: [] };

  const details = [];
  let totalScore = 0;

  questions.forEach(q => {
    const userAnswer = answers[q.id];
    const result = scoreWritingQuestion(q, userAnswer);
    totalScore += result.score;
    details.push({ id: q.id, type: q.type, ...result });
  });

  // Normalize to 0-10 scale
  const normalized = Math.round((totalScore / questions.length) * 10);
  return { score: Math.min(normalized, 10), max: 10, details };
}

module.exports = { scoreWritingQuestion, scoreAllWriting };
