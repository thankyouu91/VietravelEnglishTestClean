'use strict';

// ── State ──────────────────────────────────────────────────
const state = {
  token: null,
  sessionId: null,
  level: 'B1',
  currentPart: 1,
  totalParts: 3,
  conversation: [],
  isRecording: false,
  recognition: null,
  timerInterval: null,
  secondsLeft: 300, // 5 minutes total
  audioPlaying: false,
  useFallback: false,
};

const $ = id => document.getElementById(id);
function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $('screen-' + id).classList.add('active'); }
function showLoading(t) { $('loading').classList.remove('hidden'); $('loading-text').textContent = t || 'Processing...'; }
function hideLoading() { $('loading').classList.add('hidden'); }

// ── Get token from URL or exam state ───────────────────────
function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || localStorage.getItem('exam_token') || null;
}

// ── Check microphone ───────────────────────────────────────
async function checkMicrophone() {
  const statusEl = $('mic-status');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    statusEl.innerHTML = '<span class="text-emerald-600 font-bold">✅ Microphone ready</span>';
    return true;
  } catch (e) {
    statusEl.innerHTML = '<span class="text-amber-600 font-bold">⚠️ Microphone not available — text mode will be used</span>';
    state.useFallback = true;
    return false;
  }
}

// ── Check Speech Recognition support ───────────────────────
function hasSpeechRecognition() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

// ── Start Speaking Test ────────────────────────────────────
async function startSpeakingTest() {
  const token = getToken();
  if (!token) {
    $('intro-error').textContent = 'Không tìm thấy token. Vui lòng bắt đầu từ trang bài thi.';
    $('intro-error').classList.remove('hidden');
    return;
  }
  state.token = token;

  if (!hasSpeechRecognition() && !state.useFallback) {
    state.useFallback = true;
    $('mic-status').innerHTML = '<span class="text-amber-600 font-bold">⚠️ Browser không hỗ trợ Speech Recognition — dùng text mode</span>';
  }

  showLoading('Đang khởi tạo bài thi nói...');

  try {
    const r = await fetch('/api/speaking/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, level: state.level }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || data.error);

    state.level = data.level;
    state.totalParts = data.totalParts;
    state.currentPart = 1;

    hideLoading();
    showScreen('test');
    startTimer();

    // Show first question
    await showAIMessage(data.firstQuestion, data.firstTopic, 1);
  } catch (e) {
    hideLoading();
    $('intro-error').textContent = e.message;
    $('intro-error').classList.remove('hidden');
  }
}

// ── Timer ──────────────────────────────────────────────────
function startTimer() {
  renderTimer();
  state.timerInterval = setInterval(() => {
    state.secondsLeft--;
    renderTimer();
    if (state.secondsLeft <= 0) {
      clearInterval(state.timerInterval);
      finishTest();
    }
  }, 1000);
}

function renderTimer() {
  const m = Math.floor(state.secondsLeft / 60);
  const s = state.secondsLeft % 60;
  $('test-timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  $('test-timer').className = 'text-lg font-black tabular-nums ' + (state.secondsLeft <= 30 ? 'text-red-600 animate-pulse' : state.secondsLeft <= 60 ? 'text-amber-500' : 'text-brand');
}

// ── Show AI Message + TTS ──────────────────────────────────
async function showAIMessage(text, topic, part) {
  state.currentPart = part;
  $('test-part').textContent = `Part ${part} — ${topic || 'Conversation'}`;
  $('ai-message').textContent = text;
  $('ai-status').textContent = '🔊 Speaking...';
  $('ai-wave').classList.remove('hidden');
  $('btn-record').disabled = true;

  // Add to conversation
  state.conversation.push({ role: 'ai', text, part });
  addToHistory('ai', text);

  // Try to synthesize with Polly
  try {
    const r = await fetch('/api/speaking/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-exam-token': state.token },
      body: JSON.stringify({ text }),
    });

    if (r.ok && r.headers.get('content-type')?.includes('audio')) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      state.audioPlaying = true;

      await new Promise((resolve) => {
        audio.onended = () => { state.audioPlaying = false; resolve(); };
        audio.onerror = () => { state.audioPlaying = false; resolve(); };
        audio.play().catch(() => { state.audioPlaying = false; resolve(); });
      });

      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.warn('Polly TTS failed, text-only mode:', e.message);
  }

  // Ready for candidate
  $('ai-status').textContent = 'Waiting for your response...';
  $('ai-wave').classList.add('hidden');
  $('candidate-status').textContent = '🎤 Your turn — click "Start Speaking"';
  $('btn-record').disabled = false;

  if (state.useFallback) {
    $('text-fallback').classList.remove('hidden');
    $('btn-record').classList.add('hidden');
  }
}

// ── Recording ──────────────────────────────────────────────
function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  if (state.useFallback) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalTranscript = '';

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    $('candidate-transcript').textContent = finalTranscript + interim;
  };

  recognition.onerror = (e) => {
    console.error('Speech recognition error:', e.error);
    if (e.error === 'not-allowed') {
      state.useFallback = true;
      $('text-fallback').classList.remove('hidden');
      $('candidate-status').textContent = '⌨️ Text mode — type your response';
    }
  };

  recognition.onend = () => {
    if (state.isRecording) {
      // Auto-restart if still recording
      try { recognition.start(); } catch {}
    }
  };

  state.recognition = recognition;
  state.isRecording = true;
  recognition.start();

  $('btn-record').textContent = '🔴 Recording...';
  $('btn-record').classList.replace('bg-emerald-600', 'bg-red-600');
  $('btn-stop').classList.remove('hidden');
  $('mic-indicator').classList.remove('hidden');
  $('candidate-status').textContent = '🔴 Recording — speak in English';
  $('candidate-transcript').textContent = '';
}

function stopRecording() {
  state.isRecording = false;
  if (state.recognition) {
    state.recognition.stop();
    state.recognition = null;
  }

  $('btn-record').textContent = '🎤 Start Speaking';
  $('btn-record').classList.replace('bg-red-600', 'bg-emerald-600');
  $('btn-stop').classList.add('hidden');
  $('mic-indicator').classList.add('hidden');

  const transcript = $('candidate-transcript').textContent.trim();
  if (transcript && transcript !== 'Your speech will appear here...') {
    submitResponse(transcript);
  } else {
    $('candidate-status').textContent = 'No speech detected. Try again or use text mode.';
    $('text-fallback').classList.remove('hidden');
  }
}

function submitTextResponse() {
  const text = $('text-input').value.trim();
  if (!text) return;
  $('text-input').value = '';
  $('candidate-transcript').textContent = text;
  submitResponse(text);
}

function skipTurn() {
  submitResponse("I'm not sure how to answer that.");
}

// ── Submit Response to Backend ─────────────────────────────
async function submitResponse(transcript) {
  state.conversation.push({ role: 'candidate', text: transcript, part: state.currentPart });
  addToHistory('candidate', transcript);

  $('btn-record').disabled = true;
  $('candidate-status').textContent = '⏳ AI is thinking...';
  $('ai-status').textContent = '💭 Generating response...';

  try {
    const r = await fetch('/api/speaking/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-exam-token': state.token },
      body: JSON.stringify({
        token: state.token,
        transcript,
        part: state.currentPart,
        conversationHistory: state.conversation.slice(-8),
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || data.error);

    if (data.isComplete) {
      await showAIMessage(data.question, 'Closing', data.part);
      setTimeout(finishTest, 2000);
    } else {
      await showAIMessage(data.question, data.topic, data.part);
    }
  } catch (e) {
    console.error('Response error:', e);
    $('candidate-status').textContent = '❌ Error: ' + e.message;
    $('btn-record').disabled = false;
  }
}

// ── Finish Test ────────────────────────────────────────────
async function finishTest() {
  clearInterval(state.timerInterval);
  showLoading('Đang chấm điểm bài nói...');

  try {
    const r = await fetch('/api/speaking/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-exam-token': state.token },
      body: JSON.stringify({ token: state.token }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || data.error);

    hideLoading();
    showResults(data.grade, data.metadata);
  } catch (e) {
    hideLoading();
    showResults({ score: 0, band: '—', feedback_vi: 'Lỗi khi chấm điểm: ' + e.message }, {});
  }
}

// ── Show Results ───────────────────────────────────────────
function showResults(grade, metadata) {
  showScreen('result');

  $('r-score').textContent = grade.score || '—';
  $('r-band').textContent = `CEFR: ${grade.band || '—'}`;

  // Criteria bars
  const criteria = grade.criteria || {};
  const criteriaNames = { fluency: 'Fluency', grammar: 'Grammar', vocabulary: 'Vocabulary', coherence: 'Coherence', interaction: 'Interaction' };
  $('result-criteria').innerHTML = Object.entries(criteriaNames).map(([key, label]) => {
    const val = criteria[key] || 0;
    const pct = val * 10;
    const color = val >= 7 ? 'bg-emerald-500' : val >= 5 ? 'bg-amber-400' : 'bg-red-400';
    return `<div class="flex items-center gap-3">
      <span class="text-xs font-bold w-24 text-gray-600">${label}</span>
      <div class="flex-1 h-2.5 bg-gray-100 rounded-full"><div class="${color} h-full rounded-full transition-all" style="width:${pct}%"></div></div>
      <span class="text-xs font-black w-8 text-right">${val}</span>
    </div>`;
  }).join('');

  // Feedback
  const fb = [];
  if (grade.feedback_vi) fb.push(`<p class="mb-2">${escapeHtml(grade.feedback_vi)}</p>`);
  if (grade.feedback_en) fb.push(`<p class="text-gray-400 italic">${escapeHtml(grade.feedback_en)}</p>`);
  if (grade.strengths?.length) fb.push(`<p class="mt-2 text-emerald-700"><strong>✅ Strengths:</strong> ${escapeHtml(grade.strengths.join(', '))}</p>`);
  if (grade.improvements?.length) fb.push(`<p class="text-amber-700"><strong>⚠️ Improve:</strong> ${escapeHtml(grade.improvements.join(', '))}</p>`);
  if (metadata?.totalWords) fb.push(`<p class="mt-2 text-gray-400 text-[10px]">Words: ${metadata.totalWords} | Duration: ${metadata.totalDuration}s | Turns: ${metadata.turns}</p>`);
  $('result-feedback').innerHTML = fb.join('') || 'No feedback available.';
}

// ── History ────────────────────────────────────────────────
function addToHistory(role, text) {
  const el = document.createElement('div');
  const isAI = role === 'ai';
  el.className = `flex gap-2 ${isAI ? '' : 'flex-row-reverse'}`;
  el.innerHTML = `
    <div class="w-6 h-6 rounded-full ${isAI ? 'bg-brand' : 'bg-emerald-500'} flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">${isAI ? 'AI' : 'U'}</div>
    <div class="${isAI ? 'bg-blue-50 text-blue-900' : 'bg-emerald-50 text-emerald-900'} rounded-xl px-3 py-2 text-xs max-w-[80%]">${escapeHtml(text)}</div>
  `;
  $('history').appendChild(el);
  $('history').scrollTop = $('history').scrollHeight;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── Init ───────────────────────────────────────────────────
(async function init() {
  await checkMicrophone();

  // Check if token is in URL
  const token = getToken();
  if (token) {
    state.token = token;
  }
})();
