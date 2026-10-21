/* رسوم بيانية مدمجة (SVG) — تعمل بدون إنترنت وتتبع ألوان الوضع الفاتح/الداكن */
(function (root) {
  const PALETTE = ['#B8874A', '#5C0D33', '#5F6B47', '#4F7690', '#D0A066', '#84234F', '#818F63', '#9C8F70'];
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const short = n => { const a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'م'; if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'; return String(Math.round(n)); };
  const full = n => (Math.round(n * 100) / 100).toLocaleString('en-US');
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function legend(series) {
    return `<div class="chart-legend">${series.map((s, i) => `<span><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }

  // أعمدة مجمّعة: labels = ['2026-08', ...], series = [{name, values:[..], color}]
  function bars(labels, series, opts) {
    opts = opts || {};
    if (!labels.length) return `<div class="chart-empty">لا توجد بيانات كافية بعد</div>`;
    const W = 640, H = opts.height || 240, padL = 46, padR = 10, padT = 12, padB = 30;
    const max = niceMax(Math.max(0, ...series.flatMap(s => s.values)));
    const cw = (W - padL - padR) / labels.length, gw = cw * 0.72, bw = gw / series.length;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = max * i / 4, y = padT + (H - padT - padB) * (1 - i / 4);
      g += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="grid"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end" class="axis">${short(v)}</text>`;
    }
    labels.forEach((lb, i) => {
      const x0 = padL + cw * i + (cw - gw) / 2;
      series.forEach((s, j) => {
        const v = s.values[i] || 0, h = (H - padT - padB) * v / max, y = H - padB - h;
        g += `<rect x="${x0 + bw * j + 1}" y="${y}" width="${Math.max(1, bw - 2)}" height="${Math.max(0, h)}" rx="2" fill="${s.color || PALETTE[j % PALETTE.length]}"><title>${esc(s.name)} — ${esc(lb)}: ${full(v)}</title></rect>`;
      });
      g += `<text x="${padL + cw * i + cw / 2}" y="${H - 10}" text-anchor="middle" class="axis">${esc(lb)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img">${g}</svg>${series.length > 1 ? legend(series) : ''}`;
  }

  // أعمدة أفقية: items = [[label, value], ...]
  function hbars(items, opts) {
    opts = opts || {};
    if (!items.length) return `<div class="chart-empty">لا توجد بيانات كافية بعد</div>`;
    const max = Math.max(...items.map(i => i[1]), 1), color = opts.color || PALETTE[2];
    return `<div class="hbars">${items.map(([lb, v]) => `
      <div class="hbar-row"><div class="hbar-label" title="${esc(lb)}">${esc(lb)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(v / max * 100).toFixed(1)}%; background:${color}"></div></div>
        <div class="hbar-val">${opts.format ? opts.format(v) : full(v)}</div></div>`).join('')}</div>`;
  }

  // دائرة: items = [[label, value], ...]
  function donut(items) {
    const total = items.reduce((s, i) => s + i[1], 0);
    if (!total) return `<div class="chart-empty">لا توجد بيانات كافية بعد</div>`;
    const R = 70, r = 44, cx = 90, cy = 90; let a0 = -Math.PI / 2, paths = '';
    items.forEach(([lb, v], i) => {
      const frac = v / total, a1 = a0 + frac * Math.PI * 2, col = PALETTE[i % PALETTE.length];
      if (frac >= 0.9999) { paths += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${col}" stroke-width="${R - r}"><title>${esc(lb)}: ${v}</title></circle>`; }
      else {
        const large = frac > 0.5 ? 1 : 0, p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
        paths += `<path d="M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z" fill="${col}"><title>${esc(lb)}: ${v}</title></path>`;
      }
      a0 = a1;
    });
    return `<div class="donut-wrap"><svg viewBox="0 0 180 180" class="donut-svg">${paths}<text x="90" y="86" text-anchor="middle" class="donut-num">${total}</text><text x="90" y="104" text-anchor="middle" class="axis">الإجمالي</text></svg>
      ${legend(items.map(([lb, v]) => ({ name: `${lb} (${v} — ${Math.round(v / total * 100)}%)` })))}</div>`;
  }

  root.AlwanCharts = { bars, hbars, donut, PALETTE };
})(window);
