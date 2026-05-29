'use strict';
// ── State ──────────────────────────────────────────────────
const examState = {
  token:null,sessionId:null,examId:null,durationSec:1800,maxListens:2,
  questions:null,answers:{listening:{},reading:{},writing:{},speaking:{}},
  speakingQuestions:[],speakingGrades:{},writingGrades:{},
  listenCounts:{},timerInterval:null,secondsLeft:0,
  currentTrack:'listening',submitted:false,cheatEvents:0,
  positionLabel:'',cefrLevel:'B1',
};

const $=id=>document.getElementById(id);
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$('screen-'+id).classList.add('active');window.scrollTo(0,0);}
function showLoading(t){$('loading-overlay').classList.remove('hidden');$('loading-text').textContent=t||'Đang xử lý…';}
function hideLoading(){$('loading-overlay').classList.add('hidden');}
function escHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}
async function apiPost(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||j.error||`HTTP ${r.status}`);
  return j;
}
async function apiGet(url){
  const r=await fetch(url);
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||j.error||`HTTP ${r.status}`);
  return j;
}

// ── Invitation check ───────────────────────────────────────
(async function checkInvite(){
  const params=new URLSearchParams(window.location.search);
  const inviteId=params.get('invite');
  if(!inviteId)return;
  try{
    const data=await apiGet(`/admin/api/invitation-check/${inviteId}`);
    if(data.position)document.getElementById('f-position').value=data.position;
    // Store invite ID to mark as used after exam starts
    examState.inviteId=inviteId;
    
    if(data.email){
      const hintEl=document.createElement('div');
      hintEl.className='bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-xs text-blue-800 dark:bg-slate-900/60 dark:border-slate-800 dark:text-slate-300';
      hintEl.innerHTML=`<strong>🔑 Link mời hợp lệ:</strong> Link này dành riêng cho ứng viên có email dạng <code>${escHtml(data.email)}</code>. Vui lòng nhập đúng Họ tên và Email của bạn để bắt đầu làm bài.`;
      document.getElementById('registerForm').prepend(hintEl);
    }
    
    if(data.message){
      const msgEl=document.createElement('div');
      msgEl.className='bg-brand-pale border border-blue-200 rounded-xl p-4 mb-4 text-xs text-blue-800 dark:bg-slate-900/40 dark:border-slate-800 dark:text-slate-300';
      msgEl.innerHTML=`<strong>📨 Lời nhắn từ HR:</strong> ${escHtml(data.message)}`;
      document.getElementById('registerForm').prepend(msgEl);
    }
  }catch(e){
    // Invalid/expired invite — show error but still allow manual entry
    if(e.message){
      const errEl=document.getElementById('reg-error');
      errEl.textContent=e.message;
      errEl.classList.remove('hidden');
    }
  }
})();

// ── Anti-cheat ─────────────────────────────────────────────
function initAntiCheat(){
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!examState.submitted)triggerCheat('tab_switch');});
  window.addEventListener('blur',()=>{if(!examState.submitted)triggerCheat('window_blur');});
  document.addEventListener('contextmenu',e=>{if(!examState.submitted)e.preventDefault();});
  document.addEventListener('keydown',e=>{
    if(examState.submitted)return;
    const ctrl=e.ctrlKey||e.metaKey;
    if(ctrl&&['c','v','a','x','u','s','p'].includes(e.key.toLowerCase())){e.preventDefault();triggerCheat('keyboard');}
    if(e.key==='F12'||(ctrl&&e.shiftKey&&e.key==='I'))e.preventDefault();
    if(e.key==='Escape')closeSubmitModal();
  });
}
function triggerCheat(type){
  examState.cheatEvents++;
  const bar=$('cheat-warn');
  if(bar){bar.classList.remove('hidden');setTimeout(()=>bar.classList.add('hidden'),4000);}
}
function blockPasteOnWriting(){
  document.querySelectorAll('.writing-textarea').forEach(ta=>{
    ta.addEventListener('paste',e=>{e.preventDefault();triggerCheat('paste');});
    ta.addEventListener('drop',e=>{e.preventDefault();triggerCheat('drop');});
  });
}

// ── Timer ──────────────────────────────────────────────────
function startTimer(s){
  examState.secondsLeft=s;renderTimer();
  examState.timerInterval=setInterval(()=>{
    examState.secondsLeft--;renderTimer();
    if(examState.secondsLeft<=0){clearInterval(examState.timerInterval);autoSubmit();}
  },1000);
}
function renderTimer(){
  const s=examState.secondsLeft,el=$('timer');
  el.textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  el.className='text-xl font-black tabular-nums min-w-[58px] text-right '+(s<=60?'text-red-600 animate-pulse':s<=300?'text-amber-500':'text-brand');
}

// ── Registration ───────────────────────────────────────────
$('registerForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const errEl=$('reg-error');errEl.classList.add('hidden');
  const btn=$('reg-btn');btn.disabled=true;btn.textContent='Đang khởi tạo…';
  const name=$('f-name').value.trim(),email=$('f-email').value.trim(),
        position=$('f-position').value,consent=$('f-consent').checked;
  try{
    showLoading('Đang tạo bài thi…');
    const data=await apiPost('/api/exam/start',{name,email,position,consent,inviteId:examState.inviteId});
    Object.assign(examState,{
      token:data.token,sessionId:data.sessionId,examId:data.examId,
      durationSec:data.durationSec,maxListens:data.maxListens,
      questions:data.questions,positionLabel:data.positionLabel||position,
      answers:{listening:{},reading:{},writing:{},speaking:{}},
      speakingQuestions:[],speakingGrades:{},writingGrades:{},
      listenCounts:{},submitted:false,currentTrack:'listening',cheatEvents:0,
    });
    // Determine CEFR level from position
    examState.cefrLevel=data.isManagement?'C1':'B1';
    hideLoading();
    buildExamUI(name);
    showScreen('exam');
    startTimer(data.durationSec);
    initAntiCheat();
    // Mark invitation as used
    if(examState.inviteId){
      apiPost(`/admin/api/invitation-use/${examState.inviteId}`,{sessionId:data.sessionId}).catch(()=>{});
    }
    // Load speaking questions in background
    loadSpeakingQuestions();
  }catch(err){
    hideLoading();errEl.textContent=err.message;errEl.classList.remove('hidden');
    btn.disabled=false;btn.textContent='Bắt đầu làm bài →';
  }
});

async function loadSpeakingQuestions(){
  try{
    // Fetch speaking questions with token in header
    const r=await fetch(`/api/ai/speaking-questions?level=${examState.cefrLevel}`,{
      headers:{'x-exam-token':examState.token}
    });
    const j=await r.json().catch(()=>({}));
    if(j.questions&&j.questions.length>0){
      examState.speakingQuestions=j.questions;
      buildSpeaking(j.questions);
      // Update tab count
      const el=$('prog-speaking');
      if(el)el.textContent=`0/${j.questions.length}`;
    }
  }catch(e){console.warn('Speaking questions load failed:',e.message);}
}

// ── Build Exam UI ──────────────────────────────────────────
function buildExamUI(name){
  $('hdr-name').textContent=name;
  buildListening(examState.questions.listening);
  buildReading(examState.questions.reading);
  buildWriting(examState.questions.writing);
  updateProgress();
  switchTrack('listening');
  setTimeout(blockPasteOnWriting,200);
}

// ── LISTENING ──────────────────────────────────────────────
let lsGroups = [];
let lsCurrentGroupIndex = 0;

function buildListening(questions){
  lsGroups = [];
  lsCurrentGroupIndex = 0;
  if(!questions || questions.length === 0) return;

  const seen = new Map();
  questions.forEach(q => {
    const k = q.audioFile || 'unknown';
    if(!seen.has(k)) {
      const g = { audioFile: k, topic: q.topic || 'Listening Section', qs: [] };
      seen.set(k, g);
      lsGroups.push(g);
    }
    seen.get(k).qs.push(q);
  });
  
  renderListeningGroup(0);
}

function renderListeningGroup(index) {
  if(index < 0 || index >= lsGroups.length) return;
  lsCurrentGroupIndex = index;
  const group = lsGroups[index];
  
  $('ls-player-title').textContent = group.topic || 'Phần nghe';
  
  const container = $('listening-questions-container');
  if(container) {
    container.innerHTML = '';
    group.qs.forEach((q, i) => {
      const globalQNum = lsGroups.slice(0, index).reduce((acc, g) => acc + g.qs.length, 0) + i + 1;
      const card = buildMCQCard(q, globalQNum, 'listening');
      container.appendChild(card);
      
      const storedAns = examState.answers.listening[q.id];
      if(storedAns !== undefined && storedAns !== null) {
        setTimeout(() => selectOption(q.id, storedAns, 'listening'), 50);
      }
    });
  }
  
  const startQ = lsGroups.slice(0, index).reduce((acc, g) => acc + g.qs.length, 0) + 1;
  const endQ = startQ + group.qs.length - 1;
  $('ls-question-range').textContent = `QUESTIONS ${startQ}-${endQ}`;
  
  const btnPrev = $('ls-btn-prev');
  const btnNext = $('ls-btn-next');
  if(btnPrev) btnPrev.disabled = index === 0;
  if(btnNext) btnNext.disabled = index === lsGroups.length - 1;
  
  const paginationBlock = $('ls-pagination');
  if(paginationBlock) {
    if(lsGroups.length <= 1) {
      paginationBlock.classList.add('hidden');
    } else {
      paginationBlock.classList.remove('hidden');
    }
  }

  updateAudioUI();
}

window.navListening = function(dir) {
  renderListeningGroup(lsCurrentGroupIndex + dir);
  $('listening-questions-container').parentElement.scrollTop = 0;
};

function updateAudioUI() {
  if (lsGroups.length === 0) return;
  const af = lsGroups[lsCurrentGroupIndex].audioFile;
  const used = examState.listenCounts[af] || 0;
  const max = examState.maxListens;
  $('ls-listen-count').textContent = `${max - used}/${max}`;
  $('ls-listen-count').className = used >= max ? 'text-rose-600 font-black' : 'text-brand font-black';
  $('ls-play-btn').disabled = used >= max;
  
  const audioEl = $('ls-audio-el');
  if(audioEl && audioEl.getAttribute('data-af') !== af) {
    audioEl.pause();
    audioEl.src = '';
    audioEl.removeAttribute('data-af');
    $('ls-icon-play').classList.remove('hidden');
    $('ls-icon-pause').classList.add('hidden');
    $('ls-time').textContent = '00:00 / 00:00';
    $('ls-progress-bar').style.width = '0%';
  }
}

window.toggleListeningAudio = async function() {
  if(lsGroups.length === 0) return;
  const af = lsGroups[lsCurrentGroupIndex].audioFile;
  if(!af) return;
  const audioEl = $('ls-audio-el');
  const btn = $('ls-play-btn');
  const playIcon = $('ls-icon-play');
  const pauseIcon = $('ls-icon-pause');
  
  if(!audioEl.src || audioEl.getAttribute('data-af') !== af) {
    btn.disabled = true;
    try {
      const r = await apiPost('/api/exam/listen', {token: examState.token, audioFile: af});
      examState.listenCounts[af] = r.used;
      const atParam = r.audioToken ? `at=${encodeURIComponent(r.audioToken)}` : `t=${encodeURIComponent(examState.token)}`;
      audioEl.src = `/api/audio/plain/${af}.mp3?${atParam}`;
      audioEl.setAttribute('data-af', af);
      audioEl.load();
      try {
        await audioEl.play();
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
      } catch (playErr) {
        console.warn('Autoplay prevented by browser:', playErr);
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
      }
      btn.disabled = false;
      updateAudioUI();
    } catch(err) {
      btn.disabled = false;
      console.error('Audio toggle error:', err);
      if(err.message && err.message.includes('max_listens')){
         examState.listenCounts[af] = examState.maxListens;
         updateAudioUI();
      } else { 
         alert('Lỗi tải audio: ' + err.message); 
      }
    }
  } else {
    if(audioEl.paused) {
      audioEl.play();
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      audioEl.pause();
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  updateThemeUI();
  const audioEl = $('ls-audio-el');
  if(audioEl) {
    audioEl.addEventListener('timeupdate', function() {
      const cur = this.currentTime, dur = this.duration;
      if(dur) {
        $('ls-progress-bar').style.width = (cur / dur * 100) + '%';
        const m1 = Math.floor(cur / 60).toString().padStart(2, '0');
        const s1 = Math.floor(cur % 60).toString().padStart(2, '0');
        const m2 = Math.floor(dur / 60).toString().padStart(2, '0');
        const s2 = Math.floor(dur % 60).toString().padStart(2, '0');
        $('ls-time').textContent = `${m1}:${s1} / ${m2}:${s2}`;
      }
    });
    audioEl.addEventListener('ended', function() {
      $('ls-icon-play').classList.remove('hidden');
      $('ls-icon-pause').classList.add('hidden');
    });
  }
});

// ── READING ────────────────────────────────────────────────
let rdGroups = [];
let rdCurrentGroupIndex = 0;

function buildReading(questions){
  rdGroups = [];
  rdCurrentGroupIndex = 0;
  if(!questions || questions.length === 0) return;

  const seen = new Map();
  questions.forEach(q => {
    const k = q.passageId || q.passage || q.id;
    if(!seen.has(k)) {
      const g = { passageId: k, passage: q.passage, title: q.topic || 'Reading Passage', qs: [] };
      seen.set(k, g);
      rdGroups.push(g);
    }
    seen.get(k).qs.push(q);
  });
  
  renderReadingGroup(0);
}

function getReadingImage(topic) {
  const t = (topic || '').toLowerCase();
  if (t.includes('airline') || t.includes('flight') || t.includes('aviation')) return 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=800&q=80';
  if (t.includes('hotel') || t.includes('resort')) return 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80';
  if (t.includes('tour') || t.includes('travel') || t.includes('itinerary')) return 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=800&q=80';
  if (t.includes('customer') || t.includes('complaint') || t.includes('service')) return 'https://images.unsplash.com/photo-1556745753-b2904692b3cd?auto=format&fit=crop&w=800&q=80';
  if (t.includes('business') || t.includes('partnership')) return 'https://images.unsplash.com/photo-1556761175-5973dc0f32d7?auto=format&fit=crop&w=800&q=80';
  if (t.includes('sustainability') || t.includes('green')) return 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&w=800&q=80';
  if (t.includes('employee') || t.includes('policy')) return 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=800&q=80';
  return 'https://images.unsplash.com/photo-1488085061387-422e29b40080?auto=format&fit=crop&w=800&q=80';
}

function renderReadingGroup(index) {
  if(index < 0 || index >= rdGroups.length) return;
  rdCurrentGroupIndex = index;
  const group = rdGroups[index];
  
  $('rd-passage-title').textContent = group.title;
  
  const imgUrl = getReadingImage(group.title);
  const imgHtml = `<img src="${imgUrl}" class="w-full h-48 object-cover rounded-xl mb-6 shadow-sm border border-slate-100" alt="Topic image">`;
  $('rd-passage-content').innerHTML = imgHtml + escHtml(group.passage).replace(/\n/g, '<br/>');
  
  const c = $('reading-questions-container');
  c.innerHTML = '';
  
  group.qs.forEach((q, i) => {
    const d = document.createElement('div');
    d.className = 'bg-white border border-slate-200 rounded-xl p-5 shadow-sm';
    
    // Header câu hỏi
    const globalQNum = rdGroups.slice(0, index).reduce((acc, g) => acc + g.qs.length, 0) + i + 1;
    d.innerHTML = `<div class="flex items-start gap-3 mb-4">
      <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm shrink-0 border border-slate-200">${globalQNum}</div>
      <div class="text-sm font-bold text-slate-800 leading-snug pt-1">${escHtml(q.question)}</div>
    </div>`;
    
    const optsDiv = document.createElement('div');
    optsDiv.className = q.options.length === 3 ? 'flex flex-wrap gap-3' : 'space-y-3';
    
    const letters = ['A','B','C','D','E','F'];
    (q.options||[]).forEach((opt, oIdx) => {
      const isSelected = examState.answers.reading[q.id] !== undefined && Number(examState.answers.reading[q.id]) === oIdx;
      const lbl = document.createElement('label');
      
      if(q.options.length === 3) {
         // UI kiểu True/False/Not Given
         lbl.className = `flex-1 min-w-[120px] p-3 rounded-lg border-2 cursor-pointer transition text-center font-bold text-xs uppercase tracking-wide
            ${isSelected ? 'border-brand-light bg-brand-light/5 text-brand shadow-sm' : 'border-slate-200 text-slate-500 hover:border-brand-light/50 hover:bg-brand-pale'}`;
         lbl.innerHTML = `
           <input type="radio" name="rd-q-${q.id}" class="hidden" value="${oIdx}" onchange="selectRdAns('${q.id}', this.value)" ${isSelected ? 'checked' : ''}>
           ${escHtml(opt)}
         `;
      } else {
         // UI kiểu Trắc nghiệm ngang/dọc
         lbl.className = `flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition 
            ${isSelected ? 'border-brand-light bg-brand-light/5 shadow-sm' : 'border-slate-100 hover:border-brand-light/50 hover:bg-brand-pale'}`;
         lbl.innerHTML = `
           <div class="relative w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-brand-light' : 'border-slate-300'}">
             <div class="w-2 h-2 rounded-full bg-brand-light transition-transform duration-200 ${isSelected ? 'scale-100' : 'scale-0'}"></div>
           </div>
           <input type="radio" name="rd-q-${q.id}" class="hidden" value="${oIdx}" onchange="selectRdAns('${q.id}', this.value)" ${isSelected ? 'checked' : ''}>
           <span class="text-sm font-medium text-slate-700 leading-snug"><span class="mr-2 text-slate-400 font-bold">${letters[oIdx]}.</span>${escHtml(opt)}</span>
         `;
      }
      optsDiv.appendChild(lbl);
    });
    
    d.appendChild(optsDiv);
    c.appendChild(d);
  });
  
  const startQ = rdGroups.slice(0, index).reduce((acc, g) => acc + g.qs.length, 0) + 1;
  const endQ = startQ + group.qs.length - 1;
  $('rd-question-range').textContent = `QUESTIONS ${startQ}-${endQ}`;
  
  const btnPrev = $('rd-btn-prev');
  const btnNext = $('rd-btn-next');
  if(btnPrev) btnPrev.disabled = index === 0;
  if(btnNext) btnNext.disabled = index === rdGroups.length - 1;
}

window.navReading = function(dir) {
  renderReadingGroup(rdCurrentGroupIndex + dir);
  $('reading-questions-container').parentElement.scrollTop = 0;
};

window.selectRdAns = function(qId, val) {
  examState.answers.reading[qId] = Number(val);
  updateProgress();
  // We do not re-render the whole group here to preserve scroll position, 
  // but we can update classes directly via DOM if we want, or just re-render.
  // Actually, re-rendering might lose scroll or focus. 
  // Let's just re-render because it is fast and simple.
  renderReadingGroup(rdCurrentGroupIndex);
};

// ── WRITING (CEFR 6 levels) ────────────────────────────────
// ── WRITING (auto-scorable types) ──────────────────────────

function buildWriting(questions){
  const c=$('writing-questions');c.innerHTML='';
  if(!questions||questions.length===0){
    c.innerHTML='<div class="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 text-sm text-yellow-800">Không có câu hỏi writing.</div>';
    return;
  }
  questions.forEach((q,i)=>{
    const card=document.createElement('div');
    card.className='bg-white border-2 border-gray-200 rounded-2xl p-6 mb-4 transition-colors';
    card.id=`qcard-writing-${q.id}`;

    let contentHtml='';
    switch(q.type){
      case 'fill_blank': contentHtml=renderFillBlank(q,i,questions.length); break;
      case 'error_correction': contentHtml=renderErrorCorrection(q,i,questions.length); break;
      case 'sentence_order': contentHtml=renderSentenceOrder(q,i,questions.length); break;
      case 'sentence_transform': contentHtml=renderSentenceTransform(q,i,questions.length); break;
      default: contentHtml=renderFreeWrite(q,i,questions.length); break;
    }
    card.innerHTML=contentHtml;
    c.appendChild(card);

    // Attach event listeners after DOM insert
    if(q.type==='fill_blank') attachFillBlankEvents(q);
    else if(q.type==='error_correction') attachErrorCorrectionEvents(q);
    else if(q.type==='sentence_order') attachSentenceOrderEvents(q);
    else if(q.type==='sentence_transform') attachSentenceTransformEvents(q);
    else attachFreeWriteEvents(q);
  });
}

function renderHeader(q,i,total){
  return `<div class="flex items-center gap-2 mb-3 flex-wrap">
    <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Câu ${i+1}/${total}</span>
    ${q.level?`<span class="bg-blue-50 text-brand text-[10px] font-bold px-2 py-0.5 rounded-full">${escHtml(q.level)}</span>`:''}
    ${q.topic?`<span class="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full">📌 ${escHtml(q.topic)}</span>`:''}
    <span class="bg-indigo-50 text-indigo-600 text-[10px] font-bold px-2 py-0.5 rounded-full">${typeLabel(q.type)}</span>
  </div>`;
}
function typeLabel(t){
  const map={fill_blank:'Điền từ',error_correction:'Sửa lỗi',sentence_order:'Sắp xếp câu',sentence_transform:'Viết lại câu'};
  return map[t]||'Viết';
}

// ── Fill Blank ─────────────────────────────────────────────
function renderFillBlank(q,i,total){
  const passage=q.passage||'';
  // Replace ___N___ with input fields
  let html=escHtml(passage).replace(/___(\d+)___/g,(m,n)=>
    `<input type="text" id="fb-${q.id}-${n}" data-qid="${q.id}" data-blank="${n}" class="inline-block w-28 px-2 py-1 mx-1 border-b-2 border-brand-light bg-blue-50 rounded text-sm font-bold text-brand text-center focus:outline-none focus:border-brand focus:bg-white transition" placeholder="(${n})">`
  );
  const shuffledOptions = q.options ? [...q.options].sort(() => Math.random() - 0.5) : null;
  const wordBank=shuffledOptions?`<div class="flex flex-wrap gap-2 mt-3">${shuffledOptions.map(w=>`<span class="bg-gray-100 border border-gray-200 px-3 py-1 rounded-full text-xs font-semibold text-gray-700 cursor-default select-none">${escHtml(w)}</span>`).join('')}</div>`:'';
  return `${renderHeader(q,i,total)}
    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-3 text-sm text-blue-900 font-medium">${escHtml(q.instruction||'Điền từ thích hợp vào chỗ trống.')}</div>
    <div class="bg-white border border-gray-200 rounded-xl p-4 text-sm leading-loose whitespace-pre-wrap">${html}</div>
    ${wordBank}`;
}
function attachFillBlankEvents(q){
  const blanks=Object.keys(q.blanks||{});
  blanks.forEach(n=>{
    const input=$(`fb-${q.id}-${n}`);
    if(input)input.addEventListener('input',()=>{
      if(!examState.answers.writing[q.id])examState.answers.writing[q.id]={};
      examState.answers.writing[q.id][n]=input.value;
      updateProgress();
      checkWritingAnswered(q.id,blanks.length);
    });
  });
}

// ── Error Correction ───────────────────────────────────────
function renderErrorCorrection(q,i,total){
  const sentences=(q.sentences||[]).map((s,si)=>{
    const shuffledOpts = s.options.map((opt, oi) => ({ opt, oi })).sort(() => Math.random() - 0.5);
    const opts = shuffledOpts.map(({ opt, oi }) =>
      `<label class="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition" id="ec-${q.id}-${si}-${oi}">
        <input type="radio" name="ec-${q.id}-${si}" value="${oi}" class="accent-blue-600">
        <span class="text-sm">${escHtml(opt)}</span>
      </label>`
    ).join('');
    return `<div class="mb-4 p-4 bg-gray-50 rounded-xl">
      <div class="text-sm text-red-600 font-medium mb-2 line-through">${escHtml(s.original)}</div>
      <div class="space-y-2">${opts}</div>
    </div>`;
  }).join('');
  return `${renderHeader(q,i,total)}
    <div class="bg-red-50 border border-red-200 rounded-xl p-4 mb-3 text-sm text-red-800 font-medium">${escHtml(q.instruction||'Mỗi câu có MỘT lỗi sai. Chọn câu đúng.')}</div>
    ${sentences}`;
}
function attachErrorCorrectionEvents(q){
  (q.sentences||[]).forEach((s,si)=>{
    s.options.forEach((opt,oi)=>{
      const label=$(`ec-${q.id}-${si}-${oi}`);
      if(label)label.querySelector('input').addEventListener('change',()=>{
        if(!examState.answers.writing[q.id])examState.answers.writing[q.id]={};
        examState.answers.writing[q.id][String(si)]=oi;
        updateProgress();
        checkWritingAnswered(q.id,q.sentences.length);
      });
    });
  });
}

// ── Sentence Order ─────────────────────────────────────────
function renderSentenceOrder(q,i,total){
  const items=(q.sentences||[]).map((s,si)=>
    `<div class="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-move select-none" draggable="true" data-idx="${si}" id="so-${q.id}-${si}">
      <span class="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold flex-shrink-0 so-num">${si+1}</span>
      <span class="text-sm">${escHtml(s)}</span>
    </div>`
  ).join('');
  return `${renderHeader(q,i,total)}
    <div class="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-3 text-sm text-purple-800 font-medium">${escHtml(q.instruction||'Sắp xếp các câu theo đúng thứ tự.')}</div>
    <div class="space-y-2" id="so-container-${q.id}">${items}</div>
    <div class="text-xs text-gray-400 mt-2">💡 Kéo thả hoặc click số thứ tự để sắp xếp</div>`;
}
function attachSentenceOrderEvents(q){
  const container=$(`so-container-${q.id}`);
  if(!container)return;
  let dragEl=null;
  container.querySelectorAll('[draggable]').forEach(el=>{
    el.addEventListener('dragstart',e=>{dragEl=el;el.classList.add('opacity-50');});
    el.addEventListener('dragend',()=>{dragEl.classList.remove('opacity-50');dragEl=null;});
    el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('border-brand');});
    el.addEventListener('dragleave',()=>{el.classList.remove('border-brand');});
    el.addEventListener('drop',e=>{
      e.preventDefault();el.classList.remove('border-brand');
      if(dragEl&&dragEl!==el){container.insertBefore(dragEl,el);}
      updateSentenceOrder(q);
    });
  });
  // Also allow click-to-swap
  let firstClick=null;
  container.querySelectorAll('.so-num').forEach(num=>{
    num.style.cursor='pointer';
    num.addEventListener('click',()=>{
      const item=num.closest('[draggable]');
      if(!firstClick){firstClick=item;num.classList.add('ring-2','ring-brand');}
      else{
        const parent=container;
        const items=[...parent.children];
        const i1=items.indexOf(firstClick),i2=items.indexOf(item);
        if(i1!==i2){
          const ref=items[i2].nextSibling;
          parent.insertBefore(items[i2],items[i1]);
          parent.insertBefore(firstClick,ref);
        }
        firstClick.querySelector('.so-num').classList.remove('ring-2','ring-brand');
        firstClick=null;
        updateSentenceOrder(q);
      }
    });
  });
}
function updateSentenceOrder(q){
  const container=$(`so-container-${q.id}`);
  const items=[...container.children];
  const order=items.map(el=>parseInt(el.dataset.idx));
  examState.answers.writing[q.id]=order;
  // Update visual numbers
  items.forEach((el,i)=>{el.querySelector('.so-num').textContent=i+1;});
  updateProgress();
  const card=$('qcard-writing-'+q.id);
  if(card)card.classList.add('card-answered');
}

// ── Sentence Transform ─────────────────────────────────────
function renderSentenceTransform(q,i,total){
  const items=(q.sentences||[]).map((s,si)=>
    `<div class="mb-4 p-4 bg-gray-50 rounded-xl">
      <div class="text-sm text-gray-700 mb-2">${escHtml(s.original)}</div>
      <div class="text-xs text-brand font-bold mb-2">Viết lại dùng: <span class="bg-brand text-white px-2 py-0.5 rounded">${escHtml(s.keyword)}</span></div>
      <input type="text" id="st-${q.id}-${si}" class="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-brand-light focus:ring-2 focus:ring-blue-100 transition" placeholder="Viết lại câu ở đây…">
    </div>`
  ).join('');
  return `${renderHeader(q,i,total)}
    <div class="bg-green-50 border border-green-200 rounded-xl p-4 mb-3 text-sm text-green-800 font-medium">${escHtml(q.instruction||'Viết lại câu sử dụng từ cho sẵn. Nghĩa không đổi.')}</div>
    ${items}`;
}
function attachSentenceTransformEvents(q){
  (q.sentences||[]).forEach((s,si)=>{
    const input=$(`st-${q.id}-${si}`);
    if(input)input.addEventListener('input',()=>{
      if(!examState.answers.writing[q.id])examState.answers.writing[q.id]={};
      examState.answers.writing[q.id][String(si)]=input.value;
      updateProgress();
      checkWritingAnswered(q.id,q.sentences.length);
    });
  });
}

// ── Free Write (legacy fallback) ───────────────────────────
function renderFreeWrite(q,i,total){
  const minWords=q.minWords||50;
  return `${renderHeader(q,i,total)}
    <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm text-amber-900 leading-relaxed font-medium">${escHtml(q.prompt||q.instruction||'')}</div>
    <textarea id="wans-${q.id}" class="writing-textarea w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm leading-relaxed resize-y min-h-[140px] focus:outline-none focus:border-brand-light focus:ring-2 focus:ring-blue-100 transition" placeholder="Viết câu trả lời bằng tiếng Anh…" rows="6"></textarea>
    <div class="text-xs text-gray-400 font-semibold text-right mt-1" id="wc-${q.id}">0 / ${minWords} từ</div>`;
}

function attachFreeWriteEvents(q){
  const ta = $(`wans-${q.id}`);
  if(ta) {
    ta.addEventListener('input', () => {
      const val = ta.value.trim();
      const wordCount = val ? val.split(/\s+/).filter(Boolean).length : 0;
      const minWords = q.minWords || 50;
      const wcEl = $(`wc-${q.id}`);
      if(wcEl) wcEl.textContent = `${wordCount} / ${minWords} từ`;
      
      examState.answers.writing[q.id] = val;
      updateProgress();
      
      const card = $(`qcard-writing-${q.id}`);
      if(card) card.classList.toggle('card-answered', wordCount > 0);
    });
  }
}

function checkWritingAnswered(qId,expectedCount){
  const ans=examState.answers.writing[qId];
  const card=$('qcard-writing-'+qId);
  if(!card||!ans)return;
  const filled=typeof ans==='object'?Object.keys(ans).filter(k=>ans[k]!==undefined&&ans[k]!=='').length:0;
  card.classList.toggle('card-answered',filled>0);
}

// ── SPEAKING ───────────────────────────────────────────────
function buildSpeaking(questions){
  const c=$('speaking-questions');if(!c)return;
  c.innerHTML='';
  questions.forEach((q,i)=>{
    const card=document.createElement('div');
    card.className='bg-white border-2 border-gray-200 rounded-2xl p-6 mb-4';
    card.id=`qcard-speaking-${q.id}`;
    card.innerHTML=`
      <div class="flex items-center gap-2 mb-3 flex-wrap">
        <span class="bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full">Part ${q.part||i+1}</span>
        <span class="bg-blue-50 text-brand text-[10px] font-bold px-2 py-0.5 rounded-full">${escHtml(q.level||'')}</span>
        <span class="text-xs text-gray-400">${escHtml(q.topic||'')}</span>
      </div>
      <div class="bg-green-50 border border-green-200 rounded-xl p-4 mb-2">
        <div class="text-sm font-bold text-green-900 mb-1">${escHtml(q.prompt||'')}</div>
        ${q.prompt_vi?`<div class="text-xs text-green-700 mt-1">${escHtml(q.prompt_vi)}</div>`:''}
      </div>
      ${q.hints&&q.hints.length?`<div class="flex gap-2 mb-3 flex-wrap">${q.hints.map(h=>`<span class="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">💡 ${escHtml(h)}</span>`).join('')}</div>`:''}
      <div class="flex items-center gap-3 mb-3">
        <span class="text-xs text-gray-400">⏱ Chuẩn bị: ${q.prepTime||30}s · Nói: ${q.speakTime||60}s</span>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button id="speak-btn-${q.id}"
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white transition"
          style="background:#059669">🎤 Bắt đầu nói</button>
        <button id="stop-btn-${q.id}" disabled
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-red-500 disabled:opacity-40">⏹ Dừng</button>
      </div>
      <div id="speak-status-${q.id}" class="mt-3 text-xs text-gray-400"></div>
      <div id="speak-transcript-${q.id}" class="mt-2 bg-gray-50 rounded-xl p-3 text-xs text-gray-600 hidden min-h-[60px]"></div>
      <div id="speak-grade-${q.id}" class="mt-3 hidden"></div>`;
    c.appendChild(card);

    const speakBtn = card.querySelector(`#speak-btn-${q.id}`);
    const stopBtn = card.querySelector(`#stop-btn-${q.id}`);
    if (speakBtn) speakBtn.addEventListener('click', () => startSpeaking(q.id));
    if (stopBtn) stopBtn.addEventListener('click', () => stopSpeaking(q.id));
  });
}

// Web Speech API
const _recognition={};
function startSpeaking(qId){
  if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)){
    alert('Trình duyệt không hỗ trợ Speech Recognition. Vui lòng dùng Chrome.');return;
  }
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const rec=new SpeechRecognition();
  rec.lang='en-US';rec.continuous=true;rec.interimResults=true;
  _recognition[qId]=rec;

  const statusEl=$('speak-status-'+qId),transcriptEl=$('speak-transcript-'+qId);
  const startBtn=$('speak-btn-'+qId),stopBtn=$('stop-btn-'+qId);
  startBtn.disabled=true;stopBtn.disabled=false;
  statusEl.textContent='🔴 Đang ghi âm… Hãy nói bằng tiếng Anh';
  statusEl.className='mt-3 text-xs text-red-600 font-semibold animate-pulse';
  transcriptEl.classList.remove('hidden');transcriptEl.textContent='';

  let finalTranscript='';
  rec.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal)finalTranscript+=e.results[i][0].transcript+' ';
      else interim+=e.results[i][0].transcript;
    }
    transcriptEl.textContent=finalTranscript+interim;
  };
  rec.onerror=e=>{statusEl.textContent='❌ Lỗi: '+e.error;statusEl.className='mt-3 text-xs text-red-500';};
  rec.onend=()=>{
    startBtn.disabled=false;stopBtn.disabled=true;
    statusEl.textContent='✅ Đã ghi xong';statusEl.className='mt-3 text-xs text-green-600 font-semibold';
    const transcript=finalTranscript.trim();
    if(transcript){
      examState.answers.speaking[qId]=transcript;
      updateProgress();
      const card=$('qcard-speaking-'+qId);
      if(card)card.classList.add('card-answered');
      // Auto grade with AI
      const q=examState.speakingQuestions.find(q=>q.id===qId);
      if(q)gradeSpeakingWithAI(qId,q,transcript);
    }
  };
  rec.start();
}

function stopSpeaking(qId){
  if(_recognition[qId])_recognition[qId].stop();
}

async function gradeSpeakingWithAI(qId,q,transcript){
  const gradeEl=$('speak-grade-'+qId);
  if(!gradeEl)return;
  gradeEl.innerHTML='<div class="text-xs text-purple-600 animate-pulse">🤖 AI đang đánh giá…</div>';
  gradeEl.classList.remove('hidden');
  try{
    const r=await apiPost('/api/ai/grade-speaking',{
      token:examState.token,questionId:qId,transcript,
      prompt:q.prompt,level:q.level||examState.cefrLevel,
    });
    const g=r.grade||{};
    examState.speakingGrades[qId]=g;
    const color=g.score>=7?'emerald':g.score>=5?'amber':'red';
    gradeEl.innerHTML=`
      <div class="bg-purple-50 border border-purple-200 rounded-xl p-3">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-lg font-black text-purple-700">${g.score}/10</span>
          <span class="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded-full">${g.band||'—'}</span>
          <span class="text-xs text-gray-400">AI Assessment</span>
        </div>
        ${g.feedback_vi?`<p class="text-xs text-purple-800 leading-relaxed">${escHtml(g.feedback_vi)}</p>`:''}
        ${g.feedback_en?`<p class="text-xs text-gray-500 mt-1 italic">${escHtml(g.feedback_en)}</p>`:''}
      </div>`;
    updateProgress();
  }catch(e){
    gradeEl.innerHTML=`<div class="text-xs text-red-500">AI chấm thất bại: ${escHtml(e.message)}</div>`;
  }
}

// ── MCQ Card ───────────────────────────────────────────────
function buildMCQCard(q,num,track){
  const card=document.createElement('div');
  card.className='bg-white/70 backdrop-blur-md border border-white/40 rounded-2xl p-6 mb-4 shadow-sm transition-colors no-select';
  card.id=`qcard-${track}-${q.id}`;
  const letters=['A','B','C','D','E'];
  const opts=(q.options||[]).map((opt,i)=>`
    <div class="option flex items-center gap-3 px-4 py-3 border-2 border-gray-100 rounded-xl cursor-pointer transition-all hover:border-brand-light hover:bg-brand-pale select-none"
         id="opt-${q.id}-${i}">
      <span class="opt-letter w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">${letters[i]}</span>
      <span class="text-sm text-gray-750 font-medium">${escHtml(opt)}</span>
    </div>`).join('');
  card.innerHTML=`
    <div class="flex items-center gap-2 mb-3">
      <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Câu ${num}</span>
      ${q.level?`<span class="bg-brand-pale text-brand text-[10px] font-bold px-2 py-0.5 rounded-full">${escHtml(q.level)}</span>`:''}
    </div>
    <div class="text-sm font-bold text-gray-800 mb-4 leading-relaxed">${escHtml(q.question||'')}</div>
    <div class="space-y-2">${opts}</div>`;

  (q.options||[]).forEach((_,i)=>{
    const el = card.querySelector(`#opt-${q.id}-${i}`);
    if (el) el.addEventListener('click', () => selectOption(q.id, i, track));
  });

  return card;
}

function selectOption(qId,idx,track){
  const q=examState.questions[track].find(q=>q.id===qId);if(!q)return;
  (q.options||[]).forEach((_,i)=>{
    const el=$(`opt-${qId}-${i}`);if(!el)return;
    if(i===idx){el.classList.add('option-selected');el.classList.remove('border-gray-200');}
    else{el.classList.remove('option-selected');el.classList.add('border-gray-200');}
  });
  examState.answers[track][qId]=idx;
  updateProgress();
  const card=$(`qcard-${track}-${qId}`);
  if(card)card.classList.add('card-answered');
}

// ── Progress ───────────────────────────────────────────────
function updateProgress(){
  ['listening','reading','writing'].forEach(track=>{
    const qs=examState.questions?.[track]||[];
    let answered=0;
    if(track==='writing'){
      answered=qs.filter(q=>{
        const v=examState.answers.writing[q.id];
        if(!v)return false;
        if(typeof v==='string')return v.trim().length>0;
        if(Array.isArray(v))return v.length>0;
        if(typeof v==='object')return Object.keys(v).some(k=>v[k]!==undefined&&v[k]!=='');
        return false;
      }).length;
    }
    else answered=qs.filter(q=>examState.answers[track][q.id]!==undefined).length;
    const el=$('prog-'+track);
    if(el)el.textContent=`${answered}/${qs.length}`;
  });
}

// ── Track switching ────────────────────────────────────────
function switchTrack(track){
  examState.currentTrack=track;
  document.querySelectorAll('.track').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>{
    const active=t.dataset.track===track;
    t.classList.toggle('tab-active',active);
    t.classList.toggle('text-gray-500',!active);
    t.classList.toggle('border-gray-200',!active);
    const prog=t.querySelector('span');
    if(prog)prog.className=active?'bg-white/30 rounded-full px-2 py-0.5 text-[10px]':'bg-gray-100 rounded-full px-2 py-0.5 text-[10px] text-gray-500';
  });
  $('track-'+track).classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
}

// ── Speaking Test ──────────────────────────────────────────
function openSpeakingTest(){
  if(!examState.token){alert('Bài thi chưa bắt đầu.');return;}
  // Store token for speaking page to use
  localStorage.setItem('exam_token',examState.token);
  window.open('/speaking/','_blank','width=800,height=700');
}

// ── Submit ─────────────────────────────────────────────────
function confirmSubmit(){
  if(examState.submitted)return;
  const qs=examState.questions;let u=0;
  ['listening','reading'].forEach(t=>u+=(qs[t]||[]).filter(q=>examState.answers[t][q.id]===undefined).length);
  u+=(qs.writing||[]).filter(q=>{
    const v=examState.answers.writing[q.id];
    if(!v)return true;
    if(typeof v==='string')return!v.trim();
    if(Array.isArray(v))return v.length===0;
    if(typeof v==='object')return Object.keys(v).filter(k=>v[k]!==undefined&&v[k]!=='').length===0;
    return true;
  }).length;
  $('submit-warn-text').textContent=u>0?`Bạn còn ${u} câu chưa trả lời. Xác nhận nộp bài?`:'Bạn đã trả lời tất cả. Xác nhận nộp bài?';
  $('submitModal').classList.remove('hidden');
}
function closeSubmitModal(){$('submitModal').classList.add('hidden');}
async function doSubmit(){if(examState.submitted)return;closeSubmitModal();await submitExam();}
async function autoSubmit(){if(examState.submitted)return;await submitExam(true);}

async function submitExam(isAuto=false){
  if(examState.submitted)return;
  examState.submitted=true;
  localStorage.removeItem('exam_token'); // Clean up from localStorage
  clearInterval(examState.timerInterval);
  showLoading(isAuto?'Hết giờ — đang nộp bài…':'Đang nộp bài…');
  try{
    const result=await apiPost('/api/exam/submit',{
      token:examState.token,answers:examState.answers,
      cheatEvents:examState.cheatEvents,
    });
    hideLoading();showResult(result);
  }catch(err){
    hideLoading();
    if(err.message.includes('already_submitted'))showResultFallback();
    else alert('Lỗi khi nộp bài: '+err.message+'\nVui lòng liên hệ HR.');
  }
}

// ── Result ─────────────────────────────────────────────────
function showResult(data){
  showScreen('result');
}
function setBar(k,v){}
function showResultFallback(){
  showScreen('result');
}

// ── Theme management ───────────────────────────────────────
function toggleTheme(){
  const isDark=document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme',isDark?'dark':'light');
  updateThemeUI();
}
function updateThemeUI(){
  const isDark=document.documentElement.classList.contains('dark');
  const btn=document.getElementById('themeToggleBtn');
  if(btn){
    btn.innerHTML=isDark?'☀️':'🌙';
  }
}
