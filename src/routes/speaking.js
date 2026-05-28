/**
 * Speaking 1-on-1 Test Routes
 * Conversational speaking test with AWS Polly TTS + LLM
 */
const express = require('express');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { invokeNova } = require('../lib/llm');
const db = require('../lib/db');
const { verifyExamToken } = require('../lib/auth');

const router = express.Router();

// ── Polly Client ───────────────────────────────────────────
let _polly = null;
function getPolly() {
  if (_polly) return _polly;
  const config = { region: process.env.AWS_REGION || 'ap-southeast-1' };
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }
  _polly = new PollyClient(config);
  return _polly;
}

// ── Auth Middleware ─────────────────────────────────────────
function examAuth(req, res, next) {
  const token = req.body?.token || req.query.t || req.headers['x-exam-token'];
  if (!token) return res.status(401).json({ error: 'missing_token' });
  const decoded = verifyExamToken(token);
  if (!decoded) return res.status(401).json({ error: 'token_invalid' });
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(decoded.sid);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  req.session = session;
  req.decoded = decoded;
  next();
}

// ── Speaking Test Scenarios ─────────────────────────────────
const SCENARIOS = {
  B1: [
    { part: 1, topic: 'Introduction', prompt: "Hello! I'm your interviewer today. Could you please tell me your name and describe what you do at work?" },
    { part: 2, topic: 'Tourism Service', prompt: "Now let's talk about customer service. Can you describe a time when you helped a customer with a travel booking? What did you do?" },
    { part: 3, topic: 'Role-play: Hotel Check-in', prompt: "Let's do a role-play. I'm a guest arriving at your hotel. I'd like to check in, but I can't find my booking confirmation. How would you help me?" },
  ],
  C1: [
    { part: 1, topic: 'Professional Background', prompt: "Good morning! Thank you for joining this assessment. Could you tell me about your professional background and your current role in the tourism industry?" },
    { part: 2, topic: 'Industry Challenges', prompt: "Let's discuss the tourism industry. What do you think are the biggest challenges facing Vietnamese tourism today, and how should companies adapt?" },
    { part: 3, topic: 'Role-play: Difficult Customer', prompt: "Now for a scenario. I'm a customer who booked a luxury tour package, but the hotel was below the standard promised. I'm very upset and demanding a full refund. How do you handle this situation?" },
  ],
};

// ── POST /api/speaking/start ────────────────────────────────
// Start a speaking test session
router.post('/start', examAuth, (req, res) => {
  const level = req.body.level || (req.session.is_management ? 'C1' : 'B1');
  const scenarios = SCENARIOS[level] || SCENARIOS.B1;

  // Store speaking session state
  const speakingState = {
    level,
    startedAt: Date.now(),
    currentPart: 0,
    conversation: [],
    scenarios,
  };

  try {
    const existing = JSON.parse(req.session.answers || '{}');
    existing.speaking_1on1 = speakingState;
    db.prepare('UPDATE sessions SET answers = ? WHERE id = ?')
      .run(JSON.stringify(existing), req.session.id);
  } catch {}

  res.json({
    ok: true,
    level,
    totalParts: scenarios.length,
    firstQuestion: scenarios[0].prompt,
    firstTopic: scenarios[0].topic,
    part: 1,
  });
});

// ── POST /api/speaking/synthesize ───────────────────────────
// Convert text to speech using AWS Polly
router.post('/synthesize', examAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || text.length > 500) {
    return res.status(400).json({ error: 'invalid_text', message: 'Text must be 1-500 characters.' });
  }

  try {
    const polly = getPolly();
    const command = new SynthesizeSpeechCommand({
      Text: `<speak><prosody rate="95%">${text.replace(/[<>&]/g, '')}</prosody></speak>`,
      TextType: 'ssml',
      OutputFormat: 'mp3',
      VoiceId: 'Ruth',
      Engine: 'generative',
    });

    const response = await polly.send(command);
    const chunks = [];
    for await (const chunk of response.AudioStream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (err) {
    console.error('[speaking/synthesize] Polly error:', err.message);
    // Fallback: return empty response so frontend shows text-only
    res.status(503).json({ error: 'polly_unavailable', message: 'Voice synthesis unavailable. Text mode active.' });
  }
});

// ── POST /api/speaking/respond ──────────────────────────────
// Process candidate response and generate follow-up
router.post('/respond', examAuth, async (req, res) => {
  const { transcript, part, conversationHistory } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: 'missing_transcript' });
  }

  try {
    const existing = JSON.parse(req.session.answers || '{}');
    const state = existing.speaking_1on1 || {};
    const level = state.level || 'B1';
    const scenarios = state.scenarios || SCENARIOS.B1;
    const currentPart = (part || 1) - 1;
    const scenario = scenarios[currentPart] || scenarios[0];

    // Save candidate response
    if (!state.conversation) state.conversation = [];
    state.conversation.push({ role: 'candidate', text: transcript, part, ts: Date.now() });

    // Check if we should move to next part
    const turnsInPart = state.conversation.filter(c => c.part === part && c.role === 'candidate').length;
    const shouldAdvance = turnsInPart >= 3; // 3 turns per part max

    let nextQuestion;
    let nextPart = part;
    let isComplete = false;

    if (shouldAdvance && currentPart < scenarios.length - 1) {
      // Move to next part
      nextPart = part + 1;
      nextQuestion = scenarios[currentPart + 1].prompt;
    } else if (shouldAdvance && currentPart >= scenarios.length - 1) {
      // Test complete
      isComplete = true;
      nextQuestion = "Thank you very much for your responses. That concludes our speaking assessment. You did well!";
    } else {
      // Generate follow-up question with Bedrock Nova
      const history = (conversationHistory || []).slice(-6).map(h =>
        `${h.role === 'ai' ? 'Interviewer' : 'Candidate'}: ${h.text}`
      ).join('\n');

      const systemPrompt = `You are an English speaking test interviewer for Vietravel (Vietnamese travel company). 
You are conducting Part ${part} of the test. Topic: ${scenario.topic}. Target CEFR level: ${level}.
Generate ONE natural follow-up question based on the candidate's response. Keep it concise (1-2 sentences).
${level === 'C1' ? 'Ask challenging questions that require analysis and opinion.' : 'Ask clear, straightforward questions.'}
Respond with ONLY the question text, nothing else.`;

      const userPrompt = `Conversation so far:\n${history}\nCandidate just said: "${transcript}"\n\nGenerate the next interviewer question:`;

      nextQuestion = await invokeNova(systemPrompt, userPrompt, 150) || "Could you tell me more about that?";
    }

    // Save AI response
    state.conversation.push({ role: 'ai', text: nextQuestion, part: nextPart, ts: Date.now() });
    state.currentPart = nextPart - 1;
    existing.speaking_1on1 = state;
    db.prepare('UPDATE sessions SET answers = ? WHERE id = ?')
      .run(JSON.stringify(existing), req.session.id);

    res.json({
      ok: true,
      question: nextQuestion,
      part: nextPart,
      topic: scenarios[nextPart - 1]?.topic || scenario.topic,
      isComplete,
      turnsInPart,
    });
  } catch (err) {
    console.error('[speaking/respond] Error:', err.message);
    res.status(500).json({ error: 'ai_error', message: err.message });
  }
});

// ── POST /api/speaking/complete ─────────────────────────────
// Finalize speaking test and get scores
router.post('/complete', examAuth, async (req, res) => {
  try {
    const existing = JSON.parse(req.session.answers || '{}');
    const state = existing.speaking_1on1 || {};
    const conversation = state.conversation || [];
    const level = state.level || 'B1';

    // Build full transcript
    const fullTranscript = conversation.map(c =>
      `[Part ${c.part}] ${c.role === 'ai' ? 'Interviewer' : 'Candidate'}: ${c.text}`
    ).join('\n');

    const candidateResponses = conversation.filter(c => c.role === 'candidate');
    const totalWords = candidateResponses.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0);
    const totalDuration = candidateResponses.length > 0
      ? Math.round((conversation[conversation.length - 1].ts - state.startedAt) / 1000)
      : 0;

    // Grade with Bedrock Nova
    const systemPrompt = `You are an expert English speaking examiner. Grade this speaking test transcript.
Respond with valid JSON only, no markdown.`;
    const userPrompt = `Grade this speaking test for a Vietravel employee. Target CEFR: ${level}.
Total words spoken by candidate: ${totalWords}
Duration: ${totalDuration} seconds

Full transcript:
${fullTranscript}

Return JSON:
{
  "score": <0-10, one decimal>,
  "band": "<A1|A2|B1|B2|C1|C2>",
  "criteria": {
    "fluency": <0-10>,
    "grammar": <0-10>,
    "vocabulary": <0-10>,
    "coherence": <0-10>,
    "interaction": <0-10>
  },
  "strengths": ["<str1>", "<str2>"],
  "improvements": ["<imp1>", "<imp2>"],
  "feedback_vi": "<3-4 câu nhận xét bằng tiếng Việt>",
  "feedback_en": "<3-4 sentence feedback in English>"
}`;

    let grade;
    try {
      const text = await invokeNova(systemPrompt, userPrompt, 800);
      const objMatch = text.match(/\{[\s\S]*\}/);
      grade = JSON.parse(objMatch ? objMatch[0] : text);
    } catch {
      // Dynamic fallback based on word count and target level
      const targetLevel = level || 'B1';
      let score = 5.0;
      let band = 'B1';
      
      if (totalWords >= 150) {
        score = targetLevel === 'C1' ? 8.5 : 9.0;
        band = targetLevel;
      } else if (totalWords >= 80) {
        score = targetLevel === 'C1' ? 7.0 : 7.5;
        band = targetLevel;
      } else if (totalWords > 0) {
        score = 5.0;
        band = targetLevel === 'C1' ? 'B2' : 'B1';
      } else {
        score = 0;
        band = 'A1';
      }
      
      grade = {
        score,
        band,
        criteria: {
          fluency: Math.round(score),
          grammar: Math.round(score),
          vocabulary: Math.round(score),
          coherence: Math.round(score),
          interaction: Math.round(score)
        },
        feedback_vi: `Đã hoàn thành bài thi nói với ${totalWords} từ. Chấm điểm tự động dựa trên lượng từ đối thoại.`,
        feedback_en: `Speaking test completed with ${totalWords} words. Automated score assigned based on response volume.`
      };
    }

    // Save results
    state.completedAt = Date.now();
    state.grade = grade;
    state.metadata = { totalWords, totalDuration, turns: candidateResponses.length };
    existing.speaking_1on1 = state;

    // Update session with speaking score
    db.prepare('UPDATE sessions SET answers = ?, score_speaking = ? WHERE id = ?')
      .run(JSON.stringify(existing), Math.round(grade.score * 10) / 10, req.session.id);

    res.json({
      ok: true,
      grade,
      metadata: state.metadata,
    });
  } catch (err) {
    console.error('[speaking/complete] Error:', err.message);
    res.status(500).json({ error: 'scoring_failed', message: err.message });
  }
});

module.exports = router;
