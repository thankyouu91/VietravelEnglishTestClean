'use strict';
const PAGE_SIZE=25;
let state={offset:0,total:0,q:'',status:'',currentSessionId:null};

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

async function api(url,opts={}){
  const method = (opts.method || 'GET').toUpperCase();
  const headers = opts.headers || {};
  if (['POST', 'PUT', 'DELETE'].includes(method)) {
    const csrfToken = getCookie('admin_csrf');
    if (csrfToken) {
      headers['X-Admin-CSRF'] = csrfToken;
    }
  }
  const r=await fetch(url,{credentials:'include',...opts,headers});
  if(r.status===401){location.href='/admin/login.html';throw new Error('Unauthorized');}
  if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.message||j.error||r.statusText);}
  return r.json();
}

// ── Tab navigation ─────────────────────────────────────────
function showTab(tab){
  // Guard tabs the current role can't access (e.g. restored from localStorage).
  if(tab==='bank' && !hasRole('admin')) tab='dashboard';
  localStorage.setItem('admin_active_tab', tab);
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n=>{
    n.classList.remove('bg-brand','text-white','nav-item-active');
    n.classList.add('text-gray-500','hover:bg-slate-50/80');
  });
  const el=document.getElementById('tab-'+tab);
  if(el){el.classList.remove('hidden');}
  const nav=document.getElementById('nav-'+tab);
  if(nav){
    nav.classList.add('bg-brand','text-white','nav-item-active');
    nav.classList.remove('text-gray-500','hover:bg-slate-50/80');
  }
  if(tab==='tools')loadInvitations();
  if(tab==='bank') {
    loadBankSummary();
    loadExamConfigs();
  }
  if(tab==='settings') {
    loadUsers();
    loadAuditLog();
  }
}

// ── Bootstrap ──────────────────────────────────────────────
async function bootstrap(){
  let me;
  try{
    me=await api('/admin/api/me');
    document.getElementById('userBadge').textContent=me.display_name||me.username;
    state.me = me;
    updateThemeUI();
  }catch{return;}
  applyRolePermissions();
  await Promise.all([refreshStats(),refreshList()]);
  loadDashboardCharts();
  if(hasRole('manager')) loadReport();

  // Restore active tab
  const activeTab = localStorage.getItem('admin_active_tab') || 'dashboard';
  showTab(activeTab);

  // Live data — refreshes automatically, no manual toggle.
  startLiveRefresh();
}

// ── Stats ──────────────────────────────────────────────────
// ── Motion helpers ─────────────────────────────────────────
const _reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Smoothly count a number element up/down to its new value on each live refresh.
function animateCount(id, to, opts = {}) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  const num = Number(to);
  const decimals = opts.decimals || 0, suffix = opts.suffix || '', dur = opts.duration || 650;
  if (!isFinite(num)) { el.textContent = (to == null ? '—' : to); el.dataset.val = ''; return; }
  const from = parseFloat(el.dataset.val);
  const start = isFinite(from) ? from : 0;
  el.dataset.val = num;
  if (start === num || _reduceMotion) { el.textContent = num.toFixed(decimals) + suffix; return; }
  const t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  (function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = (start + (num - start) * ease(p)).toFixed(decimals) + suffix;
    if (p < 1) requestAnimationFrame(frame);
  })(t0);
}

// Theme-aware colors for Chart.js axes/gridlines.
function chartTheme() {
  const dark = document.documentElement.classList.contains('dark');
  return { grid: dark ? 'rgba(51,65,85,0.45)' : '#EEF2F7', tick: dark ? '#94A3B8' : '#64748B' };
}

async function refreshStats(){
  const s=await api('/admin/api/stats');
  const total=s.total||0;
  const submitted=s.submitted||0;
  const inProgress=s.inProgress||0;
  const passed=s.passed||0;
  const review=s.review||0;
  const failed=s.failed||0;

  // KPI Hero — animated count-up
  animateCount('s-total',total);
  animateCount('s-submitted',submitted);
  animateCount('s-passed',passed);
  animateCount('s-review',review);
  animateCount('s-failed',failed);

  // "đang làm" secondary label
  const progVal=document.getElementById('s-progress-val');
  if(progVal) progVal.textContent=inProgress;

  // Progress bars (against total)
  const pctOf=(n,d)=>d?Math.round(n/d*100):0;
  const completionPct=pctOf(submitted,total);
  const passedPct=pctOf(passed,submitted||1);
  const reviewPct=pctOf(review,submitted||1);
  const failedPct=pctOf(failed,submitted||1);

  const setBar=(id,pct)=>{const el=document.getElementById(id);if(el)el.style.width=pct+'%';};
  const setText=(id,txt)=>{const el=document.getElementById(id);if(el)el.textContent=txt;};

  setBar('bar-completion',completionPct); setText('pct-completion',completionPct+'%');
  setBar('bar-passed',passedPct);         setText('pct-passed',passedPct+'%');
  setBar('bar-review',reviewPct);         setText('pct-review',reviewPct+'%');
  setBar('bar-failed',failedPct);         setText('pct-failed',failedPct+'%');

  setText('s-passed-rate',passedPct+'%');
  setText('s-review-rate',reviewPct+'%');
  setText('s-failed-rate',failedPct+'%');

  // Avg score + subtitle
  const a=s.avg||{};
  const avgTotal=((a.avg_l||0)+(a.avg_r||0)+(a.avg_w||0));
  animateCount('metric-avg-score',avgTotal,{decimals:1});

  // Subtitle
  const subtitle=document.getElementById('dash-subtitle');
  if(subtitle) subtitle.textContent=`${total} phiên · ${submitted} đã nộp · tỷ lệ đạt ${passedPct}%`;

  // Store for charts
  window._statsData=s;

  if(s.today!=null) animateCount('metric-today',s.today);
  if(s.avgTime!=null) animateCount('metric-avg-time',Math.round(s.avgTime/60));
}

// ── Enhanced Stats (additional metrics) ────────────────────
async function loadEnhancedMetrics(){
  try{
    const today=await api('/admin/api/report?type=daily&limit=1');
    if(today.rows&&today.rows.length){
      animateCount('metric-today',today.rows[today.rows.length-1]?.total||0);
    }
  }catch{}
  try{
    const sessions=await api('/admin/api/sessions?limit=50&status=submitted');
    if(sessions.rows&&sessions.rows.length){
      const times=sessions.rows.filter(r=>r.elapsed_seconds).map(r=>r.elapsed_seconds);
      if(times.length){
        const avgMin=Math.round(times.reduce((a,b)=>a+b,0)/times.length/60);
        animateCount('metric-avg-time',avgMin);
      }
    }
  }catch{}
}

// ── Charts ─────────────────────────────────────────────────
let _cefrChart=null;
async function loadDashboardCharts(){
  try{
    const s=window._statsData||await api('/admin/api/stats');
    const cefrData=s.cefrDist||[];
    const cefrColors={'A1':'#E11D48','A2':'#F97316','B1':'#D4AF37','B2':'#1A73E8','C1':'#0D9488','C2':'#0F766E'};
    if(cefrData.length){
      const total=cefrData.reduce((a,d)=>a+d.c,0);
      const labels=cefrData.map(d=>d.cefr_level);
      const counts=cefrData.map(d=>d.c);
      const colors=cefrData.map(d=>cefrColors[d.cefr_level]||'#6B7280');
      const isDark = document.documentElement.classList.contains('dark');
      if(_cefrChart){
        // Update in place so live-refresh morphs smoothly instead of flashing.
        _cefrChart.data.labels=labels;
        _cefrChart.data.datasets[0].data=counts;
        _cefrChart.data.datasets[0].backgroundColor=colors;
        _cefrChart.data.datasets[0].borderColor=isDark?'#1E293B':'#fff';
        _cefrChart.update();
      }else{
        _cefrChart = new Chart(document.getElementById('chartCefr'),{
          type:'doughnut',
          data:{labels,datasets:[{data:counts,backgroundColor:colors,borderWidth:2,borderColor:isDark?'#1E293B':'#fff',hoverOffset:7}]},
          options:{
            responsive:true,maintainAspectRatio:false,
            cutout:'62%',
            animation:{animateRotate:true,animateScale:true,duration:800,easing:'easeOutQuart'},
            plugins:{
              legend:{display:false},
              tooltip:{callbacks:{label:(ctx)=>{const tot=ctx.chart.data.datasets[0].data.reduce((a,b)=>a+b,0)||1;return `${ctx.label}: ${ctx.raw} người (${Math.round(ctx.raw/tot*100)}%)`;}}}
            }
          }
        });
      }
      // Custom legend — horizontal list
      const legendEl=document.getElementById('cefr-legend');
      if(legendEl){
        legendEl.innerHTML=cefrData.map(d=>{
          const pct=Math.round(d.c/total*100);
          return `<div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-sm flex-shrink-0" style="background:${cefrColors[d.cefr_level]||'#6B7280'}"></span>
            <span class="font-bold text-gray-700 w-6">${d.cefr_level}</span>
            <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${pct}%;background:${cefrColors[d.cefr_level]||'#6B7280'}"></div></div>
            <span class="text-gray-500 w-6 text-right">${d.c}</span>
            <span class="text-gray-400 w-8 text-right">${pct}%</span>
          </div>`;
        }).join('');
      }
    }else if(!_cefrChart){
      const cv=document.getElementById('chartCefr');
      if(cv) cv.parentElement.innerHTML='<div class="flex items-center justify-center h-full text-gray-400 text-sm">Chưa có dữ liệu CEFR</div>';
    }
  }catch(e){console.error('CEFR chart error:',e);}

  // Load enhanced metrics
  loadEnhancedMetrics();
}

// ── Report section (embedded in dashboard) ─────────────────
let _reportChart=null;
async function loadReport(){
  if(!hasRole('manager')) return; // báo cáo tổng — chỉ Quản lý trở lên
  const type=document.getElementById('reportType')?.value||'daily';
  try{
    const data=await api(`/admin/api/report?type=${type}&limit=30`);
    const rows=data.rows||[];

    // Summary stats for report period
    const totalExams=rows.reduce((a,r)=>a+r.total,0);
    const totalPassed=rows.reduce((a,r)=>a+(r.passed||0),0);
    const totalFailed=rows.reduce((a,r)=>a+(r.failed||0),0);
    const avgAll=rows.filter(r=>r.avg_score).map(r=>r.avg_score);
    const overallAvg=avgAll.length?Math.round(avgAll.reduce((a,b)=>a+b,0)/avgAll.length*10)/10:'—';
    const passRate=totalExams?Math.round(totalPassed/totalExams*100):0;

    // Update report summary strip — animated count-up
    animateCount('rs-total',totalExams);
    animateCount('rs-pass-rate',passRate,{suffix:'%'});
    animateCount('rs-avg',overallAvg,{decimals:1});
    animateCount('rs-failed',totalFailed);

    // Table
    const tb=document.getElementById('reportTable');
    tb.innerHTML=rows.map(r=>{
      const passR=r.total?Math.round((r.passed||0)/r.total*100):0;
      return `<tr class="border-b border-gray-50 hover:bg-gray-50">
        <td class="px-3 py-2 font-mono font-bold text-brand text-xs">${r.period}</td>
        <td class="px-3 py-2 text-right font-bold">${r.total}</td>
        <td class="px-3 py-2 text-right">${r.submitted||0}</td>
        <td class="px-3 py-2 text-right text-emerald-600 font-bold">${r.passed||0}</td>
        <td class="px-3 py-2 text-right text-red-500">${r.failed||0}</td>
        <td class="px-3 py-2 text-right"><span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">${passR}%</span></td>
        <td class="px-3 py-2 text-right font-semibold">${r.avg_score||'—'}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="7" class="text-center py-6 text-gray-400">Chưa có dữ liệu</td></tr>';

    // Chart — multi-line with area fills
    const labels=rows.map(r=>r.period);
    const dTotal=rows.map(r=>r.total);
    const dPassed=rows.map(r=>r.passed||0);
    const dFailed=rows.map(r=>r.failed||0);
    const dAvg=rows.map(r=>r.avg_score||null);

    // Update the existing chart in place so live-refresh transitions smoothly
    // (no destroy/recreate flash, and Chart.js animates points between values).
    if(_reportChart){
      _reportChart._rows=rows;
      _reportChart.data.labels=labels;
      _reportChart.data.datasets[0].data=dTotal;
      _reportChart.data.datasets[1].data=dPassed;
      _reportChart.data.datasets[2].data=dFailed;
      _reportChart.data.datasets[3].data=dAvg;
      _reportChart.update();
      return;
    }

    const canvas = document.getElementById('chartReport');
    const ctx = canvas.getContext('2d');
    const th = chartTheme();

    const gradTotal = ctx.createLinearGradient(0, 0, 0, 240);
    gradTotal.addColorStop(0, 'rgba(26, 115, 232, 0.22)');
    gradTotal.addColorStop(1, 'rgba(26, 115, 232, 0)');

    const gradPassed = ctx.createLinearGradient(0, 0, 0, 240);
    gradPassed.addColorStop(0, 'rgba(13, 148, 136, 0.22)');
    gradPassed.addColorStop(1, 'rgba(13, 148, 136, 0)');

    const gradFailed = ctx.createLinearGradient(0, 0, 0, 240);
    gradFailed.addColorStop(0, 'rgba(225, 29, 72, 0.12)');
    gradFailed.addColorStop(1, 'rgba(225, 29, 72, 0)');

    _reportChart=new Chart(canvas,{
      type:'line',
      data:{labels,datasets:[
        {label:'Tổng phiên',data:dTotal,borderColor:'#1A73E8',backgroundColor:gradTotal,fill:true,tension:.4,borderWidth:2.5,pointRadius:3,pointHoverRadius:6,pointBackgroundColor:'#1A73E8'},
        {label:'Đạt',data:dPassed,borderColor:'#0D9488',backgroundColor:gradPassed,fill:true,tension:.4,borderWidth:2,pointRadius:2,pointHoverRadius:5,pointBackgroundColor:'#0D9488'},
        {label:'Chưa đạt',data:dFailed,borderColor:'#E11D48',backgroundColor:gradFailed,fill:true,tension:.4,borderWidth:1.5,pointRadius:2,pointHoverRadius:5,pointBackgroundColor:'#E11D48'},
        {label:'Điểm TB',data:dAvg,borderColor:'#D4AF37',borderDash:[4,4],tension:.4,borderWidth:2,pointRadius:3,pointHoverRadius:6,yAxisID:'y1',fill:false,pointBackgroundColor:'#D4AF37'},
      ]},
      options:{
        responsive:true,maintainAspectRatio:false,
        animation:{duration:900,easing:'easeOutQuart'},
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{position:'bottom',labels:{boxWidth:10,font:{size:11,family:'Be Vietnam Pro',weight:'600'},padding:15,color:th.tick}},
          tooltip:{
            backgroundColor:'rgba(12, 35, 64, 0.95)',titleFont:{size:12,family:'Be Vietnam Pro',weight:'700'},bodyFont:{size:11,family:'Be Vietnam Pro'},
            padding:12,cornerRadius:8,
            callbacks:{
              afterBody:(items)=>{
                const ch=items[0].chart;const r=(ch._rows||[])[items[0].dataIndex];
                return r?`Tỷ lệ đạt: ${r.total?Math.round((r.passed||0)/r.total*100):0}%`:'';
              }
            }
          }
        },
        scales:{
          y:{beginAtZero:true,position:'left',title:{display:true,text:'Số phiên',font:{size:10,weight:'600'},color:th.tick},grid:{color:th.grid},ticks:{font:{size:10},color:th.tick}},
          y1:{beginAtZero:true,position:'right',max:30,title:{display:true,text:'Điểm TB',font:{size:10,weight:'600'},color:th.tick},grid:{display:false},ticks:{font:{size:10},color:th.tick}},
          x:{ticks:{font:{size:10},maxRotation:45,color:th.tick},grid:{display:false}}
        }
      }
    });
    _reportChart._rows=rows;
  }catch(e){console.error('Report error:',e);}
}

// ── Sessions list ──────────────────────────────────────────
async function refreshList(){
  const params=new URLSearchParams({limit:PAGE_SIZE,offset:state.offset});
  if(state.q)params.set('q',state.q);
  if(state.status)params.set('status',state.status);
  
  const pos = document.getElementById('qPosition')?.value;
  if(pos) params.set('position', pos);
  
  const startD = document.getElementById('qStartDate')?.value;
  if(startD) params.set('startDate', new Date(startD).getTime());
  
  const endD = document.getElementById('qEndDate')?.value;
  if(endD) params.set('endDate', new Date(endD + 'T23:59:59').getTime());

  const j=await api('/admin/api/sessions?'+params);
  state.total=j.total;
  renderRows(j.rows);renderPager();
}

function fmtDate(ts){if(!ts)return'—';return new Date(ts).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}
const escHtml = esc;

// ── Role-based access (staff < manager < admin) ────────────
const ROLE_LEVEL={staff:1,manager:2,admin:3};
const ROLE_LABEL={staff:'Nhân viên',manager:'Quản lý',admin:'Quản trị viên'};
function hasRole(min){return (ROLE_LEVEL[state.me?.role]||0) >= (ROLE_LEVEL[min]||99);}
function clientPwError(pw){
  if(typeof pw!=='string'||pw.length<12)return 'Mật khẩu phải dài tối thiểu 12 ký tự.';
  if(!/[A-Za-z]/.test(pw)||!/[0-9]/.test(pw))return 'Mật khẩu phải chứa cả chữ và số.';
  return null;
}
// Hide every element gated above the current user's tier and show the role label.
function applyRolePermissions(){
  document.querySelectorAll('[data-min-role]').forEach(el=>{
    el.classList.toggle('hidden', !hasRole(el.getAttribute('data-min-role')));
  });
  const restricted=document.getElementById('settings-staff-restricted');
  if(restricted) restricted.classList.toggle('hidden', hasRole('admin'));
  const roleLabel=document.getElementById('userRoleLabel');
  if(roleLabel) roleLabel.textContent=ROLE_LABEL[state.me?.role]||'—';
  // When the Settings button is hidden, let Logout take the full row.
  const logoutBtn=document.getElementById('logoutBtn');
  if(logoutBtn) logoutBtn.classList.toggle('w-full', !hasRole('admin'));
  if(logoutBtn) logoutBtn.classList.toggle('w-1/2', hasRole('admin'));
}

function cefrBadge(level,status){
  const colors={pass:'bg-emerald-100 text-emerald-700',review:'bg-amber-100 text-amber-700',fail:'bg-red-100 text-red-700'};
  const cls=colors[status]||'bg-gray-100 text-gray-500';
  return `<span class="${cls} px-2.5 py-0.5 rounded-full text-[11px] font-bold">${esc(level||'—')}</span>`;
}

function renderRows(rows){
  const tb=document.getElementById('rows');
  if(!rows.length){tb.innerHTML='<tr><td colspan="10" class="text-center py-10 text-gray-400">Chưa có dữ liệu.</td></tr>';return;}
  tb.innerHTML=rows.map(r=>{
    const scoreColor=(v,max=10)=>{if(v==null)return'text-gray-400';const p=v/max;return p>=.7?'text-emerald-600 font-bold':p>=.4?'text-amber-600':'text-red-500';};
    return `<tr class="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer transition" onclick="openDetail('${r.id}')">
      <td class="px-4 py-3 font-mono font-bold text-brand text-[11px]">${esc(r.exam_id)}</td>
      <td class="px-4 py-3"><div class="font-bold text-gray-800 text-xs">${esc(r.candidate_name)}</div><div class="text-gray-400 text-[11px]">${esc(r.candidate_email)}</div></td>
      <td class="px-4 py-3 text-gray-600 text-xs">${esc(r.position_label||'—')}</td>
      <td class="px-4 py-3 text-gray-500 text-xs">${fmtDate(r.submitted_at)}</td>
      <td class="px-4 py-3 text-right ${scoreColor(r.score_listening)} text-xs">${r.score_listening??'—'}</td>
      <td class="px-4 py-3 text-right ${scoreColor(r.score_reading)} text-xs">${r.score_reading??'—'}</td>
      <td class="px-4 py-3 text-right ${scoreColor(r.score_writing)} text-xs">${r.score_writing??'—'}</td>
      <td class="px-4 py-3 text-right font-black text-brand text-xs">${r.score_total??'—'}</td>
      <td class="px-4 py-3">${cefrBadge(r.cefr_level,r.cefr_status)}</td>
      <td class="px-4 py-3 text-center">
        <button onclick="event.stopPropagation();downloadPdfById('${r.id}')" class="text-brand hover:text-brand-light text-xs" title="Tải PDF">📄</button>
        ${hasRole('manager') ? `<button onclick="event.stopPropagation();confirmDelete('${r.id}','${esc(r.candidate_name)}')" class="text-red-400 hover:text-red-600 text-xs ml-2" title="Xóa">🗑️</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function renderPager(){
  const from=state.total?state.offset+1:0,to=Math.min(state.offset+PAGE_SIZE,state.total);
  document.getElementById('pageInfo').textContent=`${from}–${to} / ${state.total}`;
  document.getElementById('prevBtn').disabled=state.offset===0;
  document.getElementById('nextBtn').disabled=to>=state.total;
}
function page(d){const n=state.offset+d*PAGE_SIZE;if(n<0||n>=state.total)return;state.offset=n;refreshList();}

// ── Detail modal ───────────────────────────────────────────
async function openDetail(id){
  state.currentSessionId=id;
  document.getElementById('detailModal').classList.remove('hidden');
  document.getElementById('dContent').innerHTML='<div class="text-center py-10 text-gray-400">Đang tải…</div>';
  try{
    const s=await api('/admin/api/sessions/'+id);
    document.getElementById('dTitle').textContent=`${s.exam_id} · ${s.candidate_name}`;
    document.getElementById('dContent').innerHTML=buildDetail(s);
  }catch(e){document.getElementById('dContent').innerHTML=`<div class="text-red-500 text-center py-10">${esc(e.message)}</div>`;}
}
function closeDetail(){document.getElementById('detailModal').classList.add('hidden');state.currentSessionId=null;}

function renderWritingDetailsHtml(s) {
  let html = '';
  try {
    const parsedAnswers = typeof s.answers === 'string' ? JSON.parse(s.answers) : s.answers;
    const writingAnswers = parsedAnswers?.answers?.writing || {};
    const details = parsedAnswers?.details || {};
    const writingDetails = details.writing || [];

    if (Object.keys(writingAnswers).length === 0) {
      return '<div class="text-gray-400 dark:text-slate-500 italic">Không có dữ liệu bài làm Writing.</div>';
    }

    html = Object.entries(writingAnswers).map(([qid, ans]) => {
      const detail = writingDetails.find(d => d.id === qid) || {};
      let formattedAns = '';
      let gradeResult = '';

      if (typeof ans === 'string') {
        formattedAns = `<div class="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-3 font-mono text-xs whitespace-pre-wrap text-gray-800 dark:text-slate-200">${esc(ans)}</div>`;
        if (detail.feedback) {
          gradeResult = `<div class="mt-2 bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/50 rounded-lg p-2.5 text-xs text-purple-950 dark:text-purple-350">
            <div class="font-bold text-purple-800 dark:text-purple-400 mb-1">📝 Nhận xét đánh giá:</div>
            <div>${esc(detail.feedback)}</div>
          </div>`;
        }
      } else if (Array.isArray(ans)) {
        formattedAns = `<div class="text-xs text-gray-700 dark:text-slate-300 font-semibold bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-3">Thứ tự câu đã chọn: ${ans.map(x => x + 1).join(' → ')}</div>`;
        gradeResult = `<div class="text-xs text-gray-505 dark:text-slate-400 mt-1">Đúng ${detail.correct || 0}/${detail.total || 0} câu.</div>`;
      } else if (typeof ans === 'object') {
        const items = Object.entries(ans).map(([key, val]) => {
          let checkIcon = '';
          let expectedInfo = '';
          
          if (detail.details && detail.details[key]) {
            const itemDetail = detail.details[key];
            checkIcon = itemDetail.correct ? '<span class="text-emerald-600 dark:text-emerald-400 font-bold ml-1">✓</span>' : '<span class="text-red-500 dark:text-rose-500 font-bold ml-1">✗</span>';
            if (!itemDetail.correct && itemDetail.expected) {
              expectedInfo = `<span class="text-gray-400 dark:text-slate-500 ml-1">(Đáp án: <strong class="text-emerald-700 dark:text-emerald-500">${esc(itemDetail.expected)}</strong>)</span>`;
            }
          } else if (Array.isArray(detail.details) && detail.details[Number(key)]) {
            const itemDetail = detail.details[Number(key)];
            checkIcon = itemDetail.correct ? '<span class="text-emerald-600 dark:text-emerald-400 font-bold ml-1">✓</span>' : '<span class="text-red-500 dark:text-rose-500 font-bold ml-1">✗</span>';
            if (!itemDetail.correct && itemDetail.expected !== undefined) {
              expectedInfo = `<span class="text-gray-400 dark:text-slate-500 ml-1">(Đáp án đúng: <strong class="text-emerald-700 dark:text-emerald-500">${esc(itemDetail.expected)}</strong>)</span>`;
            }
          }
          
          return `<div><span class="text-gray-400 dark:text-slate-500 font-mono">(${key}):</span> <strong class="text-brand dark:text-brand-light">${esc(val)}</strong> ${checkIcon} ${expectedInfo}</div>`;
        }).join('');
        
        formattedAns = `<div class="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-3 text-xs space-y-1">${items}</div>`;
        if (detail.correct !== undefined) {
          gradeResult = `<div class="text-xs text-gray-500 dark:text-slate-400 mt-1">Đúng ${detail.correct || 0}/${detail.total || 0} phần.</div>`;
        }
      }

      let scoreBadge = '';
      if (detail.points !== undefined && detail.points !== null) {
        scoreBadge = `<span class="bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded text-[10px] font-bold">Điểm: ${detail.points}đ</span>`;
      } else if (detail.score !== undefined) {
        scoreBadge = `<span class="bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded text-[10px] font-bold">Độ chính xác: ${Math.round(detail.score * 10)}/10</span>`;
      }

      return `
        <div class="mb-4 border-b border-gray-100 dark:border-slate-850 pb-3 last:border-b-0 last:pb-0">
          <div class="flex justify-between items-center mb-1.5">
            <span class="text-xs font-bold text-gray-600 dark:text-slate-400">Câu hỏi: ${esc(qid)} (${esc(detail.type || 'viết')})</span>
            ${scoreBadge}
          </div>
          ${formattedAns}
          ${gradeResult}
        </div>
      `;
    }).join('');
  } catch (e) {
    html = `<div class="text-red-500 text-xs">Lỗi phân tích bài làm: ${esc(e.message)}</div>`;
  }
  return html;
}

function buildDetail(s){
  const scores={l:s.score_listening??0,r:s.score_reading??0,w:s.score_writing??0,t:s.score_total??0};
  const elapsed=s.elapsed_seconds?`${Math.floor(s.elapsed_seconds/60)}m ${s.elapsed_seconds%60}s`:'—';
  const barColor=(v)=>v>=7?'bg-[#0D9488]':v>=4?'bg-[#D4AF37]':'bg-[#E11D48]';
  const textColor=(v)=>v>=7?'text-[#0D9488]':v>=4?'text-[#D4AF37]':'text-[#E11D48]';
  
  const writingDetailsHtml = renderWritingDetailsHtml(s);

  let roadmap = '';
  const lvl = s.cefr_level || '';
  if (lvl === 'A1' || lvl === 'A2') {
     roadmap = 'Cần tham gia khóa đào tạo tiếng Anh căn bản (12 tuần). Tập trung vào giao tiếp thường ngày và từ vựng chuyên ngành cơ bản.';
  } else if (lvl === 'B1') {
     roadmap = 'Khóa tiếng Anh nâng cao (8 tuần). Nâng cao kỹ năng viết email và xử lý tình huống thực tế với khách hàng.';
  } else if (lvl === 'B2') {
     roadmap = 'Chương trình phát triển chuyên sâu (4 tuần). Giao tiếp lưu loát, tập trung vào đàm phán và thuyết trình chuyên nghiệp.';
  } else if (lvl === 'C1' || lvl === 'C2') {
     roadmap = 'Không yêu cầu đào tạo thêm. Phù hợp phụ trách các đối tác quốc tế chiến lược hoặc làm mentor nội bộ.';
  } else {
     roadmap = 'Chưa xác định lộ trình (cần có điểm CEFR).';
  }

  // Get first letter of name for initials badge
  const initial = s.candidate_name ? s.candidate_name.charAt(0).toUpperCase() : 'U';

  return `
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
    <!-- CỘT 1: Thông tin & Điểm số (4 columns) -->
    <div class="lg:col-span-4 space-y-5 flex flex-col">
      <!-- Profile Card -->
      <div class="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center gap-3">
        <div class="w-12 h-12 rounded-full bg-[#0C2340]/10 flex items-center justify-center text-[#0C2340] text-lg font-bold flex-shrink-0">${initial}</div>
        <div class="min-w-0">
          <div class="font-extrabold text-sm text-slate-800 truncate">${esc(s.candidate_name)}</div>
          <div class="text-[11px] text-gray-400 font-semibold truncate">${esc(s.candidate_email)}</div>
        </div>
      </div>

      <!-- Quick Stats Grid -->
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-50 border border-slate-100 rounded-xl p-3">
          <div class="text-[10px] text-gray-400 uppercase font-bold">Vị trí</div>
          <div class="font-bold text-xs text-slate-700 truncate mt-0.5">${esc(s.position_label||'—')}</div>
        </div>
        <div class="bg-slate-50 border border-slate-100 rounded-xl p-3">
          <div class="text-[10px] text-gray-400 uppercase font-bold">Thời gian làm</div>
          <div class="font-bold text-xs text-slate-700 mt-0.5">${elapsed}</div>
        </div>
        <div class="bg-slate-50 border border-slate-100 rounded-xl p-3">
          <div class="text-[10px] text-gray-400 uppercase font-bold">Nộp lúc</div>
          <div class="font-bold text-[10px] text-slate-700 mt-0.5">${fmtDate(s.submitted_at)}</div>
        </div>
        <div class="bg-slate-50 border border-slate-100 rounded-xl p-3">
          <div class="text-[10px] text-gray-400 uppercase font-bold">Xếp lớp CEFR</div>
          <div class="mt-0.5">${cefrBadge(s.cefr_level,s.cefr_status)}</div>
        </div>
      </div>

      <!-- Total Score Card -->
      <div class="bg-gradient-to-br from-[#0C2340] to-[#1A73E8] rounded-xl p-5 text-white text-center shadow-md relative overflow-hidden">
        <!-- Gold dust accents -->
        <div class="absolute -right-4 -bottom-4 w-20 h-20 bg-amber-500/10 rounded-full blur-xl"></div>
        <div class="text-5xl font-black">${scores.t}<span class="text-xl opacity-75"> / 30</span></div>
        <div class="text-xs uppercase tracking-wider font-extrabold opacity-90 mt-1.5">Tổng điểm tích lũy</div>
      </div>

      <!-- Skill list progress -->
      <div class="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3.5">
        <h4 class="text-xs font-extrabold uppercase text-slate-500 tracking-wider mb-1">Điểm số từng phần</h4>
        ${[['🎧 Listening',scores.l],['📖 Reading',scores.r],['✍️ Writing',scores.w]].map(([label,v])=>`
        <div class="space-y-1">
          <div class="flex justify-between items-center text-xs">
            <span class="font-bold text-slate-700">${label}</span>
            <span class="font-extrabold ${textColor(v)}">${v}/10</span>
          </div>
          <div class="h-2.5 bg-gray-200/60 rounded-full overflow-hidden">
            <div class="h-full rounded-full ${barColor(v)} transition-all duration-500" style="width:${v*10}%"></div>
          </div>
        </div>`).join('')}
      </div>
    </div>

    <!-- CỘT 2: Bài làm Writing & Đánh giá (5 columns) -->
    <div class="lg:col-span-5 flex flex-col h-full">
      <div class="bg-indigo-50/50 border border-indigo-100/60 rounded-xl p-4 overflow-y-auto max-h-[500px]">
        <h4 class="text-xs font-extrabold uppercase text-[#0C2340] mb-3 flex items-center justify-between border-b border-indigo-100 pb-2">
          <span class="flex items-center gap-1.5"><span>✍️</span> Bài làm Writing &amp; Đánh giá</span>
          <span class="bg-[#1A73E8] text-white px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">Tự động</span>
        </h4>
        <div class="space-y-4 text-xs">${writingDetailsHtml}</div>
      </div>
    </div>

    <!-- CỘT 3: Lộ trình & Siêu dữ liệu (3 columns) -->
    <div class="lg:col-span-3 space-y-4">
      <!-- Roadmap frame (Gold accent) -->
      <div class="border-2 border-[#D4AF37] bg-amber-50/40 rounded-xl p-4 shadow-sm relative overflow-hidden">
        <!-- Gold dust top strip overlay -->
        <div class="absolute top-0 left-0 right-0 h-1 bg-[#D4AF37]"></div>
        <h4 class="text-xs font-extrabold uppercase text-[#D4AF37] mb-2 tracking-wider flex items-center gap-1.5 mt-1">
          <span>🏆</span> Đào tạo đề xuất
        </h4>
        <div class="text-xs text-slate-700 leading-relaxed font-bold">${roadmap}</div>
      </div>

      <!-- Proctoring & Meta -->
      <div class="bg-slate-50 border border-slate-100 rounded-xl p-4 text-[11px] text-gray-500 space-y-2">
        <h4 class="text-xs font-extrabold uppercase text-slate-500 tracking-wider border-b border-gray-200 pb-1.5">Siêu dữ liệu giám thị</h4>
        <div><strong class="text-gray-700">Mã thi:</strong> <span class="font-mono">${esc(s.exam_id)}</span></div>
        <div><strong class="text-gray-700">Địa chỉ IP:</strong> ${esc(s.ip_address||'—')}</div>
        <div class="truncate" title="${esc(s.user_agent||'')}"><strong class="text-gray-700">Thiết bị:</strong> ${esc(s.user_agent||'—')}</div>
        <div><strong class="text-gray-700">Bắt đầu lúc:</strong> ${fmtDate(s.started_at)}</div>
        <div><strong class="text-gray-700">Đồng ý PDPA:</strong> ${s.consent_given?'<span class="text-teal-600 font-bold">Đồng ý ✅</span>':'<span class="text-red-500 font-bold">Chưa ❌</span>'}</div>
        <div><strong class="text-gray-700">Tab Switch / Blur:</strong> ${s.cheat_events != null ? `<span class="font-extrabold px-2 py-0.5 rounded-full ${s.cheat_events > 0 ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}">${s.cheat_events} lần</span>` : '<span class="text-emerald-700 font-bold">0 lần</span>'}</div>
      </div>
    </div>
  </div>`;
}

// ── Actions ────────────────────────────────────────────────
function downloadPdf(){if(state.currentSessionId)window.open(`/admin/api/sessions/${state.currentSessionId}/pdf`,'_blank');}
function downloadPdfById(id){window.open(`/admin/api/sessions/${id}/pdf`,'_blank');}

function confirmDelete(id,name){
  document.getElementById('confirmDeleteModal').classList.remove('hidden');
  document.getElementById('confirmDeleteText').textContent=`Bạn có chắc muốn xóa phiên thi của "${name}"? Hành động này không thể hoàn tác.`;
  document.getElementById('confirmDeleteBtn').onclick=async()=>{
    try{await api(`/admin/api/sessions/${id}`,{method:'DELETE'});closeConfirmDelete();closeDetail();refreshList();refreshStats();}
    catch(e){alert('Lỗi: '+e.message);}
  };
}
function closeConfirmDelete(){document.getElementById('confirmDeleteModal').classList.add('hidden');}
function deleteCurrentSession(){if(state.currentSessionId)confirmDelete(state.currentSessionId,'ứng viên này');}

async function resetCooldown(){
  const email=document.getElementById('resetEmail').value.trim();
  const el=document.getElementById('resetResult');
  if(!email){el.textContent='Vui lòng nhập email';el.className='mt-3 text-xs text-red-500';el.classList.remove('hidden');return;}
  try{
    const r=await api('/admin/api/sessions/reset-cooldown',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    el.textContent='✅ '+r.message;el.className='mt-3 text-xs text-emerald-600';el.classList.remove('hidden');
  }catch(e){el.textContent='❌ '+e.message;el.className='mt-3 text-xs text-red-500';el.classList.remove('hidden');}
}

async function searchToDelete(){
  const q=document.getElementById('deleteSearch').value.trim();
  const el=document.getElementById('deleteResult');
  if(!q){el.textContent='Vui lòng nhập mã thi hoặc email';el.className='mt-3 text-xs text-red-500';el.classList.remove('hidden');return;}
  try{
    const data=await api(`/admin/api/sessions?q=${encodeURIComponent(q)}&limit=5`);
    if(!data.rows.length){el.textContent='Không tìm thấy phiên thi nào';el.className='mt-3 text-xs text-amber-600';el.classList.remove('hidden');return;}
    el.innerHTML=data.rows.map(r=>`<div class="flex items-center justify-between py-1.5 border-b border-gray-100">
      <span class="font-mono text-brand">${esc(r.exam_id)}</span>
      <span class="text-gray-500">${esc(r.candidate_name)}</span>
      <button onclick="confirmDelete('${r.id}','${esc(r.candidate_name)}')" class="text-red-500 hover:text-red-700 font-bold">Xóa</button>
    </div>`).join('');
    el.className='mt-3 text-xs';el.classList.remove('hidden');
  }catch(e){el.textContent='❌ '+e.message;el.className='mt-3 text-xs text-red-500';el.classList.remove('hidden');}
}

async function changePassword(){
  const cur=document.getElementById('pwCurrent').value,nw=document.getElementById('pwNew').value;
  const el=document.getElementById('pwResult');
  if(!cur||!nw){el.textContent='Vui lòng điền đầy đủ';el.className='mt-3 text-xs text-red-500';el.classList.remove('hidden');return;}
  const pwErr=clientPwError(nw);
  if(pwErr){el.textContent='❌ '+pwErr;el.className='mt-3 text-xs text-red-500';el.classList.remove('hidden');return;}
  try{
    await api('/admin/api/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:cur,newPassword:nw})});
    el.textContent='✅ Đổi mật khẩu thành công';el.className='mt-3 text-xs text-emerald-600';el.classList.remove('hidden');
    document.getElementById('pwCurrent').value='';document.getElementById('pwNew').value='';
  }catch(e){el.textContent='❌ '+e.message;el.className='mt-3 text-xs text-red-500';el.classList.remove('hidden');}
}

function exportXlsx(){
  const params = new URLSearchParams();
  if(state.q) params.set('q', state.q);
  if(state.status) params.set('status', state.status);
  
  const pos = document.getElementById('qPosition')?.value;
  if(pos) params.set('position', pos);
  
  const startD = document.getElementById('qStartDate')?.value;
  if(startD) params.set('startDate', new Date(startD).getTime());
  
  const endD = document.getElementById('qEndDate')?.value;
  if(endD) params.set('endDate', new Date(endD + 'T23:59:59').getTime());

  window.location.href='/admin/api/export.xlsx?'+params.toString();
}
async function logout(){try{await api('/admin/api/logout',{method:'POST'});}catch{}location.href='/admin/login.html';}

// ── Invitations ────────────────────────────────────────────
async function createInvitation(){
  const name=document.getElementById('invName').value.trim();
  const email=document.getElementById('invEmail').value.trim();
  const position=document.getElementById('invPosition').value;
  const el=document.getElementById('invResult');
  if(!email){el.innerHTML='<div class="text-xs text-red-500">Vui lòng nhập email thí sinh</div>';el.classList.remove('hidden');return;}
  try{
    const r=await api('/admin/api/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,position})});
    el.innerHTML=`
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <div class="text-xs font-bold text-emerald-700 mb-2">✅ Link mời đã tạo thành công!</div>
        <div class="flex items-center gap-2">
          <input id="invLink" value="${r.link}" readonly class="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-mono text-brand select-all">
          <button onclick="copyInvLink()" class="px-3 py-2 bg-brand text-white rounded-lg text-xs font-bold hover:bg-brand-light transition">📋 Copy</button>
        </div>
        <div class="text-[11px] text-gray-400 mt-2">Gửi link này cho ${esc(email)}. Hết hạn sau 7 ngày.</div>
      </div>`;
    el.classList.remove('hidden');
    document.getElementById('invName').value='';
    document.getElementById('invEmail').value='';
    document.getElementById('invPosition').value='';
    loadInvitations();
  }catch(e){el.innerHTML=`<div class="text-xs text-red-500">❌ ${esc(e.message)}</div>`;el.classList.remove('hidden');}
}

function copyInvLink(){
  const input=document.getElementById('invLink');
  if(input){input.select();navigator.clipboard.writeText(input.value).then(()=>{input.classList.add('border-emerald-400');setTimeout(()=>input.classList.remove('border-emerald-400'),1500);});}
}

async function loadInvitations(){
  try{
    const data=await api('/admin/api/invitations?limit=10');
    const el=document.getElementById('invList');
    if(!data.rows.length){el.innerHTML='<div class="text-xs text-gray-400 text-center py-3">Chưa có link mời nào</div>';return;}
    el.innerHTML=data.rows.map(r=>{
      const expired=r.expires_at&&Date.now()>r.expires_at;
      const statusCls=r.status==='used'?'bg-emerald-100 text-emerald-700':expired?'bg-red-100 text-red-600':'bg-blue-100 text-blue-700';
      const statusText=r.status==='used'?'Đã thi':expired?'Hết hạn':'Chờ thi';
      return `<div class="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-xl">
        <div class="flex-1 min-w-0">
          <div class="text-xs font-bold text-gray-700 truncate">${esc(r.name||r.email)}</div>
          <div class="text-[11px] text-gray-400">${esc(r.email)} · ${fmtDate(r.created_at)}</div>
        </div>
        <span class="${statusCls} px-2 py-0.5 rounded-full text-[10px] font-bold">${statusText}</span>
        ${r.status==='pending'&&!expired?`<button onclick="copyLink('${r.id}')" class="text-brand text-xs hover:underline">📋</button>`:''}
        <button onclick="deleteInvitation('${r.id}')" class="text-red-400 hover:text-red-600 text-xs">✕</button>
      </div>`;
    }).join('');
  }catch{}
}

function copyLink(id){
  const link=`${location.origin}/exam/?invite=${id}`;
  navigator.clipboard.writeText(link).then(()=>alert('Đã copy link!'));
}

async function deleteInvitation(id){
  if(!confirm('Xóa link mời này?'))return;
  try{await api(`/admin/api/invitations/${id}`,{method:'DELETE'});loadInvitations();}catch(e){alert(e.message);}
}

// ── Search & filter ────────────────────────────────────────
let searchTimer;
document.getElementById('qSearch')?.addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=e.target.value.trim();state.offset=0;refreshList();},300);});
document.getElementById('qStatus')?.addEventListener('change',e=>{state.status=e.target.value;state.offset=0;refreshList();});
document.getElementById('qPosition')?.addEventListener('change',()=>{state.offset=0;refreshList();});
document.getElementById('qStartDate')?.addEventListener('change',()=>{state.offset=0;refreshList();});
document.getElementById('qEndDate')?.addEventListener('change',()=>{state.offset=0;refreshList();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDetail();closeConfirmDelete();}});

// ── Bank Manager ───────────────────────────────────────────
let bankQuestionsList = [];
let editingQuestionId = null;

async function loadBankSummary(){
  try{
    const s=await api('/admin/api/bank/summary');
    document.getElementById('bank-listening-count').textContent=`${s.listening.BANK_STAFF+s.listening.BANK_OFFICE_MGR} câu`;
    document.getElementById('bank-reading-count').textContent=`${s.reading.BANK_STAFF+s.reading.BANK_OFFICE_MGR} câu`;
    document.getElementById('bank-writing-count').textContent=`${s.writing.total} câu`;
    
    if (!state.bankActiveSkill) {
      selectBankSkill('listening');
    } else {
      loadBankQuestions();
    }
  }catch(e){console.error(e);}
}

async function selectBankSkill(skill) {
  state.bankActiveSkill = skill;
  
  // Highlight active card
  ['listening', 'reading', 'writing'].forEach(s => {
    const card = document.getElementById(`card-bank-${s}`);
    if (card) {
      if (s === skill) {
        card.classList.add('border-brand', 'bg-blue-50/20', 'shadow-md');
        card.classList.remove('border-gray-150');
      } else {
        card.classList.remove('border-brand', 'bg-blue-50/20', 'shadow-md');
        card.classList.add('border-gray-150');
      }
    }
  });

  // Show workspace container
  const workspace = document.getElementById('bank-workspace');
  if (workspace) workspace.classList.remove('hidden');
  
  const icons = { listening: '🎧', reading: '📖', writing: '✍️' };
  const iconEl = document.getElementById('list-skill-icon');
  if (iconEl) iconEl.textContent = icons[skill] || '';
  
  resetBankForm();
  await loadBankQuestions();
}

async function loadBankQuestions(){
  const skill = state.bankActiveSkill;
  if (!skill) return;
  const level = document.getElementById('bankLevelFilter')?.value || '';
  try{
    const params=new URLSearchParams({skill});
    if(level)params.set('level',level);
    const data=await api('/admin/api/bank/questions?'+params);
    bankQuestionsList = data.items || [];
    filterBankList();
  }catch(e){console.error(e);}
}

function filterBankList() {
  const q = (document.getElementById('bankSearchInput')?.value || '').toLowerCase().trim();
  const tb = document.getElementById('bankRows');
  if (!tb) return;
  
  let filtered = bankQuestionsList;
  if (q) {
    filtered = bankQuestionsList.filter(item => {
      const id = (item.id || '').toLowerCase();
      const topic = (item.topic || '').toLowerCase();
      const type = (item.type || '').toLowerCase();
      const preview = (item.question || item.instruction || item.passage || item.prompt || '').toLowerCase();
      return id.includes(q) || topic.includes(q) || type.includes(q) || preview.includes(q);
    });
  }
  
  if (!filtered.length) {
    tb.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-400">Không có câu hỏi nào</td></tr>';
    return;
  }
  
  tb.innerHTML = filtered.map(item => {
    const preview = item.question || item.instruction || item.passage || item.prompt || '';
    const activeClass = editingQuestionId === item.id ? 'bg-blue-50 font-bold border-l-2 border-brand' : 'hover:bg-gray-50';
    return `<tr class="border-b border-gray-50 cursor-pointer transition ${activeClass}" onclick="editBankQuestion('${esc(item.id)}')">
      <td class="px-3 py-2.5 font-mono text-brand font-bold">${esc(item.id)}</td>
      <td class="px-3 py-2.5"><span class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold">${esc(item.level || '—')}</span></td>
      <td class="px-3 py-2.5 text-gray-700 truncate max-w-[150px]" title="${esc(preview)}">${esc(item.topic || '—')}<div class="text-[10px] text-gray-400 truncate">${esc(preview)}</div></td>
      <td class="px-3 py-2.5 text-center" onclick="event.stopPropagation()">
        <div class="flex items-center justify-center gap-2">
          <button onclick="editBankQuestion('${esc(item.id)}')" class="text-brand hover:text-brand-light p-1" title="Chỉnh sửa">✏️</button>
          <button onclick="deleteBankQuestion('${esc(item.id)}','${state.bankActiveSkill}')" class="text-red-400 hover:text-red-600 p-1" title="Xóa">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function getListeningFieldsHtml(q = {}) {
  return `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs font-bold text-gray-500 mb-1">Mã câu hỏi (ID) <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-id" value="${escHtml(q.id || '')}" placeholder="Tự động nếu trống" ${q.id ? 'readonly' : ''} class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand ${q.id ? 'bg-gray-50 text-gray-400' : ''}">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 mb-1">Cấp độ (Level) <span class="text-red-500">*</span></label>
        <select id="form-q-level" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-brand">
          ${['A1','A2','B1','B2','C1','C2'].map(lvl => `<option value="${lvl}" ${q.level === lvl ? 'selected' : ''}>${lvl}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Chủ đề (Topic)</label>
      <input type="text" id="form-q-topic" value="${escHtml(q.topic || '')}" placeholder="Ví dụ: Client Meeting" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Tên file Audio (không gồm .mp3) <span class="text-red-500">*</span></label>
      <div class="flex gap-2">
        <input type="text" id="form-q-audiofile" value="${escHtml(q.audioFile || '')}" placeholder="Ví dụ: listening_b1_01" class="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
        <label class="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-xl text-xs font-bold cursor-pointer transition flex items-center gap-1.5 shadow-sm border border-gray-200 dark:border-slate-700">
          <span>🎵 Tải lên MP3</span>
          <input type="file" id="form-q-audio-upload" accept=".mp3" class="hidden" onchange="uploadAudioFile(this)">
        </label>
      </div>
      <div id="audio-upload-status" class="text-[10px] text-gray-400 mt-1 hidden"></div>
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Nội dung Audio / Script</label>
      <textarea id="form-q-audio" rows="3" placeholder="Nhập transcript hoặc mô tả audio..." class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">${escHtml(q.audio || '')}</textarea>
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Câu hỏi (Question) <span class="text-red-500">*</span></label>
      <input type="text" id="form-q-question" value="${escHtml(q.question || '')}" placeholder="Ví dụ: What is the speaker's main point?" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
    </div>
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs font-bold text-gray-400 mb-0.5">Lựa chọn A <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-opt-0" value="${escHtml(q.options?.[0] || '')}" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-400 mb-0.5">Lựa chọn B <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-opt-1" value="${escHtml(q.options?.[1] || '')}" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-400 mb-0.5">Lựa chọn C <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-opt-2" value="${escHtml(q.options?.[2] || '')}" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-400 mb-0.5">Lựa chọn D <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-opt-3" value="${escHtml(q.options?.[3] || '')}" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Đáp án đúng <span class="text-red-500">*</span></label>
      <select id="form-q-correct" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-brand">
        <option value="0" ${q.correct === 0 ? 'selected' : ''}>A</option>
        <option value="1" ${q.correct === 1 ? 'selected' : ''}>B</option>
        <option value="2" ${q.correct === 2 ? 'selected' : ''}>C</option>
        <option value="3" ${q.correct === 3 ? 'selected' : ''}>D</option>
      </select>
    </div>
  `;
}

function getReadingFieldsHtml(q = {}) {
  return `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs font-bold text-gray-500 mb-1">Mã câu hỏi (ID) <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-id" value="${escHtml(q.id || '')}" placeholder="Tự động nếu trống" ${q.id ? 'readonly' : ''} class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand ${q.id ? 'bg-gray-50 text-gray-400' : ''}">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 mb-1">Cấp độ (Level) <span class="text-red-500">*</span></label>
        <select id="form-q-level" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-brand">
          ${['A1','A2','B1','B2','C1','C2'].map(lvl => `<option value="${lvl}" ${q.level === lvl ? 'selected' : ''}>${lvl}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Chủ đề (Topic)</label>
      <input type="text" id="form-q-topic" value="${escHtml(q.topic || '')}" placeholder="Ví dụ: Travel Industry" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Đoạn văn đọc hiểu (Passage) <span class="text-red-500">*</span></label>
      <textarea id="form-q-passage" rows="6" placeholder="Nhập văn bản đọc hiểu..." class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">${escHtml(q.passage || '')}</textarea>
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Câu hỏi (Question) <span class="text-red-500">*</span></label>
      <input type="text" id="form-q-question" value="${escHtml(q.question || '')}" placeholder="Ví dụ: According to the passage, why..." class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
    </div>
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs font-bold text-gray-400 mb-0.5">Lựa chọn A <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-opt-0" value="${escHtml(q.options?.[0] || '')}" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-400 mb-0.5">Lựa chọn B <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-opt-1" value="${escHtml(q.options?.[1] || '')}" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-400 mb-0.5">Lựa chọn C <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-opt-2" value="${escHtml(q.options?.[2] || '')}" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-400 mb-0.5">Lựa chọn D <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-opt-3" value="${escHtml(q.options?.[3] || '')}" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Đáp án đúng <span class="text-red-500">*</span></label>
      <select id="form-q-correct" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-brand">
        <option value="0" ${q.correct === 0 ? 'selected' : ''}>A</option>
        <option value="1" ${q.correct === 1 ? 'selected' : ''}>B</option>
        <option value="2" ${q.correct === 2 ? 'selected' : ''}>C</option>
        <option value="3" ${q.correct === 3 ? 'selected' : ''}>D</option>
      </select>
    </div>
  `;
}

function getWritingFieldsHtml(q = {}, selectedType = '') {
  const type = selectedType || q.type || 'fill_blank';
  
  let subfieldsHtml = '';
  if (type === 'fill_blank') {
    subfieldsHtml = `
      <div class="mb-3">
        <label class="block text-xs font-bold text-gray-500 mb-1">Đoạn văn có chỗ trống (Passage) <span class="text-red-500">*</span></label>
        <p class="text-[10px] text-gray-400 mb-1">Dùng ___1___, ___2___, ... cho các chỗ trống cần điền.</p>
        <textarea id="form-q-passage" rows="4" placeholder="Ví dụ: Dear Guest, Thank you for your ___1___." class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">${escHtml(q.passage || '')}</textarea>
      </div>
      <div class="mb-3">
        <label class="block text-xs font-bold text-gray-500 mb-1">Danh sách lựa chọn nhiễu (Options)</label>
        <p class="text-[10px] text-gray-400 mb-1">Các từ gợi ý, cách nhau bởi dấu gạch đứng (|)</p>
        <input type="text" id="form-q-options" value="${escHtml((q.options || []).join('|'))}" placeholder="Ví dụ: reservation|confirmed|cancel" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
      <div class="mb-3">
        <label class="block text-xs font-bold text-gray-500 mb-1">Đáp án cho các chỗ trống (Blanks)</label>
        <p class="text-[10px] text-gray-400 mb-1">Format: số_thứ_tự=từ_đúng, phân cách bởi dấu (|)</p>
        <input type="text" id="form-q-blanks" value="${escHtml(Object.entries(q.blanks || {}).map(([k,v]) => `${k}=${v}`).join('|'))}" placeholder="Ví dụ: 1=reservation|2=confirmed" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
    `;
  } else if (type === 'error_correction') {
    subfieldsHtml = `
      <div class="space-y-3">
        <div class="text-xs font-bold text-gray-500 border-b border-gray-100 pb-1">Danh sách câu cần sửa (Tối đa 3 câu)</div>
        ${[0, 1, 2].map(idx => {
          const s = q.sentences?.[idx] || {};
          return `
            <div class="p-3 bg-gray-50 rounded-xl border border-gray-150 space-y-2">
              <div class="font-semibold text-gray-600 text-[11px]">Câu ${idx + 1}</div>
              <div>
                <label class="block text-[10px] text-gray-400 mb-0.5">Câu sai gốc</label>
                <input type="text" id="form-q-err-orig-${idx}" value="${escHtml(s.original || '')}" placeholder="Ví dụ: The client want to cancel..." class="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
              </div>
              <div class="grid grid-cols-3 gap-2">
                <div>
                  <label class="block text-[10px] text-gray-400 mb-0.5">Lựa chọn A</label>
                  <input type="text" id="form-q-err-opt-${idx}-0" value="${escHtml(s.options?.[0] || '')}" class="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white">
                </div>
                <div>
                  <label class="block text-[10px] text-gray-400 mb-0.5">Lựa chọn B</label>
                  <input type="text" id="form-q-err-opt-${idx}-1" value="${escHtml(s.options?.[1] || '')}" class="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white">
                </div>
                <div>
                  <label class="block text-[10px] text-gray-400 mb-0.5">Lựa chọn C</label>
                  <input type="text" id="form-q-err-opt-${idx}-2" value="${escHtml(s.options?.[2] || '')}" class="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white">
                </div>
              </div>
              <div>
                <label class="block text-[10px] text-gray-400 mb-0.5">Đáp án đúng</label>
                <select id="form-q-err-correct-${idx}" class="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white">
                  <option value="0" ${s.correct === 0 ? 'selected' : ''}>A</option>
                  <option value="1" ${s.correct === 1 ? 'selected' : ''}>B</option>
                  <option value="2" ${s.correct === 2 ? 'selected' : ''}>C</option>
                </select>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if (type === 'sentence_order') {
    subfieldsHtml = `
      <div class="space-y-2">
        <label class="block text-xs font-bold text-gray-500">Danh sách các câu (5 câu) <span class="text-red-500">*</span></label>
        ${[0, 1, 2, 3, 4].map(idx => `
          <div class="flex gap-2 items-center">
            <span class="text-xs font-mono text-gray-400 w-4">${idx + 1}:</span>
            <input type="text" id="form-q-order-s-${idx}" value="${escHtml(q.sentences?.[idx] || '')}" placeholder="Nhập câu thứ ${idx + 1}" class="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs">
          </div>
        `).join('')}
        <div class="mt-2">
          <label class="block text-xs font-bold text-gray-500 mb-1">Thứ tự đúng <span class="text-red-500">*</span></label>
          <input type="text" id="form-q-correct-order" value="${escHtml((q.correct_order || []).join(','))}" placeholder="Ví dụ: 1,3,0,2,4" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
        </div>
      </div>
    `;
  } else if (type === 'sentence_transform') {
    subfieldsHtml = `
      <div class="space-y-3">
        <div class="text-xs font-bold text-gray-500 border-b border-gray-100 pb-1">Biến đổi câu (Tối đa 3 câu)</div>
        ${[0, 1, 2].map(idx => {
          const s = q.sentences?.[idx] || {};
          return `
            <div class="p-3 bg-gray-50 rounded-xl border border-gray-150 space-y-2">
              <div class="font-semibold text-gray-600 text-[11px]">Câu ${idx + 1}</div>
              <div>
                <label class="block text-[10px] text-gray-400 mb-0.5">Câu gốc</label>
                <input type="text" id="form-q-trans-orig-${idx}" value="${escHtml(s.original || '')}" placeholder="Ví dụ: We will delay the project." class="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
              </div>
              <div>
                <label class="block text-[10px] text-gray-400 mb-0.5">Từ gợi ý (Keyword)</label>
                <input type="text" id="form-q-trans-kw-${idx}" value="${escHtml(s.keyword || '')}" placeholder="Ví dụ: PUT" class="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-bold text-gray-700">
              </div>
              <div>
                <label class="block text-[10px] text-gray-400 mb-0.5">Đáp án chấp nhận (Cách nhau bởi |)</label>
                <input type="text" id="form-q-trans-accept-${idx}" value="${escHtml((s.accept || []).join('|'))}" placeholder="Ví dụ: We will put off the project.|We will put off the project" class="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs font-bold text-gray-500 mb-1">Mã câu hỏi (ID) <span class="text-red-500">*</span></label>
        <input type="text" id="form-q-id" value="${escHtml(q.id || '')}" placeholder="Tự động nếu trống" ${q.id ? 'readonly' : ''} class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand ${q.id ? 'bg-gray-50 text-gray-400' : ''}">
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 mb-1">Cấp độ (Level) <span class="text-red-500">*</span></label>
        <select id="form-q-level" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-brand">
          ${['A1','A2','B1','B2','C1','C2'].map(lvl => `<option value="${lvl}" ${q.level === lvl ? 'selected' : ''}>${lvl}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs font-bold text-gray-500 mb-1">Loại Writing <span class="text-red-500">*</span></label>
        <select id="form-q-type" onchange="onWritingTypeChange(this.value)" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:border-brand">
          <option value="fill_blank" ${type === 'fill_blank' ? 'selected' : ''}>Điền từ vào chỗ trống</option>
          <option value="error_correction" ${type === 'error_correction' ? 'selected' : ''}>Sửa lỗi sai</option>
          <option value="sentence_order" ${type === 'sentence_order' ? 'selected' : ''}>Sắp xếp câu</option>
          <option value="sentence_transform" ${type === 'sentence_transform' ? 'selected' : ''}>Viết lại câu</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 mb-1">Chủ đề (Topic)</label>
        <input type="text" id="form-q-topic" value="${escHtml(q.topic || '')}" placeholder="Ví dụ: Customer Service" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
      </div>
    </div>
    <div class="mb-3">
      <label class="block text-xs font-bold text-gray-500 mb-1">Hướng dẫn (Instruction) <span class="text-red-500">*</span></label>
      <input type="text" id="form-q-instruction" value="${escHtml(q.instruction || 'Complete with correct words.')}" placeholder="Ví dụ: Complete the email with correct words." class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-brand">
    </div>
    <div id="writing-subfields">
      ${subfieldsHtml}
    </div>
  `;
}

function onWritingTypeChange(val) {
  let q = {};
  if (editingQuestionId) {
    const origQ = bankQuestionsList.find(item => item.id === editingQuestionId);
    if (origQ && origQ.type === val) {
      q = origQ;
    }
  }
  
  const subfields = document.getElementById('writing-subfields');
  if (subfields) {
    const fullHtml = getWritingFieldsHtml(q, val);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = fullHtml;
    const newSubfields = tempDiv.querySelector('#writing-subfields');
    if (newSubfields) {
      subfields.innerHTML = newSubfields.innerHTML;
    }
  }
}

function resetBankForm() {
  editingQuestionId = null;
  
  const badge = document.getElementById('form-mode-badge');
  if (badge) {
    badge.textContent = 'Thêm mới';
    badge.className = 'px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md text-[10px] uppercase font-bold';
  }
  
  const title = document.getElementById('form-title-text');
  if (title) {
    title.textContent = 'Tạo câu hỏi thủ công';
  }

  const container = document.getElementById('bankFormFields');
  if (container && state.bankActiveSkill) {
    if (state.bankActiveSkill === 'listening') {
      container.innerHTML = getListeningFieldsHtml({});
    } else if (state.bankActiveSkill === 'reading') {
      container.innerHTML = getReadingFieldsHtml({});
    } else if (state.bankActiveSkill === 'writing') {
      container.innerHTML = getWritingFieldsHtml({});
    }
  }
  
  filterBankList();
}

function editBankQuestion(id) {
  const q = bankQuestionsList.find(item => item.id === id);
  if (!q) return;
  
  editingQuestionId = id;
  
  const badge = document.getElementById('form-mode-badge');
  if (badge) {
    badge.textContent = 'Chỉnh sửa';
    badge.className = 'px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md text-[10px] uppercase font-bold';
  }
  
  const title = document.getElementById('form-title-text');
  if (title) {
    title.textContent = `Chỉnh sửa: ${id}`;
  }

  const container = document.getElementById('bankFormFields');
  if (container) {
    if (state.bankActiveSkill === 'listening') {
      container.innerHTML = getListeningFieldsHtml(q);
    } else if (state.bankActiveSkill === 'reading') {
      container.innerHTML = getReadingFieldsHtml(q);
    } else if (state.bankActiveSkill === 'writing') {
      container.innerHTML = getWritingFieldsHtml(q);
    }
  }

  filterBankList();
}

function getQuestionFromForm() {
  const skill = state.bankActiveSkill;
  const id = document.getElementById('form-q-id')?.value.trim();
  const level = document.getElementById('form-q-level')?.value;
  const topic = document.getElementById('form-q-topic')?.value.trim();

  const question = { id, level, topic };

  if (skill === 'listening') {
    question.audioFile = document.getElementById('form-q-audiofile')?.value.trim();
    question.audio = document.getElementById('form-q-audio')?.value.trim();
    question.question = document.getElementById('form-q-question')?.value.trim();
    question.options = [
      document.getElementById('form-q-opt-0')?.value.trim(),
      document.getElementById('form-q-opt-1')?.value.trim(),
      document.getElementById('form-q-opt-2')?.value.trim(),
      document.getElementById('form-q-opt-3')?.value.trim()
    ].filter(Boolean);
    question.correct = parseInt(document.getElementById('form-q-correct')?.value) || 0;
  } else if (skill === 'reading') {
    question.passage = document.getElementById('form-q-passage')?.value.trim();
    question.question = document.getElementById('form-q-question')?.value.trim();
    question.options = [
      document.getElementById('form-q-opt-0')?.value.trim(),
      document.getElementById('form-q-opt-1')?.value.trim(),
      document.getElementById('form-q-opt-2')?.value.trim(),
      document.getElementById('form-q-opt-3')?.value.trim()
    ].filter(Boolean);
    question.correct = parseInt(document.getElementById('form-q-correct')?.value) || 0;
  } else if (skill === 'writing') {
    const type = document.getElementById('form-q-type')?.value;
    question.type = type;
    question.instruction = document.getElementById('form-q-instruction')?.value.trim();
    
    if (type === 'fill_blank') {
      question.passage = document.getElementById('form-q-passage')?.value.trim();
      const optsVal = document.getElementById('form-q-options')?.value.trim();
      question.options = optsVal ? optsVal.split('|').map(s => s.trim()).filter(Boolean) : [];
      
      const blanksVal = document.getElementById('form-q-blanks')?.value.trim();
      question.blanks = {};
      if (blanksVal) {
        blanksVal.split('|').forEach(pair => {
          const parts = pair.split('=');
          if (parts[0] && parts[1]) {
            question.blanks[parts[0].trim()] = parts[1].trim();
          }
        });
      }
    } else if (type === 'error_correction') {
      question.sentences = [];
      for (let i = 0; i < 3; i++) {
        const orig = document.getElementById(`form-q-err-orig-${i}`)?.value.trim();
        if (!orig) continue;
        const opts = [
          document.getElementById(`form-q-err-opt-${i}-0`)?.value.trim(),
          document.getElementById(`form-q-err-opt-${i}-1`)?.value.trim(),
          document.getElementById(`form-q-err-opt-${i}-2`)?.value.trim()
        ].filter(Boolean);
        const correct = parseInt(document.getElementById(`form-q-err-correct-${i}`)?.value) || 0;
        question.sentences.push({ original: orig, options: opts, correct });
      }
    } else if (type === 'sentence_order') {
      question.sentences = [];
      for (let i = 0; i < 5; i++) {
        const s = document.getElementById(`form-q-order-s-${i}`)?.value.trim();
        if (s) question.sentences.push(s);
      }
      const orderVal = document.getElementById('form-q-correct-order')?.value.trim();
      question.correct_order = orderVal ? orderVal.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) : [];
    } else if (type === 'sentence_transform') {
      question.sentences = [];
      for (let i = 0; i < 3; i++) {
        const orig = document.getElementById(`form-q-trans-orig-${i}`)?.value.trim();
        if (!orig) continue;
        const kw = document.getElementById(`form-q-trans-kw-${i}`)?.value.trim();
        const acceptVal = document.getElementById(`form-q-trans-accept-${i}`)?.value.trim();
        const accept = acceptVal ? acceptVal.split('|').map(s => s.trim()).filter(Boolean) : [];
        question.sentences.push({ original: orig, keyword: kw, accept });
      }
    }
  }

  return question;
}

async function saveBankQuestion() {
  const skill = state.bankActiveSkill;
  if (!skill) return;
  
  const question = getQuestionFromForm();
  
  if (!question.id && editingQuestionId) {
    alert('Không tìm thấy ID câu hỏi.');
    return;
  }
  
  if (skill === 'listening' && (!question.audioFile || !question.question || question.options.length < 2)) {
    alert('Vui lòng điền đầy đủ: Mã câu hỏi, File audio, Câu hỏi và ít nhất 2 Lựa chọn.');
    return;
  }
  if (skill === 'reading' && (!question.passage || !question.question || question.options.length < 2)) {
    alert('Vui lòng điền đầy đủ: Mã câu hỏi, Đoạn văn, Câu hỏi và ít nhất 2 Lựa chọn.');
    return;
  }
  if (skill === 'writing') {
    if (!question.instruction) {
      alert('Vui lòng điền hướng dẫn làm bài.');
      return;
    }
    if (question.type === 'fill_blank' && (!question.passage || Object.keys(question.blanks).length === 0)) {
      alert('Vui lòng nhập đoạn văn có ô trống và danh sách đáp án đúng (ví dụ: 1=word).');
      return;
    }
    if (question.type === 'sentence_order' && (question.sentences.length < 2 || question.correct_order.length === 0)) {
      alert('Vui lòng nhập các câu và thứ tự sắp xếp đúng.');
      return;
    }
  }

  const isEdit = !!editingQuestionId;
  const url = isEdit ? `/admin/api/bank/questions/${editingQuestionId}` : '/admin/api/bank/questions';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const payload = {
      skill,
      question,
      bank: 'BANK_STAFF'
    };
    
    const r = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const res = await r.json();
    if (!r.ok || res.error) {
      throw new Error(res.message || res.error || 'Lưu thất bại');
    }
    
    alert(isEdit ? 'Cập nhật câu hỏi thành công!' : 'Thêm câu hỏi mới thành công!');
    await loadBankSummary();
    
    if (!isEdit) {
      resetBankForm();
    } else {
      await loadBankQuestions();
      editBankQuestion(editingQuestionId);
    }
  } catch(e) {
    alert('Lỗi: ' + e.message);
  }
}

function downloadTemplate(skill){
  window.open(`/admin/api/bank/export-template?skill=${skill}`,'_blank');
}

function downloadActiveTemplate() {
  if (state.bankActiveSkill) {
    downloadTemplate(state.bankActiveSkill);
  }
}

async function importExcel(input,skill){
  const file=input.files[0];
  if(!file)return;
  const el=document.getElementById('importResult');
  el.innerHTML='<div class="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700">⏳ Đang import…</div>';
  el.classList.remove('hidden');
  try{
    const buf=await file.arrayBuffer();
    const r=await fetch(`/admin/api/bank/import?skill=${skill}`,{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/octet-stream'},
      body:buf,
    });
    const j=await r.json();
    if(j.ok){
      el.innerHTML=`<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-700">
        ✅ Import thành công: <strong>${j.imported}</strong> câu hỏi mới
        ${j.errors.length?`<br>⚠️ ${j.errors.length} lỗi: ${j.errors.slice(0,3).join(', ')}`:''}
      </div>`;
      await loadBankSummary();
    }else{
      el.innerHTML=`<div class="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700">❌ ${j.message||j.error}</div>`;
    }
  }catch(e){
    el.innerHTML=`<div class="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700">❌ ${e.message}</div>`;
  }
  input.value='';
}

async function importActiveExcel(input) {
  if (state.bankActiveSkill) {
    await importExcel(input, state.bankActiveSkill);
  }
}

async function uploadAudioFile(input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('audio-upload-status');
  if (statusEl) {
    statusEl.textContent = 'Đang tải lên...';
    statusEl.className = 'text-[10px] text-brand font-bold mt-1';
    statusEl.classList.remove('hidden');
  }

  try {
    const url = `/admin/api/bank/upload-audio?filename=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Tải lên thất bại');
    }

    const res = await response.json();
    
    const audioInput = document.getElementById('form-q-audiofile');
    if (audioInput) {
      audioInput.value = res.filename;
    }

    if (statusEl) {
      statusEl.textContent = '✅ Tải lên thành công: ' + res.filename + '.mp3';
      statusEl.className = 'text-[10px] text-emerald-600 font-bold mt-1';
    }
  } catch (err) {
    console.error('Upload failed:', err);
    if (statusEl) {
      statusEl.textContent = '❌ Lỗi: ' + err.message;
      statusEl.className = 'text-[10px] text-red-500 font-bold mt-1';
    }
  }
}

async function deleteBankQuestion(id,skill){
  if(!confirm(`Xóa câu hỏi ${id}?`))return;
  try{
    await api(`/admin/api/bank/questions/${id}?skill=${skill}`,{method:'DELETE'});
    await loadBankSummary();
  }catch(e){alert(e.message);}
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
  updateChartDefaults(isDark);
  if(window._statsData){
    // Force a rebuild so axis/grid colors switch with the theme.
    if(_cefrChart){_cefrChart.destroy();_cefrChart=null;}
    if(_reportChart){_reportChart.destroy();_reportChart=null;}
    loadDashboardCharts();
    loadReport();
  }
}
function updateChartDefaults(isDark){
  if(typeof Chart !== 'undefined'){
    Chart.defaults.color=isDark?'#94A3B8':'#6B7280';
    Chart.defaults.borderColor=isDark?'rgba(255, 255, 255, 0.08)':'rgba(241, 245, 249, 0.8)';
  }
}

// ── Exam Configuration functions ────────────────────────────
let examConfigOptions = null;

async function loadExamConfigs() {
  const msgEl = document.getElementById('config-status-msg');
  if (msgEl) msgEl.classList.add('hidden');
  
  try {
    const data = await api('/admin/api/exam-config');
    examConfigOptions = data.options;
    
    bindConfigDropdowns('staff', data.options.staff);
    bindConfigDropdowns('manager', data.options.manager);
    
    (data.configs || []).forEach(c => {
      const pos = c.position;
      const typeSel = document.getElementById(`config-type-${pos}`);
      if (typeSel) {
        typeSel.value = c.config_type;
        toggleConfigForm(pos);
      }
      
      const audioSel = document.getElementById(`config-audio-${pos}`);
      if (audioSel && c.selected_audio) audioSel.value = c.selected_audio;
      
      const passageSel = document.getElementById(`config-passage-${pos}`);
      if (passageSel && c.selected_passage) passageSel.value = c.selected_passage;
      
      const writingSel = document.getElementById(`config-writing-${pos}`);
      if (writingSel && c.selected_writing) writingSel.value = c.selected_writing;
    });
  } catch (err) {
    showConfigMessage('Lỗi tải cấu hình đề thi: ' + err.message, 'bg-rose-50 text-rose-700 border border-rose-200');
  }
}

function bindConfigDropdowns(position, options) {
  const audioSel = document.getElementById(`config-audio-${position}`);
  const passageSel = document.getElementById(`config-passage-${position}`);
  const writingSel = document.getElementById(`config-writing-${position}`);
  
  if (audioSel) {
    audioSel.innerHTML = (options.listening || []).map(o => 
      `<option value="${escHtml(o.audioFile)}">${escHtml(o.topic)} (${escHtml(o.audioFile)}) - [${o.count || 0} câu hỏi]</option>`
    ).join('') || '<option value="">-- Không có sẵn --</option>';
  }
  
  if (passageSel) {
    passageSel.innerHTML = (options.reading || []).map(o => 
      `<option value="${escHtml(o.passageId)}">${escHtml(o.topic)} (${escHtml(o.passageId)}) - [${o.count || 0} câu hỏi]</option>`
    ).join('') || '<option value="">-- Không có sẵn --</option>';
  }
  
  if (writingSel) {
    writingSel.innerHTML = (options.writing || []).map(o => 
      `<option value="${escHtml(o.id)}">[${escHtml(o.level)}] ${escHtml(o.topic)} (${escHtml(o.type)})</option>`
    ).join('') || '<option value="">-- Không có sẵn --</option>';
  }
}

function toggleConfigForm(position) {
  const typeSel = document.getElementById(`config-type-${position}`);
  if (!typeSel) return;
  const val = typeSel.value;
  const form = document.getElementById(`fixed-form-${position}`);
  if (form) {
    if (val === 'fixed') form.classList.remove('hidden');
    else form.classList.add('hidden');
  }
}

async function saveExamConfig(position) {
  const type = document.getElementById(`config-type-${position}`).value;
  const audio = document.getElementById(`config-audio-${position}`).value;
  const passage = document.getElementById(`config-passage-${position}`).value;
  const writing = document.getElementById(`config-writing-${position}`).value;
  
  const payload = {
    position,
    config_type: type,
    selected_audio: type === 'fixed' ? audio : null,
    selected_passage: type === 'fixed' ? passage : null,
    selected_writing: type === 'fixed' ? writing : null
  };
  
  try {
    await api('/admin/api/exam-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    showConfigMessage(`Lưu cấu hình đề thi cho vị trí [${position === 'staff' ? 'Nhân viên' : 'Quản lý'}] thành công!`, 'bg-emerald-50 text-emerald-700 border border-emerald-200');
  } catch (err) {
    showConfigMessage(`Lỗi lưu cấu hình vị trí ${position}: ` + err.message, 'bg-rose-50 text-rose-700 border border-rose-200');
  }
}

function showConfigMessage(msg, classes) {
  const msgEl = document.getElementById('config-status-msg');
  if (!msgEl) return;
  msgEl.className = `mt-6 p-4 rounded-xl text-xs fade-in ${classes}`;
  msgEl.textContent = msg;
  msgEl.classList.remove('hidden');
  setTimeout(() => msgEl.classList.add('hidden'), 5000);
}

// ── Live auto-refresh (always on) ──────────────────────────
const LIVE_REFRESH_MS = 15000;
let liveRefreshInterval = null;

async function liveRefreshTick() {
  if (document.hidden) return; // pause polling while the tab is in the background
  try {
    const activeTab = localStorage.getItem('admin_active_tab') || 'dashboard';
    if (activeTab === 'dashboard') {
      await refreshStats();
      loadDashboardCharts();
      await loadReport(); // self-guards to Quản lý+
    } else if (activeTab === 'sessions') {
      await refreshList();
    } else if (activeTab === 'tools') {
      await loadInvitations();
    }
  } catch (e) {
    console.error('Live refresh error:', e);
  }
}

function startLiveRefresh() {
  if (liveRefreshInterval) return;
  liveRefreshInterval = setInterval(liveRefreshTick, LIVE_REFRESH_MS);
  // Refresh immediately when the user returns to the tab.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) liveRefreshTick(); });
}

// ── Bulk Invitations Upload Logic ──────────────────────────
async function uploadBulkInvitations(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const el = document.getElementById('invBulkResult');
  if (!el) return;
  el.className = 'mt-3 p-4 border border-blue-200 bg-blue-50 rounded-xl text-xs text-blue-800';
  el.innerHTML = '⌛ Đang tải lên và xử lý tệp Excel...';
  el.classList.remove('hidden');

  try {
    const buffer = await file.arrayBuffer();
    const response = await fetch('/admin/api/invitations/bulk', {
      method: 'POST',
      body: buffer,
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    });

    const res = await response.json();
    if (!response.ok) {
      throw new Error(res.message || res.error || 'Tải tệp thất bại.');
    }

    let html = `<div class="font-bold text-emerald-700 mb-1">🎉 Đã tạo thành công ${res.createdCount} link mời thi!</div>`;
    if (res.errors && res.errors.length > 0) {
      html += `<div class="text-[10px] text-amber-700 mt-2 font-semibold">⚠️ Các dòng gặp lỗi:</div>
               <ul class="list-disc pl-4 text-[10px] text-amber-600 max-h-[100px] overflow-y-auto mt-1">
                 ${res.errors.map(err => `<li>${escHtml(err)}</li>`).join('')}
               </ul>`;
      el.className = 'mt-3 p-4 border border-amber-200 bg-amber-50 rounded-xl text-xs';
    } else {
      el.className = 'mt-3 p-4 border border-emerald-200 bg-emerald-50 rounded-xl text-xs';
    }
    el.innerHTML = html;
    loadInvitations();
  } catch (err) {
    console.error('Bulk invite upload failed:', err);
    el.className = 'mt-3 p-4 border border-rose-200 bg-rose-50 rounded-xl text-xs text-rose-700';
    el.innerHTML = `❌ Lỗi: ${escHtml(err.message)}`;
  }
}

// ── User Management Logic ──────────────────────────────────
const ROLE_BADGE={admin:'🛡️ Admin',manager:'🧭 Quản lý',staff:'👥 Nhân viên'};

async function loadUsers() {
  // Visibility of admin-only / restricted sections is handled by applyRolePermissions().
  if (!hasRole('admin')) return;

  try {
    const res = await api('/admin/api/users');
    const tbody = document.getElementById('userListRows');
    if (!tbody) return;

    if (!res.users || res.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-gray-400">Không có tài khoản nào</td></tr>';
      return;
    }

    tbody.innerHTML = res.users.map(u => {
      const roleText = ROLE_BADGE[u.role] || u.role;
      const isSelf = state.me && state.me.username === u.username;
      const deleteBtn = isSelf 
        ? '<span class="text-gray-400 italic">Hiện tại</span>' 
        : `<button onclick="deleteUserAccount(${u.id}, '${escHtml(u.username)}')" class="px-2 py-1 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition">Xóa</button>`;

      return `<tr class="border-b border-gray-100 hover:bg-slate-50/50">
        <td class="px-3 py-2.5 font-semibold text-gray-800">${escHtml(u.username)}</td>
        <td class="px-3 py-2.5 text-gray-600">${escHtml(u.display_name || '—')}</td>
        <td class="px-3 py-2.5 text-center font-bold">${roleText}</td>
        <td class="px-3 py-2.5 text-center">${deleteBtn}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

async function createUserAccount() {
  const usernameInput = document.getElementById('setUserUsername');
  const displayNameInput = document.getElementById('setUserDisplayName');
  const passwordInput = document.getElementById('setUserPassword');
  const roleSelect = document.getElementById('setUserRole');
  const resultEl = document.getElementById('createUserResult');

  if (!usernameInput || !displayNameInput || !passwordInput || !roleSelect || !resultEl) return;

  const username = usernameInput.value.trim();
  const displayName = displayNameInput.value.trim();
  const password = passwordInput.value.trim();
  const role = roleSelect.value;

  if (!username || !displayName || !password || !role) {
    resultEl.className = 'mt-3 text-xs text-red-500 font-bold';
    resultEl.textContent = '❌ Vui lòng điền đầy đủ các thông tin bắt buộc.';
    resultEl.classList.remove('hidden');
    return;
  }

  const pwErr = clientPwError(password);
  if (pwErr) {
    resultEl.className = 'mt-3 text-xs text-red-500 font-bold';
    resultEl.textContent = '❌ ' + pwErr;
    resultEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await api('/admin/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password, role })
    });

    if (res.ok) {
      resultEl.className = 'mt-3 text-xs text-emerald-600 font-bold';
      resultEl.textContent = '✅ Đã tạo tài khoản thành công!';
      resultEl.classList.remove('hidden');

      usernameInput.value = '';
      displayNameInput.value = '';
      passwordInput.value = '';

      loadUsers();
      setTimeout(() => resultEl.classList.add('hidden'), 3000);
    }
  } catch (err) {
    resultEl.className = 'mt-3 text-xs text-red-500 font-bold';
    resultEl.textContent = '❌ Lỗi: ' + err.message;
    resultEl.classList.remove('hidden');
  }
}

async function deleteUserAccount(id, name) {
  if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản "${name}" vĩnh viễn không?`)) return;
  try {
    const res = await api(`/admin/api/users/${id}`, { method: 'DELETE' });
    if (res.ok) {
      loadUsers();
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// ── Export Period Report Logic ─────────────────────────────
function exportReportXlsx() {
  // kept for Excel export (green button)
  if(!hasRole('manager')) return;
  const type = document.getElementById('reportType')?.value || 'daily';
  window.location.href = `/admin/api/report/export.xlsx?type=${type}`;
}

function exportReportPdf() {
  if(!hasRole('manager')) return;
  const type = document.getElementById('reportType')?.value || 'daily';
  // Trigger direct file download — no popup window
  const btn = document.querySelector('[onclick="exportReportPdf()"]');
  const origHTML = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px"><svg style="animation:spin .9s linear infinite;width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Đang tạo PDF…</span>';
  }
  const a = document.createElement('a');
  a.href = `/admin/api/report/export.pdf?type=${type}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Restore button after delay
  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHTML || '📄 Xuất PDF';
    }
  }, 8000);
}

// ── Audit Log (Admin only) ─────────────────────────────────
async function loadAuditLog() {
  if (!hasRole('admin')) return;
  const tbody = document.getElementById('auditLogRows');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-gray-400">Đang tải…</td></tr>';
  try {
    const res = await api('/admin/api/audit?limit=200');
    const rows = res.rows || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-gray-400">Chưa có hoạt động nào.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      let detail = '';
      if (r.target) detail += esc(r.target);
      if (r.detail) detail += `<span class="text-gray-400 dark:text-slate-500"> · ${esc(r.detail)}</span>`;
      return `<tr class="border-b border-gray-50 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
        <td class="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">${fmtDate(r.ts)}</td>
        <td class="px-3 py-2 whitespace-nowrap font-semibold text-gray-700 dark:text-slate-200">${esc(r.actor || '—')}</td>
        <td class="px-3 py-2 whitespace-nowrap"><span class="font-mono text-[11px] text-brand dark:text-brand-light">${esc(r.action)}</span></td>
        <td class="px-3 py-2 text-gray-600 dark:text-slate-300">${detail || '—'}</td>
        <td class="px-3 py-2 whitespace-nowrap text-gray-400 dark:text-slate-500 font-mono text-[11px]">${esc(r.ip_address || '—')}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-red-500">❌ ${esc(err.message)}</td></tr>`;
  }
}

bootstrap();
