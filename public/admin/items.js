// Item bank browser + editor.
// All writes go through /admin/api/items/:bank/:track/:id and reload the
// in-memory bank cache server-side, so changes take effect on the next exam.

const ui = {
  bank: 'BANK_STAFF',
  track: 'listening',
  level: '',
  search: '',
  editingId: null, // null = new item
};

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

async function api(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = opts.headers || {};
  if (['POST', 'PUT', 'DELETE'].includes(method)) {
    const csrfToken = getCookie('admin_csrf');
    if (csrfToken) {
      headers['X-Admin-CSRF'] = csrfToken;
    }
  }
  const r = await fetch(url, { credentials: 'include', ...opts, headers });
  if (r.status === 401) { location.href = '/admin/login.html'; throw new Error('unauthorized'); }
  if (!r.ok) {
    let j; try { j = await r.json(); } catch { j = { error: r.statusText }; }
    throw new Error(j.message || j.error || r.statusText);
  }
  if (r.status === 204) return null;
  return r.json();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const me = await api('/admin/api/me');
    document.getElementById('userBadge').textContent = me.displayName || me.username;
    bindFilters();
    await loadSummary();
    await loadPendingBadge();
    await loadItems();
  } catch (err) {
    console.error(err);
  }
})();

function bindFilters() {
  document.getElementById('fBank').addEventListener('change', (e) => {
    ui.bank = e.target.value; loadItems();
  });
  document.getElementById('fTrack').addEventListener('change', (e) => {
    ui.track = e.target.value; loadItems();
  });
  document.getElementById('fLevel').addEventListener('change', (e) => {
    ui.level = e.target.value; loadItems();
  });
  let dt = null;
  document.getElementById('fSearch').addEventListener('input', (e) => {
    clearTimeout(dt);
    ui.search = e.target.value;
    dt = setTimeout(loadItems, 250);
  });
}

async function loadSummary() {
  try {
    const { summary } = await api('/admin/api/items');
    const html = Object.entries(summary).map(([bank, tracks]) => `
      <div class="bank-summary-row">
        <div class="bank-summary-name">${escapeHtml(bank)}</div>
        ${Object.entries(tracks).map(([t, n]) => `
          <span class="bank-summary-cell ${n < 10 ? 'warn' : ''}">${t}: <strong>${n}</strong>${n < 10 ? ' ⚠' : ''}</span>
        `).join('')}
      </div>
    `).join('');
    document.getElementById('bankSummary').innerHTML = html;
  } catch (err) {
    document.getElementById('bankSummary').innerHTML = `<div class="error">Không tải được tổng quan: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadPendingBadge() {
  try {
    const { total } = await api('/admin/api/pending-review?limit=1');
    const badge = document.getElementById('navPendingBadge');
    if (total > 0) {
      badge.textContent = total;
      badge.hidden = false;
    }
  } catch {}
}

async function loadItems() {
  const tbody = document.getElementById('itemRows');
  tbody.innerHTML = `<tr><td colspan="5" class="loading">Đang tải…</td></tr>`;
  try {
    const params = new URLSearchParams({ bank: ui.bank, track: ui.track });
    if (ui.level)  params.set('level', ui.level);
    if (ui.search) params.set('q', ui.search);
    const { items } = await api(`/admin/api/items?${params}`);
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Không có câu hỏi nào.</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(rowHtml).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="error">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function rowHtml(it) {
  let preview = '';
  if (ui.track === 'listening') preview = `🎧 ${escapeHtml(it.audioFile)} · ${escapeHtml(truncate(it.question, 100))}`;
  else if (ui.track === 'reading') preview = escapeHtml(truncate(it.question, 100));
  else preview = escapeHtml(truncate(it.prompt, 120));

  const pending = it.audioPending
    ? `<span class="pill pill-warn">audio cần ghi</span>` : '';
  return `
    <tr>
      <td><code>${escapeHtml(it.id)}</code></td>
      <td><span class="pill">${escapeHtml(it.level)}</span></td>
      <td>${escapeHtml(it.topic)}</td>
      <td>${preview} ${pending}</td>
      <td><button class="btn btn-ghost" onclick="openEditor('${escapeHtml(it.id)}')">Sửa</button></td>
    </tr>`;
}

// ── Editor ──────────────────────────────────────────────────────────────────

async function openEditor(id) {
  ui.editingId = id;
  let item = null;
  if (id) {
    try {
      const r = await api(`/admin/api/items/${ui.bank}/${ui.track}/${encodeURIComponent(id)}`);
      item = r.item;
    } catch (err) {
      alert('Không tải được câu hỏi: ' + err.message);
      return;
    }
  }
  document.getElementById('editorTitle').textContent = id ? `Sửa ${id}` : `Thêm câu hỏi mới (${ui.track})`;
  document.getElementById('btnDelete').hidden = !id;
  renderEditor(item);
  document.getElementById('editorModal').classList.add('show');
}

function closeEditor() {
  document.getElementById('editorModal').classList.remove('show');
  ui.editingId = null;
}

function renderEditor(item) {
  const c = document.getElementById('editorContent');
  if (ui.track === 'listening') c.innerHTML = listeningForm(item);
  else if (ui.track === 'reading') c.innerHTML = readingForm(item);
  else c.innerHTML = writingForm(item);
}

function fld(label, html, hint = '') {
  return `<label class="fld">
    <div class="fld-label">${escapeHtml(label)}${hint ? `<span class="fld-hint">${escapeHtml(hint)}</span>` : ''}</div>
    ${html}
  </label>`;
}

function levelSelect(value, id = 'f-level') {
  const opts = ['A2','B1','B2','C1','C2']
    .map((l) => `<option ${value === l ? 'selected' : ''}>${l}</option>`).join('');
  return `<select id="${id}">${opts}</select>`;
}

function listeningForm(item) {
  item = item || { options: ['','','',''], correct: 0 };
  return `
    ${fld('ID', `<input id="f-id" value="${escapeHtml(item.id || '')}" ${item.id ? 'readonly' : 'placeholder="để trống để tự sinh"'} />`)}
    <div class="grid-2">
      ${fld('Cấp CEFR', levelSelect(item.level || 'A2'))}
      ${fld('Audio file', `<input id="f-audioFile" value="${escapeHtml(item.audioFile || '')}" placeholder="L1c, OM_L6, ..." />`,
        'Tên file trong public/audio/ (không gồm .mp3)')}
    </div>
    ${fld('Chủ đề (topic)', `<input id="f-topic" value="${escapeHtml(item.topic || '')}" />`)}
    ${fld('Mô tả audio (1 câu cho thí sinh)', `<textarea id="f-audio" rows="2">${escapeHtml(item.audio || '')}</textarea>`)}
    ${fld('Transcript đầy đủ', `<textarea id="f-transcript" rows="6">${escapeHtml(item.transcript || '')}</textarea>`)}
    ${fld('Câu hỏi', `<input id="f-question" value="${escapeHtml(item.question || '')}" />`)}
    ${optionsForm(item)}
    <label class="fld fld-check">
      <input type="checkbox" id="f-audioPending" ${item.audioPending ? 'checked' : ''} />
      Cần ghi audio (audioPending)
    </label>
  `;
}

function readingForm(item) {
  item = item || { options: ['','','',''], correct: 0 };
  return `
    ${fld('ID', `<input id="f-id" value="${escapeHtml(item.id || '')}" ${item.id ? 'readonly' : 'placeholder="để trống để tự sinh"'} />`)}
    <div class="grid-2">
      ${fld('Cấp CEFR', levelSelect(item.level || 'B1'))}
      ${fld('Chủ đề (topic)', `<input id="f-topic" value="${escapeHtml(item.topic || '')}" />`)}
    </div>
    ${fld('Đoạn văn (HTML cho phép)', `<textarea id="f-passage" rows="8">${escapeHtml(item.passage || '')}</textarea>`)}
    ${fld('Câu hỏi', `<input id="f-question" value="${escapeHtml(item.question || '')}" />`)}
    ${optionsForm(item)}
  `;
}

function optionsForm(item) {
  return `<div class="fld">
    <div class="fld-label">Lựa chọn (chọn đáp án đúng)</div>
    ${[0,1,2,3].map((i) => `
      <label class="opt-row">
        <input type="radio" name="f-correct" value="${i}" ${item.correct === i ? 'checked' : ''} />
        <input id="f-opt-${i}" value="${escapeHtml((item.options && item.options[i]) || '')}" />
      </label>
    `).join('')}
  </div>`;
}

function writingForm(item) {
  item = item || {
    minWords: 50, maxWords: 100,
    rubric: { criteria: defaultRubric('B1') },
  };
  return `
    ${fld('ID', `<input id="f-id" value="${escapeHtml(item.id || '')}" ${item.id ? 'readonly' : 'placeholder="để trống để tự sinh"'} />`)}
    <div class="grid-2">
      ${fld('Cấp CEFR', levelSelect(item.level || 'B1') + ` <button type="button" class="btn btn-ghost btn-sm" onclick="loadDefaultRubric()">Áp rubric mặc định theo cấp</button>`)}
      ${fld('Chủ đề (topic)', `<input id="f-topic" value="${escapeHtml(item.topic || '')}" />`)}
    </div>
    ${fld('Prompt cho thí sinh', `<textarea id="f-prompt" rows="5">${escapeHtml(item.prompt || '')}</textarea>`)}
    <div class="grid-2">
      ${fld('Min words', `<input type="number" id="f-minWords" value="${item.minWords ?? 50}" min="10" />`)}
      ${fld('Max words', `<input type="number" id="f-maxWords" value="${item.maxWords ?? 100}" min="20" />`)}
    </div>
    <div class="fld">
      <div class="fld-label">Rubric — các tiêu chí (tổng trọng số = 1.0)</div>
      <div id="rubric-list">${rubricRowsHtml(item.rubric?.criteria || defaultRubric(item.level || 'B1'))}</div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="addRubricRow()">+ Thêm tiêu chí</button>
      <div id="rubric-weight-sum" class="fld-hint"></div>
    </div>
  `;
}

function rubricRowsHtml(criteria) {
  return criteria.map((c, i) => rubricRowHtml(c, i)).join('');
}
function rubricRowHtml(c, i) {
  return `
    <div class="rubric-row" data-i="${i}">
      <input class="r-name" placeholder="Tên tiêu chí" value="${escapeHtml(c.name || '')}" />
      <input class="r-weight" type="number" step="0.05" min="0" max="1" value="${c.weight ?? 0.25}" />
      <input class="r-desc" placeholder="Mô tả ngắn (chấm theo cái gì)" value="${escapeHtml(c.description || '')}" />
      <button type="button" class="btn btn-ghost btn-sm" onclick="removeRubricRow(${i})">✕</button>
    </div>`;
}
function defaultRubric(level) {
  const presets = {
    A2: [
      { name: 'Task completion',  weight: 0.40, description: 'Đủ thông tin yêu cầu; trả lời đúng prompt.' },
      { name: 'Grammar accuracy', weight: 0.30, description: 'Thì, mạo từ, số nhiều ở mức A2.' },
      { name: 'Vocabulary',       weight: 0.20, description: 'Từ vựng hospitality cơ bản, không sai gây hiểu nhầm.' },
      { name: 'Tone & format',    weight: 0.10, description: 'Lịch sự, giọng phục vụ khách.' },
    ],
    B1: [
      { name: 'Task completion',  weight: 0.35, description: 'Đủ mọi điểm yêu cầu.' },
      { name: 'Grammar accuracy', weight: 0.30, description: 'Connectors, modal, prepositions ở mức B1.' },
      { name: 'Vocabulary',       weight: 0.20, description: 'Cụm hospitality / customer service phù hợp.' },
      { name: 'Tone & coherence', weight: 0.15, description: 'Mạch lạc, giọng chuyên nghiệp.' },
    ],
    B2: [
      { name: 'Task completion',  weight: 0.30, description: 'Xử lý đầy đủ tình huống có sắc thái.' },
      { name: 'Grammar accuracy', weight: 0.30, description: 'Câu phức, điều kiện, bị động ở mức B2.' },
      { name: 'Vocabulary',       weight: 0.20, description: 'Từ vựng business chính xác.' },
      { name: 'Tone & coherence', weight: 0.20, description: 'Giọng ngoại giao, tổ chức rõ ràng.' },
    ],
    C1: [
      { name: 'Task completion',     weight: 0.30, description: 'Xử lý phân tích/thuyết phục đầy đủ.' },
      { name: 'Grammar & syntax',    weight: 0.25, description: 'Đa dạng cấu trúc, ít lỗi.' },
      { name: 'Vocabulary precision',weight: 0.25, description: 'Từ vựng quản trị chính xác.' },
      { name: 'Argument & cohesion', weight: 0.20, description: 'Lập luận có hệ thống, giọng executive.' },
    ],
    C2: [
      { name: 'Task completion',     weight: 0.25, description: 'Communication cấp executive với khung chiến lược.' },
      { name: 'Grammar & syntax',    weight: 0.25, description: 'Làm chủ cú pháp phức tạp.' },
      { name: 'Vocabulary precision',weight: 0.25, description: 'Từ vựng board-level, idiomatic.' },
      { name: 'Argument & rhetoric', weight: 0.25, description: 'Lập luận tinh tế, persuasive cân bằng.' },
    ],
  };
  return presets[level] || presets.B1;
}
function loadDefaultRubric() {
  const level = document.getElementById('f-level').value;
  document.getElementById('rubric-list').innerHTML = rubricRowsHtml(defaultRubric(level));
  updateRubricSum();
}
function addRubricRow() {
  const list = document.getElementById('rubric-list');
  const i = list.children.length;
  list.insertAdjacentHTML('beforeend', rubricRowHtml({ name: '', weight: 0.1, description: '' }, i));
  updateRubricSum();
}
function removeRubricRow(i) {
  const list = document.getElementById('rubric-list');
  if (list.children.length <= 1) return;
  list.children[i].remove();
  // re-index data-i + remove button onclick handlers
  [...list.children].forEach((row, j) => {
    row.dataset.i = j;
    row.querySelector('.btn').setAttribute('onclick', `removeRubricRow(${j})`);
  });
  updateRubricSum();
}
function readRubric() {
  const rows = document.querySelectorAll('#rubric-list .rubric-row');
  return [...rows].map((row) => ({
    name: row.querySelector('.r-name').value.trim(),
    weight: Number(row.querySelector('.r-weight').value),
    description: row.querySelector('.r-desc').value.trim(),
  }));
}
function updateRubricSum() {
  const sum = readRubric().reduce((s, c) => s + (c.weight || 0), 0);
  const el = document.getElementById('rubric-weight-sum');
  if (!el) return;
  el.textContent = `Tổng trọng số hiện tại: ${sum.toFixed(2)} (phải = 1.00)`;
  el.style.color = Math.abs(sum - 1) < 0.01 ? '#10B981' : '#EF4444';
}
document.addEventListener('input', (e) => {
  if (e.target.closest && e.target.closest('#rubric-list')) updateRubricSum();
});

function readForm() {
  const id = document.getElementById('f-id').value.trim() || undefined;
  const level = document.getElementById('f-level').value;
  const topic = document.getElementById('f-topic').value.trim();
  if (ui.track === 'listening') {
    return {
      id, level, topic,
      audioFile: document.getElementById('f-audioFile').value.trim(),
      audio: document.getElementById('f-audio').value.trim(),
      transcript: document.getElementById('f-transcript').value.trim(),
      question: document.getElementById('f-question').value.trim(),
      options: [0,1,2,3].map((i) => document.getElementById(`f-opt-${i}`).value.trim()),
      correct: Number(document.querySelector('input[name="f-correct"]:checked').value),
      audioPending: document.getElementById('f-audioPending').checked,
    };
  }
  if (ui.track === 'reading') {
    return {
      id, level, topic,
      passage: document.getElementById('f-passage').value,
      question: document.getElementById('f-question').value.trim(),
      options: [0,1,2,3].map((i) => document.getElementById(`f-opt-${i}`).value.trim()),
      correct: Number(document.querySelector('input[name="f-correct"]:checked').value),
    };
  }
  return {
    id, level, topic,
    type: 'short_answer',
    prompt: document.getElementById('f-prompt').value.trim(),
    minWords: parseInt(document.getElementById('f-minWords').value, 10),
    maxWords: parseInt(document.getElementById('f-maxWords').value, 10),
    rubric: { criteria: readRubric() },
  };
}

async function saveItem() {
  const payload = readForm();
  try {
    const method = ui.editingId ? 'PUT' : 'POST';
    const url = ui.editingId
      ? `/admin/api/items/${ui.bank}/${ui.track}/${encodeURIComponent(ui.editingId)}`
      : `/admin/api/items/${ui.bank}/${ui.track}`;
    await api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeEditor();
    await loadItems();
    await loadSummary();
  } catch (err) {
    alert('Lưu thất bại: ' + err.message);
  }
}

async function deleteItem() {
  if (!ui.editingId) return;
  if (!confirm(`Xóa câu hỏi "${ui.editingId}"? Không thể hoàn tác.`)) return;
  try {
    await api(`/admin/api/items/${ui.bank}/${ui.track}/${encodeURIComponent(ui.editingId)}`, {
      method: 'DELETE',
    });
    closeEditor();
    await loadItems();
    await loadSummary();
  } catch (err) {
    alert('Xóa thất bại: ' + err.message);
  }
}

function previewItem() {
  const it = readForm();
  let html = '';
  if (ui.track === 'listening') {
    html = `<h4>${escapeHtml(it.topic)} (${it.level})</h4>
      <p><strong>🎧 Audio:</strong> ${escapeHtml(it.audio)}</p>
      <details><summary>Transcript</summary><p>${escapeHtml(it.transcript)}</p></details>
      <p><strong>${escapeHtml(it.question)}</strong></p>
      <ol type="A">${it.options.map((o, i) =>
        `<li ${i === it.correct ? 'style="font-weight:700;color:#10B981"' : ''}>${escapeHtml(o)}${i === it.correct ? ' ✓' : ''}</li>`
      ).join('')}</ol>`;
  } else if (ui.track === 'reading') {
    html = `<h4>${escapeHtml(it.topic)} (${it.level})</h4>
      <div class="preview-passage">${it.passage}</div>
      <p><strong>${escapeHtml(it.question)}</strong></p>
      <ol type="A">${it.options.map((o, i) =>
        `<li ${i === it.correct ? 'style="font-weight:700;color:#10B981"' : ''}>${escapeHtml(o)}${i === it.correct ? ' ✓' : ''}</li>`
      ).join('')}</ol>`;
  } else {
    html = `<h4>${escapeHtml(it.topic)} (${it.level})</h4>
      <p><strong>Prompt:</strong></p>
      <p>${escapeHtml(it.prompt)}</p>
      <p><em>${it.minWords}–${it.maxWords} từ.</em></p>
      <p><strong>Rubric:</strong></p>
      <ul>${it.rubric.criteria.map((c) =>
        `<li><strong>${escapeHtml(c.name)}</strong> (${Math.round(c.weight*100)}%) — ${escapeHtml(c.description)}</li>`
      ).join('')}</ul>`;
  }
  const popup = window.open('', 'preview', 'width=700,height=600');
  popup.document.write(`<!DOCTYPE html><html><head><title>Preview ${escapeHtml(it.id||'')}</title>
    <link rel="stylesheet" href="/admin/admin.css">
    <style>body{padding:24px;max-width:640px;margin:0 auto;font-family:'Be Vietnam Pro',sans-serif}
    h4{color:#1F4E79;margin-bottom:12px} ol{margin-left:24px;margin-top:8px} li{margin:4px 0}
    .preview-passage{background:#F9FAFB;padding:12px;border-radius:8px;margin:8px 0}
    details{margin:8px 0;background:#F9FAFB;padding:8px;border-radius:6px}
    summary{cursor:pointer;font-weight:600}
    </style></head><body>${html}</body></html>`);
  popup.document.close();
}

async function logout() {
  await api('/admin/api/logout', { method: 'POST' });
  location.href = '/admin/login.html';
}
