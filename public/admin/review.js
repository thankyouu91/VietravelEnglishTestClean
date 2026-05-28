// Pending-review queue.
// Server returns the writing items rehydrated with prompt + rubric so HR can
// assign 0–1.0 per item. We compute the writing track total client-side as a
// preview; the server recomputes on finalize and writes the final CEFR.

let current = null; // detail of the session currently being reviewed

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
function fmtDate(ts) { return ts ? new Date(ts).toLocaleString('vi-VN') : '—'; }

(async () => {
  try {
    const me = await api('/admin/api/me');
    document.getElementById('userBadge').textContent = me.displayName || me.username;
    await loadQueue();
  } catch (err) {
    console.error(err);
  }
})();

async function loadQueue() {
  const tbody = document.getElementById('pendingRows');
  tbody.innerHTML = `<tr><td colspan="7" class="loading">Đang tải…</td></tr>`;
  try {
    const { rows, total } = await api('/admin/api/pending-review?limit=100');
    const badge = document.getElementById('navPendingBadge');
    if (total > 0) { badge.textContent = total; badge.hidden = false; }
    else { badge.hidden = true; }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">Không có phiên nào chờ chấm.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td><code>${escapeHtml(r.exam_id)}</code></td>
        <td>${escapeHtml(r.candidate_name)}<div class="cell-sub">${escapeHtml(r.candidate_email)}</div></td>
        <td>${escapeHtml(r.position_label || '')}</td>
        <td>${fmtDate(r.submitted_at)}</td>
        <td class="num">${r.score_listening ?? '—'}</td>
        <td class="num">${r.score_reading ?? '—'}</td>
        <td><button class="btn btn-primary btn-sm" onclick="openReview('${escapeHtml(r.id)}')">Chấm</button></td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="error">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openReview(sessionId) {
  document.getElementById('reviewModal').classList.add('show');
  document.getElementById('reviewContent').innerHTML = '<div class="loading">Đang tải…</div>';
  try {
    current = await api(`/admin/api/pending-review/${encodeURIComponent(sessionId)}`);
    renderReview();
  } catch (err) {
    document.getElementById('reviewContent').innerHTML =
      `<div class="error">Không tải được: ${escapeHtml(err.message)}</div>`;
  }
}

function closeReview() {
  document.getElementById('reviewModal').classList.remove('show');
  current = null;
}

function renderReview() {
  const s = current.session;
  document.getElementById('reviewTitle').textContent =
    `Chấm Viết · ${s.exam_id} · ${s.candidate_name}`;
  const writing = current.writing;
  document.getElementById('reviewContent').innerHTML = `
    <div class="kv">
      <div class="kv-k">Ứng viên</div><div class="kv-v">${escapeHtml(s.candidate_name)} (${escapeHtml(s.candidate_email)})</div>
      <div class="kv-k">Vị trí</div>  <div class="kv-v">${escapeHtml(s.position_label)}</div>
      <div class="kv-k">Listening</div><div class="kv-v">${s.score_listening ?? '—'} / 10</div>
      <div class="kv-k">Reading</div>  <div class="kv-v">${s.score_reading ?? '—'} / 10</div>
    </div>
    <div class="review-items">
      ${writing.map((w, idx) => reviewItemHtml(w, idx)).join('')}
    </div>
  `;
  updateSummary();
  document.addEventListener('input', onScoreInput);
}

function reviewItemHtml(w, idx) {
  const err = w.graderError
    ? `<div class="grader-err">Grader tự động lỗi: <code>${escapeHtml(w.graderError)}</code>${w.graderMessage ? ` — ${escapeHtml(w.graderMessage)}` : ''}</div>`
    : '';
  return `
    <div class="review-item" data-id="${escapeHtml(w.id)}">
      <div class="review-head">
        <div>
          <span class="pill">${escapeHtml(w.level)}</span>
          <strong>${escapeHtml(w.topic)}</strong>
          <code class="muted">${escapeHtml(w.id)}</code>
        </div>
        <div class="review-score">
          <input type="number" class="r-score" min="0" max="1" step="0.05" value="0"
                 data-id="${escapeHtml(w.id)}" />
          <span class="muted">/ 1.00</span>
        </div>
      </div>
      ${err}
      <details class="review-prompt"><summary>Prompt cho thí sinh</summary>
        <p>${escapeHtml(w.prompt)}</p>
        <p class="muted">${w.minWords}–${w.maxWords} từ.</p>
      </details>
      <details class="review-rubric" open><summary>Rubric</summary>
        <ul>${(w.rubric?.criteria || []).map((c) =>
          `<li><strong>${escapeHtml(c.name)}</strong> (${Math.round(c.weight*100)}%) — ${escapeHtml(c.description)}</li>`
        ).join('')}</ul>
      </details>
      <div class="candidate-answer">
        <div class="muted" style="margin-bottom:6px">Bài làm của ứng viên (${countWords(w.candidateAnswer)} từ):</div>
        <div class="answer-body">${escapeHtml(w.candidateAnswer) || '<em>(trống)</em>'}</div>
      </div>
    </div>
  `;
}

function countWords(s) { return (s || '').trim().split(/\s+/).filter(Boolean).length; }

function onScoreInput(e) {
  if (!e.target.classList.contains('r-score')) return;
  updateSummary();
}

function updateSummary() {
  const scores = [...document.querySelectorAll('.r-score')];
  const sum = scores.reduce((s, el) => s + (Number(el.value) || 0), 0);
  const writing = Math.round(sum);
  const lr = (current.session.score_listening || 0) + (current.session.score_reading || 0);
  const total = lr + writing;
  document.getElementById('reviewSummary').innerHTML =
    `Writing: <strong>${writing} / 10</strong> · Tổng: <strong>${total} / 30</strong>`;
}

async function finalizeReview() {
  const perItem = {};
  for (const el of document.querySelectorAll('.r-score')) {
    perItem[el.dataset.id] = Number(el.value) || 0;
  }
  const note = prompt('Ghi chú (tùy chọn) — sẽ lưu vào audit log:') || null;
  if (note === null && !confirm('Lưu điểm cuối? Phiên sẽ chuyển sang trạng thái "Đã nộp".')) return;
  try {
    const r = await api(
      `/admin/api/pending-review/${encodeURIComponent(current.session.id)}/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perItem, note }),
      },
    );
    alert(`Đã lưu. Tổng ${r.scores.total}/30, CEFR ${r.cefr.level || '—'}.`);
    closeReview();
    await loadQueue();
  } catch (err) {
    alert('Lưu thất bại: ' + err.message);
  }
}

async function logout() {
  await api('/admin/api/logout', { method: 'POST' });
  location.href = '/admin/login.html';
}
