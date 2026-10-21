/**
 * ألوان الحياة للديكور — الخادم الخلفي (Backend) — الإصدار 3
 * Node.js بدون أي مكتبات خارجية — يعمل مباشرة بأمر: node server.js
 *
 * - قاعدة البيانات: data/database.json  (+ نسخة احتياطية تلقائية قبل كل حفظ في data/backups)
 * - المستخدمون وكلمات المرور (مشفّرة scrypt): data/config.json
 * - الجلسات (تبقى بعد إعادة تشغيل الخادم): data/sessions.json
 * - حماية من تعارض الحفظ بين أكثر من جهاز (رقم مراجعة _rev)
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.ALWAN_DATA_DIR || path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BACKUPS = 30;
const DEFAULT_PASSWORD = 'alwan2026';
const ROLES = ['مدير', 'مبيعات', 'محاسب'];
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // أسبوع
const Calc = require(path.join(PUBLIC_DIR, 'calc.js'));

/* ---------------- أدوات ---------------- */
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function hashPassword(password, salt) { return crypto.scryptSync(String(password), salt, 64).toString('hex'); }
function makeSecret(password) { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hashPassword(password, salt) }; }
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function newId() { return 'u' + crypto.randomBytes(6).toString('hex'); }

/* ---------------- المجلدات وقاعدة البيانات ---------------- */
[DATA_DIR, BACKUP_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(DB_FILE)) {
  writeJsonAtomic(DB_FILE, { _rev: 1, clients: [], inventory: {}, purchases: [], expenses: [] });
  console.log('تم إنشاء قاعدة بيانات جديدة في: ' + DB_FILE);
}
function readDb() {
  const data = readJson(DB_FILE, null) || {};
  if (!Array.isArray(data.clients)) data.clients = [];
  if (!data.inventory || typeof data.inventory !== 'object') data.inventory = {};
  if (!Array.isArray(data.purchases)) data.purchases = [];
  if (!Array.isArray(data.expenses)) data.expenses = [];
  if (!Number.isInteger(data._rev)) data._rev = 1;
  return data;
}
function backupDb() {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `backup-${stamp}.json`));
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup-')).sort();
    while (files.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) { console.error('تعذّر أخذ نسخة احتياطية:', e.message); }
}
// كتابة متسلسلة لمنع تعارض الحفظ المتزامن داخل الخادم
let writeQueue = Promise.resolve();
function writeDb(data) {
  const job = writeQueue.then(() => { backupDb(); writeJsonAtomic(DB_FILE, data); });
  writeQueue = job.catch(() => {});
  return job;
}

/* ---------------- المستخدمون ---------------- */
function readConfig() { return readJson(CONFIG_FILE, null); }
function writeConfig(cfg) { writeJsonAtomic(CONFIG_FILE, cfg); }
function ensureConfig() {
  let cfg = readConfig();
  const defaults = [
    { username: 'admin', name: 'المدير', role: 'مدير' },
    { username: 'sales', name: 'المبيعات', role: 'مبيعات' },
    { username: 'accountant', name: 'المحاسب', role: 'محاسب' },
  ];
  if (!cfg) {
    cfg = { users: defaults.map(d => ({ id: newId(), ...d, active: true, ...makeSecret(DEFAULT_PASSWORD) })) };
    writeConfig(cfg);
    console.log('تم إنشاء المستخدمين الافتراضيين (admin / sales / accountant) بكلمة المرور: ' + DEFAULT_PASSWORD);
    return;
  }
  if (!Array.isArray(cfg.users)) {
    // ترقية من الإصدارات السابقة: كلمة مرور مشتركة أو كلمة لكل دور ← حسابات مستخدمين حقيقية
    const roleSecret = r => (cfg.roles && cfg.roles[r]) || (cfg.salt ? { salt: cfg.salt, hash: cfg.hash } : makeSecret(DEFAULT_PASSWORD));
    cfg = { users: defaults.map(d => { const s = roleSecret(d.role); return { id: newId(), ...d, active: true, salt: s.salt, hash: s.hash }; }) };
    writeConfig(cfg);
    console.log('تمت الترقية إلى حسابات مستخدمين: admin (مدير) / sales (مبيعات) / accountant (محاسب) — كلمات المرور القديمة لكل دور ما زالت تعمل.');
  }
}
ensureConfig();
function publicUser(u) { return { id: u.id, username: u.username, name: u.name, role: u.role, active: u.active !== false }; }
function findUserById(id) { return (readConfig().users || []).find(u => u.id === id); }
function activeManagers(users) { return users.filter(u => u.role === 'مدير' && u.active !== false); }

/* ---------------- الجلسات ---------------- */
let SESSIONS = readJson(SESSIONS_FILE, {}) || {};
function saveSessions() { try { writeJsonAtomic(SESSIONS_FILE, SESSIONS); } catch (e) {} }
function pruneSessions() { const now = Date.now(); let ch = false; for (const t in SESSIONS) if (SESSIONS[t].expires < now) { delete SESSIONS[t]; ch = true; } if (ch) saveSessions(); }
pruneSessions();
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS[token] = { userId, expires: Date.now() + SESSION_TTL_MS };
  saveSessions();
  return token;
}
function killUserSessions(userId, exceptToken) { let ch = false; for (const t in SESSIONS) if (SESSIONS[t].userId === userId && t !== exceptToken) { delete SESSIONS[t]; ch = true; } if (ch) saveSessions(); }
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
// يرجع المستخدم الحالي (أو null) — يُقرأ من ملف المستخدمين كل طلب حتى يُطبَّق التعطيل/تغيير الدور فورًا
function currentUser(req) {
  const token = getCookie(req, 'session');
  const s = token && SESSIONS[token];
  if (!s) return null;
  if (Date.now() > s.expires) { delete SESSIONS[token]; saveSessions(); return null; }
  const u = findUserById(s.userId);
  if (!u || u.active === false) return null;
  return { ...publicUser(u), token };
}

/* ---------------- الحماية من تخمين كلمة المرور ---------------- */
const FAILS = new Map(); // ip -> {count, until}
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''; }
function isLocked(ip) { const f = FAILS.get(ip); return f && f.count >= 8 && Date.now() < f.until; }
function noteFail(ip) { const f = FAILS.get(ip) || { count: 0, until: 0 }; if (Date.now() > f.until) f.count = 0; f.count++; f.until = Date.now() + 15 * 60 * 1000; FAILS.set(ip, f); }

/* ---------------- HTTP ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8'
};
function baseHeaders(extra) {
  return Object.assign({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' }, extra || {});
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' }));
  res.end(body);
}
function readBody(req, limit) {
  limit = limit || 25 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; const e = new Error('الطلب كبير جدًا'); e.status = 413; reject(e); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { const er = new Error('صيغة JSON غير صالحة'); er.status = 400; reject(er); }
    });
    req.on('error', reject);
  });
}
function cookieFlags(req) { return req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''; }
function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch (e) { res.writeHead(400); return res.end(); }
  rel = path.normalize(rel).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, rel === '' || rel === '.' ? 'index.html' : rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      // أي مسار غير معروف بدون امتداد يرجع للواجهة الرئيسية
      if (!path.extname(filePath)) return serveStatic(req, res, '/index.html');
      res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' })); return res.end('الصفحة غير موجودة');
    }
    const ext = path.extname(filePath).toLowerCase();
    const cache = ['.html', '.js', '.css', '.json'].includes(ext) ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, baseHeaders({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache }));
    res.end(content);
  });
}

/* ---------------- بوابة العميل: بيانات عامة بدون تكلفة أو هامش ---------------- */
function portalPayload(db, c) {
  const settings = db.settings || {};
  const catalog = db.catalog || [];
  const quotes = (db.quotes || []).filter(q => q.clientId === c.id);
  // العميل يرى عقوده الموقّعة، وإن لم توجد فأحدث عرض سعر مُرسل/مسودة — بدون التكلفة أو الهامش أو الحساب الداخلي
  let shown = quotes.filter(q => q.status === 'signed');
  if (!shown.length) { const open = quotes.filter(q => q.status === 'sent' || q.status === 'draft').sort((a, b) => String(b.dateISO || '').localeCompare(String(a.dateISO || ''))); if (open[0]) shown = [open[0]]; }
  const items = []; let installation = 0, discount = 0, vat = 0, grandTotal = 0, vatMode = 'none', vatRate = 15;
  shown.forEach(q => {
    const t = Calc.calcOrder(q, settings);
    (q.items || []).forEach((it, i) => {
      const cat = catalog.find(x => x.id === it.catalogId);
      items.push({ name: (cat && cat.name) || it.customName || 'بند', unit: (cat && cat.unit) || it.unit || '', location: it.location || '', qty: t.lines[i].qty, sell: t.lines[i].sell });
    });
    installation += t.installation; discount += t.discount; vat += t.vat; grandTotal += t.grandTotal; vatRate = t.vatRate; if (t.vatMode !== 'none') vatMode = t.vatMode;
  });
  const contractTotal = quotes.filter(q => q.status === 'signed').reduce((s, q) => s + Calc.calcOrder(q, settings).grandTotal, 0);
  const collected = Calc.collected(c);
  const ref = shown[0] ? (shown.map(q => q.contractNo || q.no).filter(Boolean).join(' / ')) : '';
  // جدول الدفعات (المبالغ فقط) والضمان — بدون أي بيانات داخلية
  const installments = [];
  shown.forEach(q => {
    const list = Array.isArray(q.installments) ? q.installments : []; const total = Calc.calcOrder(q, settings).grandTotal;
    const sumPct = list.reduce((s, x) => s + Calc.num(x.pct), 0); let used = 0;
    list.forEach((x, i) => {
      const amt = (i === list.length - 1 && list.length > 1 && Math.abs(sumPct - 100) < 0.01) ? Calc.round2(total - used) : Calc.round2(total * Calc.num(x.pct) / 100); used += amt;
      const due = x.when === 'sign' ? (q.signedDateISO || q.dateISO || '') : x.when === 'delivery' ? (c.deliveredDateISO || '') : (x.dueDate || '');
      installments.push({ label: String(x.label || ''), pct: Calc.num(x.pct), amount: amt, when: x.when, due });
    });
  });
  let pool = collected; installments.forEach(r => { r.paid = Calc.round2(Math.min(pool, r.amount)); pool = Calc.round2(pool - r.paid); });
  let warrantyEnd = '';
  if (c.deliveredDateISO) { const d = new Date(c.deliveredDateISO + 'T00:00:00'); d.setMonth(d.getMonth() + (Calc.num(settings.warrantyMonths) || 12)); warrantyEnd = d.toLocaleDateString('en-CA'); }
  return {
    name: c.name, status: c.status, items,
    installation: Calc.round2(installation), discount: Calc.round2(discount), vat: Calc.round2(vat), vatMode, vatRate,
    grandTotal: Calc.round2(grandTotal), refNo: ref, contractNo: shown.some(q => q.status === 'signed'),
    installDate: c.installDate || '', collected, remaining: Calc.round2(Math.max(0, (contractTotal || grandTotal) - collected)),
    payments: (c.payments || []).map(p => ({ date: p.dateISO || p.date, amount: Calc.num(p.amount), method: p.method })),
    tasks: (c.tasks || []).map(x => ({ text: x.text, done: !!x.done })), photos: c.photos || [],
    rating: c.rating === undefined ? null : c.rating, ratingComment: c.ratingComment || '',
    installments, deliveredDate: c.deliveredDateISO || '', warrantyEnd, warrantyMonths: Calc.num(settings.warrantyMonths) || 12,
    maintenance: (c.maintenance || []).map(v => ({ date: v.dateISO, kind: v.kind, text: v.text, done: !!v.done })),
    company: settings.company || null
  };
}
function findPortalClient(db, token) {
  if (!token || String(token).length < 16) return null;
  return (db.clients || []).find(cl => cl.portalToken && cl.portalToken === token) || null;
}

/* ---------------- الخادم ---------------- */
const server = http.createServer(async (req, res) => {
  let urlObj;
  try { urlObj = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end('Bad Request'); }
  const pathname = urlObj.pathname;
  const method = req.method;

  try {
    if (pathname === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true, time: new Date().toISOString() });

    /* ---------- الدخول والخروج ---------- */
    if (pathname === '/api/login' && method === 'POST') {
      const ip = clientIp(req);
      if (isLocked(ip)) return sendJson(res, 429, { error: 'محاولات كثيرة خاطئة — حاول بعد 15 دقيقة' });
      const body = await readBody(req, 10000) || {};
      const username = String(body.username || '').trim().toLowerCase();
      const users = readConfig().users || [];
      const u = users.find(x => x.username.toLowerCase() === username);
      if (!u || u.active === false || !safeEqualHex(hashPassword(String(body.password || ''), u.salt), u.hash)) {
        noteFail(ip);
        return sendJson(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
      }
      FAILS.delete(ip);
      const token = createSession(u.id);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax${cookieFlags(req)}`);
      return sendJson(res, 200, { ok: true, user: publicUser(u) });
    }
    if (pathname === '/api/logout' && method === 'POST') {
      const token = getCookie(req, 'session');
      if (token && SESSIONS[token]) { delete SESSIONS[token]; saveSessions(); }
      res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
      return sendJson(res, 200, { ok: true });
    }

    /* ---------- بوابة العميل العامة ---------- */
    let m;
    if ((m = pathname.match(/^\/api\/portal\/([^/]+)$/)) && method === 'GET') {
      const db = readDb(); const c = findPortalClient(db, m[1]);
      if (!c) return sendJson(res, 404, { error: 'الرابط غير صحيح أو منتهي' });
      return sendJson(res, 200, portalPayload(db, c));
    }
    if ((m = pathname.match(/^\/api\/portal\/([^/]+)\/rating$/)) && method === 'POST') {
      const body = await readBody(req, 10000) || {};
      const rating = parseInt(body.rating, 10);
      if (!(rating >= 1 && rating <= 5)) return sendJson(res, 400, { error: 'تقييم غير صالح' });
      const db = readDb(); const c = findPortalClient(db, m[1]);
      if (!c) return sendJson(res, 404, { error: 'الرابط غير صحيح' });
      if (c.rating) return sendJson(res, 409, { error: 'تم التقييم مسبقًا — شكرًا لك' });
      if (!['delivered', 'collected'].includes(c.status)) return sendJson(res, 400, { error: 'التقييم متاح بعد التسليم' });
      c.rating = rating; c.ratingComment = String(body.comment || '').slice(0, 500);
      db._rev = db._rev + 1;
      await writeDb(db);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname.startsWith('/uploads/') && method === 'GET') {
      const filePath = path.join(UPLOADS_DIR, path.basename(pathname));
      return fs.readFile(filePath, (err, content) => {
        if (err) { res.writeHead(404); return res.end('غير موجود'); }
        res.writeHead(200, baseHeaders({ 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=604800' }));
        res.end(content);
      });
    }

    /* ---------- كل مسارات /api التالية تحتاج تسجيل دخول ---------- */
    if (!pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405); return res.end('Method Not Allowed'); }
      return serveStatic(req, res, pathname);
    }
    const me = currentUser(req);
    if (!me) return sendJson(res, 401, { error: 'الرجاء تسجيل الدخول' });
    const isManager = me.role === 'مدير';

    if (pathname === '/api/whoami' && method === 'GET') return sendJson(res, 200, { user: publicUser(me) });

    if (pathname === '/api/state' && method === 'GET') return sendJson(res, 200, readDb());
    if (pathname === '/api/rev' && method === 'GET') return sendJson(res, 200, { rev: readDb()._rev });
    if (pathname === '/api/state' && method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.clients)) return sendJson(res, 400, { error: 'بيانات غير صالحة' });
      const cur = readDb();
      if (body._rev !== cur._rev) return sendJson(res, 409, { error: 'تم تعديل البيانات من جهاز آخر', rev: cur._rev });
      body._rev = cur._rev + 1;
      await writeDb(body);
      return sendJson(res, 200, { ok: true, rev: body._rev });
    }
    if (pathname === '/api/restore' && method === 'POST') {
      if (!isManager) return sendJson(res, 403, { error: 'الاستعادة للمدير فقط' });
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.clients)) return sendJson(res, 400, { error: 'ملف النسخة غير صالح' });
      body._rev = readDb()._rev + 1;
      await writeDb(body);
      return sendJson(res, 200, { ok: true, rev: body._rev });
    }
    if (pathname === '/api/backup' && method === 'GET') {
      if (!isManager) return sendJson(res, 403, { error: 'التنزيل للمدير فقط' });
      const body = JSON.stringify(readDb(), null, 2);
      res.writeHead(200, baseHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="alwan-alhayat-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        'Content-Length': Buffer.byteLength(body)
      }));
      return res.end(body);
    }
    if (pathname === '/api/backups' && method === 'GET') {
      if (!isManager) return sendJson(res, 403, { error: 'للمدير فقط' });
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup-')).sort().reverse()
        .map(f => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
      return sendJson(res, 200, { files });
    }
    if ((m = pathname.match(/^\/api\/backups\/(backup-[\w.-]+\.json)$/)) && method === 'GET') {
      if (!isManager) return sendJson(res, 403, { error: 'للمدير فقط' });
      const f = path.join(BACKUP_DIR, path.basename(m[1]));
      if (!fs.existsSync(f)) return sendJson(res, 404, { error: 'غير موجود' });
      const body = fs.readFileSync(f);
      res.writeHead(200, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.basename(f)}"` }));
      return res.end(body);
    }
    if (pathname === '/api/upload' && method === 'POST') {
      const body = await readBody(req, 15 * 1024 * 1024);
      if (!body || !body.dataBase64) return sendJson(res, 400, { error: 'لا توجد بيانات صورة' });
      const allowed = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
      const ext = allowed[body.mime];
      if (!ext) return sendJson(res, 400, { error: 'نوع الملف غير مدعوم (صور JPG / PNG / WEBP أو ملف PDF)' });
      const buffer = Buffer.from(String(body.dataBase64).split(',').pop(), 'base64');
      if (buffer.length > 10 * 1024 * 1024) return sendJson(res, 400, { error: 'حجم الملف كبير جدًا (الحد الأقصى 10 ميجا)' });
      const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
      return sendJson(res, 200, { url: '/uploads/' + name });
    }

    /* ---------- كلمة مرور المستخدم الحالي ---------- */
    if (pathname === '/api/change-password' && method === 'POST') {
      const body = await readBody(req, 10000) || {};
      const cfg = readConfig(); const u = cfg.users.find(x => x.id === me.id);
      if (!safeEqualHex(hashPassword(String(body.oldPassword || ''), u.salt), u.hash)) return sendJson(res, 401, { error: 'كلمة المرور الحالية غير صحيحة' });
      if (String(body.newPassword || '').length < 6) return sendJson(res, 400, { error: 'كلمة المرور الجديدة قصيرة (6 أحرف على الأقل)' });
      Object.assign(u, makeSecret(body.newPassword));
      writeConfig(cfg);
      killUserSessions(u.id, me.token);
      return sendJson(res, 200, { ok: true });
    }

    /* ---------- إدارة المستخدمين (المدير فقط) ---------- */
    if (pathname.startsWith('/api/users')) {
      if (!isManager) return sendJson(res, 403, { error: 'إدارة المستخدمين للمدير فقط' });
      const cfg = readConfig();
      if (pathname === '/api/users' && method === 'GET') return sendJson(res, 200, { users: cfg.users.map(publicUser) });
      if (pathname === '/api/users' && method === 'POST') {
        const b = await readBody(req, 10000) || {};
        const username = String(b.username || '').trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,30}$/.test(username)) return sendJson(res, 400, { error: 'اسم المستخدم: 3–30 حرف إنجليزي/أرقام بدون مسافات' });
        if (cfg.users.some(u => u.username.toLowerCase() === username)) return sendJson(res, 400, { error: 'اسم المستخدم مستخدم مسبقًا' });
        if (!ROLES.includes(b.role)) return sendJson(res, 400, { error: 'دور غير معروف' });
        if (String(b.password || '').length < 6) return sendJson(res, 400, { error: 'كلمة المرور 6 أحرف على الأقل' });
        const u = { id: newId(), username, name: String(b.name || username).trim().slice(0, 60), role: b.role, active: true, ...makeSecret(b.password) };
        cfg.users.push(u); writeConfig(cfg);
        return sendJson(res, 200, { user: publicUser(u) });
      }
      if ((m = pathname.match(/^\/api\/users\/([\w]+)$/))) {
        const u = cfg.users.find(x => x.id === m[1]);
        if (!u) return sendJson(res, 404, { error: 'المستخدم غير موجود' });
        if (method === 'PUT') {
          const b = await readBody(req, 10000) || {};
          const next = { ...u };
          if (b.name !== undefined) next.name = String(b.name).trim().slice(0, 60) || u.name;
          if (b.role !== undefined) { if (!ROLES.includes(b.role)) return sendJson(res, 400, { error: 'دور غير معروف' }); next.role = b.role; }
          if (b.active !== undefined) next.active = !!b.active;
          const after = cfg.users.map(x => x.id === u.id ? next : x);
          if (!activeManagers(after).length) return sendJson(res, 400, { error: 'لازم يبقى مدير واحد فعّال على الأقل' });
          if (b.newPassword) {
            if (String(b.newPassword).length < 6) return sendJson(res, 400, { error: 'كلمة المرور 6 أحرف على الأقل' });
            Object.assign(next, makeSecret(b.newPassword));
          }
          Object.assign(u, next); writeConfig(cfg);
          if (u.active === false || b.newPassword) killUserSessions(u.id, u.id === me.id ? me.token : null);
          return sendJson(res, 200, { user: publicUser(u) });
        }
        if (method === 'DELETE') {
          if (u.id === me.id) return sendJson(res, 400, { error: 'ما تقدر تحذف حسابك الحالي' });
          const after = cfg.users.filter(x => x.id !== u.id);
          if (!activeManagers(after).length) return sendJson(res, 400, { error: 'لازم يبقى مدير واحد فعّال على الأقل' });
          cfg.users = after; writeConfig(cfg); killUserSessions(u.id);
          return sendJson(res, 200, { ok: true });
        }
      }
    }

    return sendJson(res, 404, { error: 'مسار غير موجود' });
  } catch (e) {
    return sendJson(res, e.status || 500, { error: e.status ? e.message : 'خطأ في الخادم: ' + e.message });
  }
});

function lanAddresses() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(a => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
  return out;
}
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n⚠ المنفذ ${PORT} مستخدم — يبدو أن النظام يعمل مسبقًا في نافذة أخرى. أغلقها أو شغّل بمنفذ آخر: PORT=3001 node server.js\n`);
  else console.error(e);
  process.exit(1);
});
setInterval(pruneSessions, 60 * 60 * 1000).unref();
server.listen(PORT, () => {
  console.log('====================================================');
  console.log(' ألوان الحياة للديكور — النظام يعمل الآن');
  console.log(' على هذا الجهاز:  http://localhost:' + PORT);
  lanAddresses().forEach(ip => console.log(' من الجوال (نفس الشبكة): http://' + ip + ':' + PORT));
  console.log(' قاعدة البيانات: ' + DB_FILE);
  console.log('====================================================');
});
