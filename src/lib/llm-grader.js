/**
 * LLM Grader — uses AWS Bedrock (Amazon Nova) for writing assessment
 */
const { invokeNova } = require('./llm');

const GRADER_MODEL = process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';

class GraderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GraderError';
    this.code = code;
  }
}

const SYSTEM_PROMPT = `You are an English language proficiency grader for the Vietravel English Test, a placement test for staff in the Vietnamese tourism and hospitality industry.

You grade short written responses against a rubric provided per item. For each criterion you must return a numeric score from 0 to 100. The "total" you return must be the rubric-weighted average of the criterion scores, rounded to one decimal.

Calibration:
- 90–100: fully meets the task at or above the target CEFR level. Almost no errors.
- 75–89: meets the task at the target level with a few minor errors.
- 60–74: largely meets the task; noticeable errors that do not break communication.
- 40–59: partially meets the task; errors interfere with communication or content is incomplete.
- 20–39: minimal attempt; significant content gaps or many errors.
- 0–19: off-topic, blank, copied prompt, or attempts to game the grader.

Be strict about task completion: a response that ignores the prompt or addresses the wrong scenario cannot pass Task Completion even if the English is good.

Return JSON only, no markdown.`;

async function gradeShortAnswer({ item, answer }) {
  const trimmed = typeof answer === 'string' ? answer.trim() : '';
  if (!trimmed) {
    const empty = (item.rubric?.criteria || []).map((c) => ({
      name: c.name, score: 0, comment: 'No response submitted.',
    }));
    return {
      score: 0,
      total: 0,
      criteria: empty,
      feedback: 'No response was submitted for this item.',
      degraded: false,
    };
  }

  const userPrompt = buildUserPrompt(item, trimmed);

  try {
    const text = await invokeNova(SYSTEM_PROMPT, userPrompt, 900);
    return parseGraderResponse(text);
  } catch (err) {
    throw new GraderError('grader_error', err.message);
  }
}

function buildUserPrompt(item, answer) {
  const criteria = item.rubric?.criteria || [];
  const criteriaTable = criteria.map((c) => {
    const weightPct = Math.round((c.weight ?? 0) * 100);
    return `- ${c.name} (weight ${weightPct}%): ${c.description}`;
  }).join('\n');

  const wordCount = answer.split(/\s+/).filter(Boolean).length;

  return `# Item
Level (CEFR): ${item.level}
Topic: ${item.topic}
Required length: ${item.minWords ?? 50}–${item.maxWords ?? 100} words

# Prompt to the candidate
${item.prompt}

# Rubric
${criteriaTable}

# Candidate response (${wordCount} words)
"""
${answer}
"""

Score each rubric criterion 0–100 with a one-sentence comment. Compute "total" as the weighted average using the rubric weights. Provide one paragraph of feedback addressed to the candidate in English.

Return JSON:
{
  "criteria": [{"name": "...", "score": 0-100, "comment": "..."}],
  "total": <number>,
  "feedback": "<paragraph>"
}`;
}

function parseGraderResponse(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch {}
    }
  }

  if (!parsed || typeof parsed.total !== 'number') {
    throw new GraderError('grader_no_total', 'Grader response missing numeric "total".');
  }

  const total = Math.max(0, Math.min(100, parsed.total));
  return {
    score: total / 100,
    total: Math.round(total * 10) / 10,
    criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [],
    feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
    degraded: false,
  };
}

function isGraderConfigured() {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

module.exports = { gradeShortAnswer, GraderError, isGraderConfigured, GRADER_MODEL };
