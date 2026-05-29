const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../../lib/db');
const { adminRequired, requireRole } = require('../../lib/auth');

const router = express.Router();

// ── Report: daily / monthly / quarterly / yearly ───────────
router.get('/report', adminRequired, requireRole('manager'), (req, res) => {
  const type = req.query.type || 'daily';
  const limit = parseInt(req.query.limit || '30', 10);
  let groupFmt;
  if (type === 'yearly')       groupFmt = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime'))";
  else if (type === 'quarterly') groupFmt = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime')) || '-Q' || ((cast(strftime('%m', datetime(started_at/1000,'unixepoch','localtime')) as integer) + 2) / 3)";
  else if (type === 'monthly') groupFmt = "strftime('%Y-%m', datetime(started_at/1000,'unixepoch','localtime'))";
  else                         groupFmt = "strftime('%Y-%m-%d', datetime(started_at/1000,'unixepoch','localtime'))";

  const rows = db.prepare(`
    SELECT ${groupFmt} AS period,
           COUNT(*) AS total,
           SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
           SUM(CASE WHEN cefr_status='pass' THEN 1 ELSE 0 END) AS passed,
           SUM(CASE WHEN cefr_status='review' THEN 1 ELSE 0 END) AS review,
           SUM(CASE WHEN cefr_status='fail' THEN 1 ELSE 0 END) AS failed,
           ROUND(AVG(CASE WHEN status='submitted' THEN score_total END), 1) AS avg_score
      FROM sessions GROUP BY period ORDER BY period DESC LIMIT ?
  `).all(limit);
  res.json({ type, rows: rows.reverse() });
});

// ── GET /report/export.xlsx — Export statistics to Excel ──
router.get('/report/export.xlsx', adminRequired, requireRole('manager'), async (req, res) => {
  const type = req.query.type || 'daily';
  const limit = parseInt(req.query.limit || '100', 10);
  let groupFmt;
  let timeLabel = 'Ngày';
  if (type === 'yearly') {
    groupFmt = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel = 'Năm';
  } else if (type === 'quarterly') {
    groupFmt = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime')) || '-Q' || ((cast(strftime('%m', datetime(started_at/1000,'unixepoch','localtime')) as integer) + 2) / 3)";
    timeLabel = 'Quý';
  } else if (type === 'monthly') {
    groupFmt = "strftime('%Y-%m', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel = 'Tháng';
  } else {
    groupFmt = "strftime('%Y-%m-%d', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel = 'Ngày';
  }

  try {
    const rows = db.prepare(`
      SELECT ${groupFmt} AS period,
             COUNT(*) AS total,
             SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
             SUM(CASE WHEN cefr_status='pass' THEN 1 ELSE 0 END) AS passed,
             SUM(CASE WHEN cefr_status='review' THEN 1 ELSE 0 END) AS review,
             SUM(CASE WHEN cefr_status='fail' THEN 1 ELSE 0 END) AS failed,
             ROUND(AVG(CASE WHEN status='submitted' THEN score_total END), 1) AS avg_score
        FROM sessions GROUP BY period ORDER BY period DESC LIMIT ?
    `).all(limit);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Vietravel HR';
    const ws = wb.addWorksheet('Báo cáo thống kê');

    // Title Row
    ws.addRow([`BÁO CÁO TÌNH HÌNH TUYỂN DỤNG & ĐÁNH GIÁ TIẾNG ANH (Theo ${timeLabel})`]);
    ws.mergeCells('A1:H1');
    ws.getCell('A1').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 40;

    // Blank row
    ws.addRow([]);

    // Headers
    ws.addRow([
      timeLabel,
      'Tổng số ứng viên',
      'Đã nộp bài',
      'Đạt yêu cầu (Pass)',
      'Cần xem xét (Review)',
      'Chưa đạt (Fail)',
      'Tỷ lệ đạt (%)',
      'Điểm trung bình (/30)'
    ]);

    const headerRow = ws.getRow(3);
    headerRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    rows.reverse().forEach(r => {
      const passRate = r.total ? Math.round((r.passed || 0) / r.total * 100) : 0;
      ws.addRow([
        r.period,
        r.total,
        r.submitted || 0,
        r.passed || 0,
        r.review || 0,
        r.failed || 0,
        `${passRate}%`,
        r.avg_score || '—'
      ]);
    });

    // Formatting widths
    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 18;
    ws.getColumn(3).width = 15;
    ws.getColumn(4).width = 20;
    ws.getColumn(5).width = 22;
    ws.getColumn(6).width = 15;
    ws.getColumn(7).width = 15;
    ws.getColumn(8).width = 22;

    // Apply borders and alignment to cells
    ws.eachRow((row, rowNum) => {
      if (rowNum < 3) return;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
        };
        if (cell.col > 1) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bao_cao_nhan_su_${type}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'export_failed', message: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════
// GET /report/export.pdf — Server-side PDF generation via Puppeteer
// ══════════════════════════════════════════════════════════════════
router.get('/report/export.pdf', adminRequired, requireRole('manager'), async (req, res) => {
  const type  = req.query.type  || 'daily';
  const limit = Math.min(parseInt(req.query.limit || '60', 10), 120);

  let groupFmt, timeLabel, periodLabel;
  if (type === 'yearly') {
    groupFmt    = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel   = 'Năm'; periodLabel = 'theo Năm';
  } else if (type === 'quarterly') {
    groupFmt    = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime')) || '-Q' || ((cast(strftime('%m', datetime(started_at/1000,'unixepoch','localtime')) as integer) + 2) / 3)";
    timeLabel   = 'Quý'; periodLabel = 'theo Quý';
  } else if (type === 'monthly') {
    groupFmt    = "strftime('%Y-%m', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel   = 'Tháng'; periodLabel = 'theo Tháng';
  } else {
    groupFmt    = "strftime('%Y-%m-%d', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel   = 'Ngày'; periodLabel = 'theo Ngày';
  }

  try {
    const rows = db.prepare(`
      SELECT ${groupFmt} AS period,
             COUNT(*) AS total,
             SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
             SUM(CASE WHEN cefr_status='pass'   THEN 1 ELSE 0 END) AS passed,
             SUM(CASE WHEN cefr_status='review' THEN 1 ELSE 0 END) AS review,
             SUM(CASE WHEN cefr_status='fail'   THEN 1 ELSE 0 END) AS failed,
             ROUND(AVG(CASE WHEN status='submitted' THEN score_total END), 1) AS avg_score
        FROM sessions GROUP BY period ORDER BY period ASC LIMIT ?
    `).all(limit);

    const totalExams  = rows.reduce((a, r) => a + r.total, 0);
    const totalPass   = rows.reduce((a, r) => a + (r.passed  || 0), 0);
    const totalReview = rows.reduce((a, r) => a + (r.review  || 0), 0);
    const totalFail   = rows.reduce((a, r) => a + (r.failed  || 0), 0);
    const avgScores   = rows.filter(r => r.avg_score).map(r => r.avg_score);
    const overallAvg  = avgScores.length ? (avgScores.reduce((a,b)=>a+b,0)/avgScores.length).toFixed(1) : '—';
    const passRate    = totalExams ? Math.round(totalPass / totalExams * 100) : 0;
    const submitRate  = totalExams ? Math.round(rows.reduce((a,r)=>a+(r.submitted||0),0)/totalExams*100) : 0;

    const nowStr    = new Date().toLocaleDateString('vi-VN', { year:'numeric', month:'long', day:'numeric' });
    const nowFull   = new Date().toLocaleDateString('vi-VN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const periodFrom = rows.length ? rows[0].period : '—';
    const periodTo   = rows.length ? rows[rows.length-1].period : '—';
    const fileName   = `bao-cao-nhan-su-${type}-${new Date().toISOString().slice(0,10)}.pdf`;

    // Recommendation text
    let recommendation = '';
    if (passRate >= 60) {
      recommendation = `Tỷ lệ ứng viên đạt yêu cầu đạt <strong>${passRate}%</strong> — vượt ngưỡng 60%. Chất lượng đầu vào nhân sự đang ổn định tốt. Có thể cân nhắc nâng tiêu chuẩn điểm đầu vào.`;
    } else if (passRate >= 40) {
      recommendation = `Tỷ lệ đạt <strong>${passRate}%</strong> — ở mức trung bình. Khuyến nghị tăng cường định hướng thi đầu vào và cung cấp tài liệu luyện thi tiếng Anh cho ứng viên.`;
    } else {
      recommendation = `Tỷ lệ đạt chỉ <strong>${passRate}%</strong> — dưới ngưỡng kỳ vọng. Cần xem xét điều chỉnh tiêu chí tuyển dụng hoặc rà soát lại độ khó của bài kiểm tra.`;
    }

    const tableRows = rows.slice().reverse().map((r, i) => {
      const pr = r.total ? Math.round((r.passed||0)/r.total*100) : 0;
      const trClass = i % 2 === 0 ? '' : ' class="alt"';
      const badgeClass = pr >= 60 ? 'badge-pass' : pr >= 30 ? 'badge-review' : 'badge-fail';
      return `<tr${trClass}>
        <td class="period">${r.period}</td>
        <td class="num">${r.total}</td>
        <td class="num">${r.submitted||0}</td>
        <td class="num pass">${r.passed||0}</td>
        <td class="num review">${r.review||0}</td>
        <td class="num fail">${r.failed||0}</td>
        <td class="num"><span class="badge ${badgeClass}">${pr}%</span></td>
        <td class="num score">${r.avg_score != null ? r.avg_score : '—'}</td>
      </tr>`;
    }).join('');

    const chartLabels = JSON.stringify(rows.map(r => r.period));
    const chartTotal  = JSON.stringify(rows.map(r => r.total));
    const chartPass   = JSON.stringify(rows.map(r => r.passed||0));
    const chartFail   = JSON.stringify(rows.map(r => r.failed||0));
    const chartAvg    = JSON.stringify(rows.map(r => r.avg_score||null));

    // ── Build the full HTML page ──────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Báo cáo Nhân sự — ${periodLabel}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Be Vietnam Pro',sans-serif;font-size:10pt;color:#1F2937;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:root{--navy:#0C2340;--navy2:#1A3A5C;--gold:#C8A84B;--blue:#1A73E8;--teal:#0D9488;--rose:#DC2626;--amber:#D97706;--g1:#1F2937;--g2:#374151;--g3:#6B7280;--g5:#F9FAFB;--line:#E5E7EB}

/* ── COVER ── */
.cover{min-height:100vh;display:flex;flex-direction:column;background:linear-gradient(160deg,var(--navy) 0%,#0A3260 55%,#0F4C8A 100%);color:#fff;page-break-after:always}
.cover-accent{height:5px;background:linear-gradient(90deg,var(--gold),#e8c96b 50%,transparent)}
.cover-header{display:flex;align-items:center;justify-content:space-between;padding:28px 48px 20px;border-bottom:1px solid rgba(255,255,255,.1)}
.cover-dept{font-size:8pt;color:rgba(255,255,255,.5);letter-spacing:1.5px;text-transform:uppercase}
.cover-body{flex:1;display:flex;flex-direction:column;justify-content:center;padding:48px 48px 32px}
.cover-tag{display:inline-block;background:var(--gold);color:var(--navy);font-size:7.5pt;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:4px 14px;border-radius:2px;margin-bottom:18px}
.cover-title{font-size:28pt;font-weight:800;line-height:1.15;margin-bottom:8px}
.cover-sub{font-size:13pt;color:rgba(255,255,255,.65);margin-bottom:32px}
.cover-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:36px}
.cmi{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.13);border-radius:8px;padding:14px 16px}
.cmi .lbl{font-size:7.5pt;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.cmi .val{font-size:11pt;font-weight:700}
.cover-footer{padding:18px 48px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;font-size:7.5pt;color:rgba(255,255,255,.35)}

/* ── CONTENT ── */
.page{padding:36px 44px;max-width:900px;margin:0 auto}
.section-title{font-size:12pt;font-weight:800;color:var(--navy);border-left:4px solid var(--gold);padding-left:10px;margin:28px 0 16px}
.section-title:first-child{margin-top:0}

/* KPI grid */
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
.kpi{border:1px solid var(--line);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden}
.kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.kpi.blue::before{background:var(--blue)}.kpi.teal::before{background:var(--teal)}.kpi.rose::before{background:var(--rose)}.kpi.amber::before{background:var(--amber)}.kpi.navy::before{background:var(--navy)}.kpi.gold::before{background:var(--gold)}
.kpi .lbl{font-size:7pt;color:var(--g3);text-transform:uppercase;letter-spacing:.7px;margin-bottom:5px;font-weight:600}
.kpi .val{font-size:22pt;font-weight:800;line-height:1}
.kpi.blue .val{color:var(--blue)}.kpi.teal .val{color:var(--teal)}.kpi.rose .val{color:var(--rose)}.kpi.amber .val{color:var(--amber)}.kpi.navy .val{color:var(--navy)}.kpi.gold .val{color:#9A7B28}
.kpi .sub{font-size:7pt;color:var(--g3);margin-top:3px}

/* Recommendation */
.rec{background:linear-gradient(135deg,#EEF2FF,#F0F9FF);border:1px solid #C7D2FE;border-left:4px solid var(--blue);border-radius:7px;padding:16px 18px;margin-bottom:20px}
.rec .rt{font-size:8pt;font-weight:800;color:var(--navy);text-transform:uppercase;letter-spacing:.7px;margin-bottom:6px}
.rec p{font-size:9.5pt;line-height:1.6;color:var(--g2)}

/* Charts */
.charts-row{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:20px;page-break-inside:avoid}
.chart-box{border:1px solid var(--line);border-radius:8px;padding:16px}
.cbt{font-size:8pt;font-weight:700;color:var(--g2);text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px;display:flex;align-items:center;gap:5px}
.cbt::before{content:'';display:inline-block;width:3px;height:12px;background:var(--gold);border-radius:2px}

/* Table */
table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:20px}
thead tr{background:var(--navy);color:#fff}
thead th{padding:9px 10px;text-align:right;font-weight:700;font-size:7.5pt;white-space:nowrap}
thead th:first-child{text-align:left;border-radius:5px 0 0 0}thead th:last-child{border-radius:0 5px 0 0}
tbody td{padding:8px 10px;border-bottom:1px solid var(--line)}
tbody tr.alt{background:var(--g5)}
tbody tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.period{font-weight:700;color:var(--navy2)}
td.pass{color:var(--teal);font-weight:700}td.fail{color:var(--rose);font-weight:700}td.review{color:var(--amber);font-weight:600}td.score{color:var(--blue);font-weight:700}
.badge{display:inline-block;padding:2px 7px;border-radius:20px;font-size:8pt;font-weight:700}
.badge-pass{background:#D1FAE5;color:#065F46}.badge-review{background:#FEF3C7;color:#92400E}.badge-fail{background:#FEE2E2;color:#991B1B}

/* Footer */
.rpt-footer{border-top:1px solid var(--line);padding-top:14px;margin-top:28px;display:flex;justify-content:space-between;font-size:7.5pt;color:#9CA3AF}

@page{size:A4;margin:0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.cover{page-break-after:always}.charts-row,.rec{page-break-inside:avoid}}
</style>
</head>
<body>

<!-- COVER -->
<div class="cover">
  <div class="cover-accent"></div>
  <div class="cover-header">
    <img src="https://13.229.103.28.nip.io/logo-vietravel.svg" style="height:36px;filter:brightness(0) invert(1)" alt="Vietravel" onerror="this.style.display='none'">
    <span class="cover-dept">Phòng Nhân sự — Tuyển dụng</span>
  </div>
  <div class="cover-body">
    <span class="cover-tag">Báo cáo nội bộ · Mật</span>
    <div class="cover-title">Báo cáo Tình hình<br>Kiểm tra Tiếng Anh<br>Nhân sự</div>
    <div class="cover-sub">Thống kê &amp; Phân tích Kỳ thi Tuyển dụng ${periodLabel}</div>
    <div class="cover-meta">
      <div class="cmi"><div class="lbl">Kỳ báo cáo</div><div class="val">${periodLabel}</div></div>
      <div class="cmi"><div class="lbl">Giai đoạn</div><div class="val">${periodFrom} → ${periodTo}</div></div>
      <div class="cmi"><div class="lbl">Ngày xuất</div><div class="val">${nowStr}</div></div>
    </div>
  </div>
  <div class="cover-footer">
    <span>Tài liệu nội bộ — Không phát tán ra ngoài</span>
    <span>Vietravel HR System © ${new Date().getFullYear()}</span>
  </div>
</div>

<!-- CONTENT -->
<div class="page">
  <div class="section-title">1. Tóm tắt Số liệu Tổng quát</div>
  <div class="kpi-grid">
    <div class="kpi blue"><div class="lbl">Tổng ứng viên</div><div class="val">${totalExams.toLocaleString('vi-VN')}</div><div class="sub">Toàn bộ phiên thi</div></div>
    <div class="kpi teal"><div class="lbl">Tỷ lệ đạt</div><div class="val">${passRate}%</div><div class="sub">${totalPass.toLocaleString('vi-VN')} đạt chuẩn</div></div>
    <div class="kpi rose"><div class="lbl">Chưa đạt</div><div class="val">${totalFail.toLocaleString('vi-VN')}</div><div class="sub">Cần cải thiện</div></div>
    <div class="kpi amber"><div class="lbl">Xem xét</div><div class="val">${totalReview.toLocaleString('vi-VN')}</div><div class="sub">Chờ đánh giá</div></div>
    <div class="kpi navy"><div class="lbl">Điểm TB / 30</div><div class="val">${overallAvg}</div><div class="sub">Trung bình toàn kỳ</div></div>
    <div class="kpi gold"><div class="lbl">Tỷ lệ nộp bài</div><div class="val">${submitRate}%</div><div class="sub">Hoàn thành thi</div></div>
    <div class="kpi blue"><div class="lbl">Số kỳ dữ liệu</div><div class="val">${rows.length}</div><div class="sub">${timeLabel} có dữ liệu</div></div>
    <div class="kpi teal"><div class="lbl">TB / kỳ</div><div class="val">${rows.length ? Math.round(totalExams/rows.length) : 0}</div><div class="sub">Mỗi ${timeLabel.toLowerCase()}</div></div>
  </div>

  <div class="rec">
    <div class="rt">💡 Nhận định &amp; Khuyến nghị</div>
    <p>${recommendation}</p>
  </div>

  <div class="section-title">2. Biểu đồ Xu hướng ${periodLabel}</div>
  <div class="charts-row">
    <div class="chart-box">
      <div class="cbt">Tổng phiên · Đạt · Chưa đạt</div>
      <div style="position:relative;height:200px"><canvas id="cLine"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="cbt">Phân bố kết quả</div>
      <div style="position:relative;height:200px"><canvas id="cDonut"></canvas></div>
    </div>
  </div>
  <div class="chart-box" style="margin-bottom:22px">
    <div class="cbt">Điểm Trung bình theo ${timeLabel} (/30 điểm)</div>
    <div style="position:relative;height:140px"><canvas id="cAvg"></canvas></div>
  </div>

  <div class="section-title">3. Bảng Số liệu Chi tiết</div>
  <table>
    <thead><tr>
      <th>${timeLabel}</th><th>Tổng</th><th>Nộp bài</th>
      <th>Đạt</th><th>Xem xét</th><th>Chưa đạt</th>
      <th>% Đạt</th><th>Điểm TB</th>
    </tr></thead>
    <tbody>${tableRows||'<tr><td colspan="8" style="text-align:center;padding:16px;color:#9CA3AF">Chưa có dữ liệu</td></tr>'}</tbody>
  </table>

  <div class="rpt-footer">
    <span>Vietravel HR System — Tự động tạo</span>
    <span>Xuất ngày: ${nowFull}</span>
    <span>Bảo mật — Lưu hành nội bộ</span>
  </div>
</div>

<script>
(function(){
  const L=${chartLabels}, dT=${chartTotal}, dP=${chartPass}, dF=${chartFail}, dA=${chartAvg};

  const ctxL = document.getElementById('cLine').getContext('2d');
  const gB=ctxL.createLinearGradient(0,0,0,180); gB.addColorStop(0,'rgba(26,115,232,.18)'); gB.addColorStop(1,'rgba(26,115,232,0)');
  const gT=ctxL.createLinearGradient(0,0,0,180); gT.addColorStop(0,'rgba(13,148,136,.18)'); gT.addColorStop(1,'rgba(13,148,136,0)');
  const gR=ctxL.createLinearGradient(0,0,0,180); gR.addColorStop(0,'rgba(220,38,38,.12)'); gR.addColorStop(1,'rgba(220,38,38,0)');

  new Chart(ctxL,{type:'line',data:{labels:L,datasets:[
    {label:'Tổng',data:dT,borderColor:'#1A73E8',backgroundColor:gB,fill:true,tension:.4,borderWidth:2.5,pointRadius:2.5},
    {label:'Đạt', data:dP,borderColor:'#0D9488',backgroundColor:gT,fill:true,tension:.4,borderWidth:2,pointRadius:2},
    {label:'Chưa đạt',data:dF,borderColor:'#DC2626',backgroundColor:gR,fill:true,tension:.4,borderWidth:1.5,pointRadius:2}
  ]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},
    plugins:{legend:{position:'bottom',labels:{font:{size:8},boxWidth:9,padding:10}}},
    scales:{x:{ticks:{font:{size:7.5},maxRotation:40},grid:{color:'rgba(0,0,0,.04)'}},y:{ticks:{font:{size:7.5}},grid:{color:'rgba(0,0,0,.06)'}}}}});

  new Chart(document.getElementById('cDonut'),{type:'doughnut',
    data:{labels:['Đạt','Xem xét','Chưa đạt'],datasets:[{data:[${totalPass},${totalReview},${totalFail}],backgroundColor:['#0D9488','#D97706','#DC2626'],borderWidth:0,hoverOffset:4}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},cutout:'65%',
      plugins:{legend:{position:'bottom',labels:{font:{size:8},boxWidth:9,padding:8}}}}});

  new Chart(document.getElementById('cAvg'),{type:'bar',
    data:{labels:L,datasets:[{label:'Điểm TB',data:dA,
      backgroundColor:dA.map(v=>v==null?'rgba(0,0,0,0)':v>=20?'#0D9488':v>=12?'#1A73E8':'#DC2626'),
      borderRadius:3,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},
      plugins:{legend:{display:false}},
      scales:{x:{ticks:{font:{size:7.5},maxRotation:40},grid:{display:false}},
              y:{min:0,max:30,ticks:{font:{size:7.5},stepSize:5},grid:{color:'rgba(0,0,0,.06)'}}}}});
})();
</script>
</body></html>`;

    // ── Generate PDF via Puppeteer + @sparticuz/chromium-min ────────────────────
    let puppeteer, chromiumPkg;
    try {
      puppeteer   = require('puppeteer-core');
      chromiumPkg = require('@sparticuz/chromium-min');
    } catch (e) {
      return res.status(500).json({ error: 'pdf_deps_missing', message: e.message });
    }

    // chromium-min downloads a pre-built headless Chromium binary on demand
    const CHROMIUM_PACK = 'https://github.com/Sparticuz/chromium/releases/download/v126.0.0/chromium-v126.0.0-pack.tar';
    const execPath = await chromiumPkg.executablePath(CHROMIUM_PACK);

    const browser = await puppeteer.launch({
      executablePath: execPath,
      args: chromiumPkg.args,
      headless: chromiumPkg.headless,
      defaultViewport: chromiumPkg.defaultViewport,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for Chart.js to finish rendering
    await new Promise(r => setTimeout(r, 1500));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);

  } catch (err) {
    console.error('[PDF export]', err);
    res.status(500).json({ error: 'pdf_export_failed', message: err.message });
  }
});

module.exports = router;
