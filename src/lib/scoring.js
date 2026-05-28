const { scoreAllWriting, scoreWritingQuestion } = require('./writing-scorer');

let gradeShortAnswer = null;
try { gradeShortAnswer = require('./llm-grader').gradeShortAnswer; } catch {}

const POSITION_MAP = {
  staff:        { label: 'Nhân viên',  management: false, bank: 'BANK_STAFF' },
  manager:      { label: 'Quản lý',   management: true,  bank: 'BANK_OFFICE_MGR' },
  // Backward compatibility fallbacks
  staff_field:  { label: 'Nhân viên',  management: false, bank: 'BANK_STAFF' },
  staff_office: { label: 'Nhân viên',  management: false, bank: 'BANK_STAFF' },
  mgmt_field:   { label: 'Quản lý',   management: true,  bank: 'BANK_OFFICE_MGR' },
  mgmt_office:  { label: 'Quản lý',   management: true,  bank: 'BANK_OFFICE_MGR' },
};

function positionInfo(code) { return POSITION_MAP[code] || null; }

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick listening questions by audio group so that every selected question
 * belongs to the same audio clip that will be played.
 *
 * Algorithm:
 *  1. Group all listening questions by their audioFile field.
 *  2. Shuffle the groups.
 *  3. Pick one complete group (all questions for that audio clip).
 *     If that group has more questions than needed, trim it.
 *  4. If the first group doesn't fill n, keep adding groups until n is reached.
 *
 * This guarantees the audio player and the questions always match.
 */
function pickListeningByGroup(listeningBank, groupCount) {
  // Build groups: { audioFile -> [questions] }
  const groupMap = {};
  for (const q of listeningBank) {
    const key = (q.audioFile || 'unknown').toLowerCase();
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(q);
  }

  // Shuffle the groups themselves
  const groups = shuffle(Object.values(groupMap));

  const selected = [];
  const selectedGroups = groups.slice(0, groupCount);
  for (const group of selectedGroups) {
    selected.push(...shuffle(group));
  }
  return selected;
}

function sampleQuestions(bank, isManagement) {
  const pickN = (track, n) => {
    const shuffled = shuffle(bank[track]);
    // For writing: deduplicate by content fingerprint
    const seen = new Set();
    const unique = [];
    for (const q of shuffled) {
      const content = q.passage || q.prompt || q.question || (q.sentences ? JSON.stringify(q.sentences) : '') || q.id;
      const fingerprint = (q.instruction || '') + '|' + content.slice(0, 60) + '|' + (q.type || '');
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      unique.push(q);
      if (unique.length >= n) break;
    }
    return unique;
  };
  return {
    // Listening: Pick 2 complete audio groups
    listening: pickListeningByGroup(bank.listening, 2),
    // Reading: Pick 1 complete passage group
    reading:   pickReadingByPassage(bank.reading, 1),
    writing:   pickN('writing', 5),
  };
}

function shieldForClient(questionSet) {
  const stripListeningReading = (q) => ({
    id: q.id, passageId: q.passageId, audioFile: q.audioFile, level: q.level, topic: q.topic,
    audio: q.audio, question: q.question, options: q.options, passage: q.passage,
  });

  const stripWriting = (q) => {
    const base = { id: q.id, level: q.level, topic: q.topic, type: q.type, instruction: q.instruction };
    switch (q.type) {
      case 'fill_blank':
        return { ...base, passage: q.passage, options: q.options, blanks: Object.keys(q.blanks || {}).reduce((o, k) => { o[k] = ''; return o; }, {}) };
      case 'error_correction':
        return { ...base, sentences: q.sentences.map(s => ({ original: s.original, options: s.options })) };
      case 'sentence_order':
        return { ...base, sentences: q.sentences };
      case 'sentence_transform':
        return { ...base, sentences: q.sentences.map(s => ({ original: s.original, keyword: s.keyword })) };
      case 'short_answer':
        return { ...base, prompt: q.prompt, minWords: q.minWords, maxWords: q.maxWords };
      default:
        return { ...base, prompt: q.prompt, options: q.options };
    }
  };

  return {
    listening: questionSet.listening.map(stripListeningReading),
    reading:   questionSet.reading.map(stripListeningReading),
    writing:   questionSet.writing.map(stripWriting),
  };
}

async function scoreAnswers(questionSet, answers) {
  const scores = { listening: 0, reading: 0, writing: 0 };
  const details = { listening: [], reading: [], writing: [] };
  const flags = { writing_pending_review: false };

  // Score listening & reading (MCQ)
  for (const track of ['listening', 'reading']) {
    let correctCount = 0;
    questionSet[track].forEach(q => {
      const userAnswer = (answers[track] || {})[q.id];
      const correct = userAnswer !== undefined && userAnswer !== null
                      && Number(userAnswer) === Number(q.correct);
      if (correct) correctCount++;
      details[track].push({ id: q.id, userAnswer, correct: q.correct, isCorrect: correct });
    });
    const qCount = questionSet[track].length || 1;
    scores[track] = Math.round((correctCount / qCount) * 10);
  }

  // Score writing — auto-score for new types, LLM for short_answer
  const writingAnswers = answers.writing || {};
  let writingTotal = 0;

  for (const q of questionSet.writing) {
    const userAnswer = writingAnswers[q.id];

    if (['fill_blank', 'error_correction', 'sentence_order', 'sentence_transform'].includes(q.type)) {
      // Auto-score — no AI needed
      const result = scoreWritingQuestion(q, userAnswer);
      writingTotal += result.score;
      details.writing.push({ id: q.id, type: q.type, ...result, pending: false });
    } else if (q.type === 'short_answer') {
      // LLM grading with length-based deterministic fallback
      let graded = false;
      if (gradeShortAnswer) {
        try {
          const result = await gradeShortAnswer({ item: q, answer: userAnswer });
          writingTotal += (result.score || 0);
          details.writing.push({ id: q.id, type: q.type, points: result.score, pending: false, feedback: result.feedback });
          graded = true;
        } catch (err) {
          console.warn('[AI Grading] Bedrock failed, falling back to deterministic length-based scoring:', err.message);
        }
      }
      
      if (!graded) {
        const text = typeof userAnswer === 'string' ? userAnswer.trim() : '';
        const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
        const minWords = q.minWords || 50;
        
        let score = 0;
        let comment = 'Không có bài làm hoặc bài quá ngắn.';
        if (wordCount >= minWords) {
          score = 0.8; // 80% points for meeting length requirement
          comment = 'Bài làm đạt yêu cầu độ dài. Điểm tự động theo độ dài câu từ.';
        } else if (wordCount > 0) {
          score = 0.4; // 40% points
          comment = 'Bài làm chưa đạt yêu cầu độ dài tối thiểu. Điểm tự động theo độ dài câu từ.';
        }
        
        writingTotal += score;
        details.writing.push({
          id: q.id,
          type: q.type,
          points: score,
          pending: false,
          comment,
          feedback: `Chế độ chấm điểm tự động (độ dài: ${wordCount}/${minWords} từ).`
        });
      }
    } else {
      // Fallback — mark as 0 if no grader available
      details.writing.push({ id: q.id, type: q.type || 'unknown', points: 0, pending: false });
    }
  }

  if (!flags.writing_pending_review) {
    scores.writing = Math.min(Math.round((writingTotal / questionSet.writing.length) * 10), 10);
  } else {
    scores.writing = null;
  }

  const total = flags.writing_pending_review
    ? null
    : scores.listening + scores.reading + scores.writing;

  return { scores, total, details, flags };
}

function calcCEFR(total, isManagement) {
  if (isManagement) {
    if (total >= 27) return { level: 'C2', status: 'pass',   label: 'Proficient (Cấp Quản lý cao)' };
    if (total >= 23) return { level: 'C1', status: 'pass',   label: 'Advanced (Đạt yêu cầu Quản lý)' };
    if (total >= 18) return { level: 'B2', status: 'review', label: 'Upper-Intermediate (Cần xem xét)' };
    if (total >= 13) return { level: 'B1', status: 'review', label: 'Intermediate (Yêu cầu cải thiện)' };
    return                 { level: 'A2', status: 'fail',   label: 'Elementary (Chưa đạt cấp Quản lý)' };
  }
  // For Staff: Since questions are B1 level, maximum score caps at B2 (Excellent) or B1 (Pass)
  if (total >= 27) return { level: 'B2', status: 'pass',   label: 'Upper-Intermediate (Đạt xuất sắc)' };
  if (total >= 20) return { level: 'B1', status: 'pass',   label: 'Intermediate (Đạt yêu cầu)' };
  if (total >= 11) return { level: 'A2', status: 'review', label: 'Elementary (Cần xem xét)' };
  return                 { level: 'A1', status: 'fail',   label: 'Beginner (Chưa đạt)' };
}

// Difficulty mapping for CAT (Computerized Adaptive Testing)
const DIFFICULTY_MAP = { 'A2': 1, 'B1': 2, 'B2': 3, 'C1': 4 };
const LEVEL_MAP = { 1: 'A2', 2: 'B1', 3: 'B2', 4: 'C1' };

/**
 * Map a CEFR level string to a numeric difficulty parameter (1–4).
 * Returns 2 (B1) as default for unknown levels.
 */
function levelToDifficulty(level) {
  return DIFFICULTY_MAP[level] || 2;
}

/**
 * Map a numeric difficulty parameter (1–4) to a CEFR level string.
 * Clamps input to [1, 4] before lookup; returns 'B1' as default.
 */
function difficultyToLevel(difficulty) {
  return LEVEL_MAP[Math.max(1, Math.min(4, difficulty))] || 'B1';
}

function pickReadingByPassage(readingBank, groupCount) {
  // Build groups: { passageId -> [questions] }
  const groupMap = {};
  for (const q of readingBank) {
    const key = (q.passageId || q.id).toLowerCase();
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(q);
  }

  // Shuffle the groups themselves
  const groups = shuffle(Object.values(groupMap));

  const selected = [];
  const selectedGroups = groups.slice(0, groupCount);
  for (const group of selectedGroups) {
    selected.push(...group);
  }
  return selected;
}

module.exports = {
  POSITION_MAP, positionInfo, sampleQuestions, shieldForClient, scoreAnswers, calcCEFR,
  DIFFICULTY_MAP, LEVEL_MAP, levelToDifficulty, difficultyToLevel,
};
