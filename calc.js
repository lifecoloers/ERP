/* ألوان الحياة — منطق الحساب المشترك بين الخادم والمتصفح
   (نفس المعادلات بالضبط في النظام الداخلي وبوابة العميل) */
(function (root) {
  function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100; }

  // الضريبة: لكل عرض سعر خيار مستقل (none | add | inclusive)، وإلا يُستخدم إعداد المنشأة
  function vatConfig(settings, order) {
    const s = settings || {};
    const rate = (s.vatRate === undefined || s.vatRate === '' || s.vatRate === null) ? 15 : num(s.vatRate);
    if (order && ['none', 'add', 'inclusive'].includes(order.vatMode)) return { mode: order.vatMode, rate };
    const enabled = !!String(s.vatNumber || '').trim() && s.vatMode !== 'none';
    return { mode: enabled ? (s.vatMode === 'add' ? 'add' : 'inclusive') : 'none', rate };
  }

  // سعر البيع: يدوي إذا أُدخل (sellPrice)، وإلا التكلفة × (1 + الهامش)
  function hasSellOverride(it) { return it && it.sellPrice !== undefined && it.sellPrice !== null && String(it.sellPrice).trim() !== ''; }
  function calcLine(it, margin) {
    const qty = num(it.qty);
    const cost = qty * num(it.unitPrice);
    const autoUnit = num(it.unitPrice) * (1 + margin / 100);
    const unitSell = hasSellOverride(it) ? num(it.sellPrice) : autoUnit;
    const sell = qty * unitSell;
    return { qty, cost: round2(cost), sell: round2(sell), unitSell: round2(unitSell), autoUnit: round2(autoUnit), manual: hasSellOverride(it) };
  }

  function calcOrder(order, settings) {
    const c = order || {};
    const margin = num(c.marginPercent);
    let totalCost = 0, itemsSelling = 0;
    const lines = (c.items || []).map(it => { const l = calcLine(it, margin); totalCost += l.cost; itemsSelling += l.sell; return l; });
    const installation = Math.max(0, num(c.installationFee));
    const discount = Math.max(0, num(c.discount));
    const subtotal = Math.max(0, itemsSelling + installation - discount);
    const v = vatConfig(settings, c);
    let net = subtotal, vat = 0, grandTotal = subtotal;
    if (v.mode === 'add') { vat = subtotal * v.rate / 100; grandTotal = subtotal + vat; }
    else if (v.mode === 'inclusive') { net = subtotal / (1 + v.rate / 100); vat = subtotal - net; }
    return {
      lines, margin,
      totalCost: round2(totalCost), marginAmount: round2(itemsSelling - totalCost), itemsSelling: round2(itemsSelling),
      installation: round2(installation), discount: round2(discount), subtotal: round2(subtotal),
      net: round2(net), vat: round2(vat), vatRate: v.rate, vatMode: v.mode, grandTotal: round2(grandTotal)
    };
  }

  // الحساب الداخلي للعرض (للمدير فقط): تكلفة المواد + العمالة + النقل والعمولات والمصاريف ← صافي الربح
  function quoteCosting(order, settings) {
    const t = calcOrder(order, settings);
    const i = (order && order.internal) || {};
    const labor = i.laborMode === 'lump' ? num(i.lumpSum) : num(i.workers) * num(i.days) * num(i.dailyWage);
    const transport = num(i.transport), commissions = num(i.commissions), other = num(i.other);
    const othersTotal = transport + commissions + other;
    const totalCost = t.totalCost + labor + othersTotal;
    const sellNet = t.net;
    const profit = sellNet - totalCost;
    const pct = sellNet ? profit / sellNet * 100 : 0;
    const minProfit = (i.minProfit === undefined || i.minProfit === '') ? 15 : num(i.minProfit);
    const materialsPurchase = ((order && order.materials) || []).reduce((s, m) => s + num(m.qty) * num(m.price), 0);
    return {
      materialsCost: t.totalCost, materialsSell: t.itemsSelling, materialsProfit: round2(t.itemsSelling - t.totalCost),
      labor: round2(labor), transport: round2(transport), commissions: round2(commissions), other: round2(other), othersTotal: round2(othersTotal),
      totalCost: round2(totalCost), sellNet, profit: round2(profit), pct: Math.round(pct * 10) / 10, minProfit,
      belowMin: sellNet > 0 && pct < minProfit, materialsPurchase: round2(materialsPurchase)
    };
  }

  function collected(c) { return round2((c && c.payments || []).reduce((s, p) => s + num(p.amount), 0)); }

  const api = { num, round2, vatConfig, hasSellOverride, calcLine, calcOrder, quoteCosting, collected };
  root.AlwanCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
