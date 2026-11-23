require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'attendance.sqlite'));
const PORT = Number(process.env.PORT || 3000);
const QR_SECRET = process.env.QR_SIGNING_SECRET || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SHOP_LAT = process.env.SHOP_LAT === '' || process.env.SHOP_LAT == null ? null : Number(process.env.SHOP_LAT);
const SHOP_LNG = process.env.SHOP_LNG === '' || process.env.SHOP_LNG == null ? null : Number(process.env.SHOP_LNG);
const GEOFENCE = Number(process.env.GEOFENCE_METERS || 50);
const configured = Number.isFinite(SHOP_LAT) && Number.isFinite(SHOP_LNG) && SHOP_LAT !== null && SHOP_LNG !== null;

if (SESSION_SECRET.length < 32 || QR_SECRET.length < 32) {
  console.error('Security setup required: SESSION_SECRET and QR_SIGNING_SECRET must each be at least 32 characters. Copy .env.example to .env and set them.');
  process.exit(1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

const schema = `
CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pin_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, device_key TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(staff_id, device_key), FOREIGN KEY(staff_id) REFERENCES staff(id));
CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, work_date TEXT NOT NULL, clock_in TEXT, clock_out TEXT, status TEXT NOT NULL DEFAULT 'out', break_started TEXT, total_break_minutes INTEGER NOT NULL DEFAULT 0, net_work_minutes INTEGER, FOREIGN KEY(staff_id) REFERENCES staff(id));
CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, attempted_at TEXT NOT NULL, latitude REAL, longitude REAL, device_key TEXT, result TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS qr_challenges (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
db.exec(schema);

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const sign = value => crypto.createHmac('sha256', QR_SECRET).update(value).digest('hex');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function ownerOnly(req, res, next) { if (req.session.role !== 'owner') return res.status(401).json({ error: 'Owner login required' }); next(); }
function staffOnly(req, res, next) { if (req.session.role !== 'staff') return res.status(401).json({ error: 'Staff login required' }); next(); }
function distanceMeters(aLat, aLng, bLat, bLng) {
  const rad = n => n * Math.PI / 180, R = 6371000;
  const dLat = rad(bLat-aLat), dLng = rad(bLng-aLng);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function logScan(staffId, coords, device, result, detail) {
  db.prepare('INSERT INTO scans (staff_id, attempted_at, latitude, longitude, device_key, result, detail) VALUES (?,?,?,?,?,?,?)')
    .run(staffId || null, nowIso(), coords?.latitude ?? null, coords?.longitude ?? null, device || null, result, detail || '');
}
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);

app.get('/api/status', (req, res) => res.json({ configured, geofenceMeters: GEOFENCE, role: req.session.role || null, shopName: 'Rajarajeswari' }));

app.post('/api/owner/login', rateLimit({windowMs: 15*60*1000, limit: 8, standardHeaders: true, legacyHeaders: false}), async (req, res) => {
  const pin = String(req.body.pin || '');
  const expected = String(process.env.OWNER_PIN || '');
  if (!/^\d{4,8}$/.test(pin) || !expected || !safeEqual(pin, expected)) return res.status(401).json({error:'Invalid owner PIN'});
  req.session.role = 'owner';
  req.session.staffId = null;
  res.json({ok:true});
});
app.post('/api/logout', (req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.post('/api/staff/login', rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false}), async (req,res)=>{
  const code = String(req.body.code || '').trim().toUpperCase();
  const pin = String(req.body.pin || '');
  const deviceKey = String(req.body.deviceKey || '');
  const staff = db.prepare('SELECT * FROM staff WHERE code=? AND active=1').get(code);
  if (!staff || !bcrypt.compareSync(pin, staff.pin_hash) || !/^[a-zA-Z0-9_-]{16,100}$/.test(deviceKey)) {
    logScan(staff?.id, null, deviceKey, 'failed_login', 'Invalid staff credentials or device key');
    return res.status(401).json({error:'Invalid staff code or PIN'});
  }
  let device = db.prepare('SELECT * FROM devices WHERE staff_id=? AND device_key=?').get(staff.id, deviceKey);
  if (!device) {
    db.prepare('INSERT INTO devices (staff_id,device_key,approved,created_at) VALUES (?,?,0,?)').run(staff.id, deviceKey, nowIso());
    logScan(staff.id, null, deviceKey, 'device_pending', 'New device requires owner approval');
    return res.status(403).json({error:'This phone is awaiting owner approval. Ask the shop owner to approve it.'});
  }
  if (!device.approved) return res.status(403).json({error:'This phone is not approved yet. Ask the shop owner.'});
  req.session.role='staff'; req.session.staffId=staff.id; req.session.deviceKey=deviceKey;
  res.json({ok:true, staff:{name:staff.name,code:staff.code}});
});

app.get('/api/owner/qr', ownerOnly, async (req,res)=>{
  const id = crypto.randomBytes(18).toString('hex');
  const expires = Math.floor(Date.now()/1000) + 30;
  const payload = {id, exp:expires, v:1};
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = body + '.' + sign(body);
  db.prepare('INSERT INTO qr_challenges (id,expires_at) VALUES (?,?)').run(id, expires);
  db.prepare('DELETE FROM qr_challenges WHERE expires_at < ? OR used=1').run(Math.floor(Date.now()/1000)-60);
  const dataUrl = await QRCode.toDataURL(token, {width:280, margin:2, errorCorrectionLevel:'M'});
  res.json({token,dataUrl,expiresAt:expires});
});

app.post('/api/owner/staff', ownerOnly, async (req,res)=>{
  const name=String(req.body.name||'').trim(), code=String(req.body.code||'').trim().toUpperCase(), pin=String(req.body.pin||'');
  if (!name || name.length>80 || !/^[A-Z0-9_-]{2,20}$/.test(code) || !/^\d{4,8}$/.test(pin)) return res.status(400).json({error:'Enter a name, staff code (2–20 letters/numbers), and 4–8 digit staff PIN.'});
  try {
    const hash=bcrypt.hashSync(pin,12);
    db.prepare('INSERT INTO staff (code,name,pin_hash,created_at) VALUES (?,?,?,?)').run(code,name,hash,nowIso());
    res.json({ok:true});
  } catch(e) { res.status(409).json({error:'That staff code already exists.'}); }
});
app.get('/api/owner/staff', ownerOnly, (req,res)=>res.json(db.prepare('SELECT id,code,name,active FROM staff ORDER BY name').all()));
app.get('/api/owner/devices', ownerOnly, (req,res)=>res.json(db.prepare('SELECT d.id,d.device_key,d.approved,d.created_at,s.name,s.code FROM devices d JOIN staff s ON s.id=d.staff_id ORDER BY d.approved,d.created_at DESC').all()));
app.post('/api/owner/devices/:id/approve', ownerOnly, (req,res)=>{db.prepare('UPDATE devices SET approved=1 WHERE id=?').run(Number(req.params.id));res.json({ok:true});});
app.post('/api/owner/devices/:id/revoke', ownerOnly, (req,res)=>{db.prepare('DELETE FROM devices WHERE id=?').run(Number(req.params.id));res.json({ok:true});});
app.post('/api/owner/staff/:id/toggle', ownerOnly, (req,res)=>{db.prepare('UPDATE staff SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(Number(req.params.id));res.json({ok:true});});

app.get('/api/owner/board', ownerOnly, (req,res)=>{
  const rows=db.prepare(`SELECT s.id,s.code,s.name,a.status,a.clock_in,a.break_started,a.clock_out,a.total_break_minutes,a.net_work_minutes
    FROM staff s LEFT JOIN attendance a ON a.staff_id=s.id AND a.work_date=? WHERE s.active=1 ORDER BY s.name`).all(today());
  res.json(rows.map(r=>({...r,status:r.status||'out'})));
});
app.get('/api/owner/logs', ownerOnly, (req,res)=>res.json(db.prepare(`SELECT sc.*,s.name,s.code FROM scans sc LEFT JOIN staff s ON s.id=sc.staff_id ORDER BY sc.id DESC LIMIT 250`).all()));
app.get('/api/owner/export.csv', ownerOnly, (req,res)=>{
  const rows=db.prepare(`SELECT s.code,s.name,a.work_date,a.clock_in,a.break_started,a.total_break_minutes,a.clock_out,a.net_work_minutes,a.status FROM attendance a JOIN staff s ON s.id=a.staff_id ORDER BY a.work_date DESC,s.name`).all();
  const cols=['code','name','work_date','clock_in','break_started','total_break_minutes','clock_out','net_work_minutes','status'];
  const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="rajarajeswari-attendance.csv"');
  res.send([cols.join(','),...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\r\n'));
});

app.post('/api/attendance/scan', staffOnly, (req,res)=>{
  const token=String(req.body.token||''), latitude=Number(req.body.latitude), longitude=Number(req.body.longitude);
  const coords={latitude,longitude}, device=req.session.deviceKey, staffId=req.session.staffId;
  const fail=(status,detail,code=400)=>{logScan(staffId,coords,device,status,detail);return res.status(code).json({error:detail});};
  if (!configured) return fail('blocked','Shop GPS coordinates are not configured by the owner.',503);
  if (!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude>90||longitude < -180||longitude>180) return fail('failed_gps','Valid GPS coordinates are required.');
  const meters=distanceMeters(SHOP_LAT,SHOP_LNG,latitude,longitude);
  if (meters>GEOFENCE) return fail('failed_geofence',`Outside the shop geofence (${Math.round(meters)} metres away).`,403);
  const parts=token.split('.');
  if (parts.length!==2 || !safeEqual(sign(parts[0]),parts[1])) return fail('failed_qr','Invalid QR signature.',403);
  let payload; try {payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));} catch {return fail('failed_qr','Unreadable QR token.',403);}
  if (!payload.id || !Number.isInteger(payload.exp) || payload.exp < Math.floor(Date.now()/1000)) return fail('expired_qr','QR code expired. Scan the live shop screen again.',403);
  const challenge=db.prepare('SELECT * FROM qr_challenges WHERE id=?').get(payload.id);
  if (!challenge || challenge.used || challenge.expires_at < Math.floor(Date.now()/1000)) return fail('replay_qr','QR code is invalid, expired or already used.',403);
  db.prepare('UPDATE qr_challenges SET used=1 WHERE id=? AND used=0').run(payload.id);
  const staff=db.prepare('SELECT name,code FROM staff WHERE id=?').get(staffId);
  let row=db.prepare('SELECT * FROM attendance WHERE staff_id=? AND work_date=?').get(staffId,today());
  if (!row) { db.prepare('INSERT INTO attendance (staff_id,work_date,status) VALUES (?,?,?)').run(staffId,today(),'out'); row=db.prepare('SELECT * FROM attendance WHERE staff_id=? AND work_date=?').get(staffId,today()); }
  const action=String(req.body.action||''); const time=nowIso();
  if (action==='in') {
    if (row.clock_in && !row.clock_out) return fail('rejected','You have already clocked in today.');
    if (row.clock_in && row.clock_out) return fail('rejected','Your attendance for today is already completed.');
    db.prepare("UPDATE attendance SET clock_in=?,status='in' WHERE id=?").run(time,row.id);
  } else if (action==='lunch') {
    if (!row.clock_in || row.clock_out) return fail('rejected','You must be clocked in to use lunch.');
    if (row.status==='lunch' && row.break_started) {
      const mins=Math.max(0,Math.round((Date.now()-new Date(row.break_started).getTime())/60000));
      db.prepare("UPDATE attendance SET break_started=NULL,total_break_minutes=total_break_minutes+?,status='in' WHERE id=?").run(mins,row.id);
    } else if (row.status==='in') {
      db.prepare("UPDATE attendance SET break_started=?,status='lunch' WHERE id=?").run(time,row.id);
    } else return fail('rejected','Lunch action is not available in the current status.');
  } else if (action==='out') {
    if (!row.clock_in || row.clock_out || row.status==='lunch') return fail('rejected','Finish lunch and ensure you are clocked in before clocking out.');
    const net=Math.max(0,Math.round((Date.now()-new Date(row.clock_in).getTime())/60000)-row.total_break_minutes);
    db.prepare("UPDATE attendance SET clock_out=?,status='out',net_work_minutes=? WHERE id=?").run(time,net,row.id);
  } else return fail('rejected','Unknown attendance action.');
  logScan(staffId,coords,device,'success',`Attendance action: ${action}`);
  const updated=db.prepare('SELECT * FROM attendance WHERE id=?').get(row.id);
  res.json({ok:true,staff,attendance:updated});
});

app.get('/api/staff/me', staffOnly, (req,res)=>{
  const staff=db.prepare('SELECT name,code FROM staff WHERE id=?').get(req.session.staffId);
  const attendance=db.prepare('SELECT * FROM attendance WHERE staff_id=? AND work_date=?').get(req.session.staffId,today());
  res.json({staff,attendance:attendance||null});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'dist','index.html')));
app.listen(PORT,()=>console.log(`Rajarajeswari Attendance running on http://localhost:${PORT}`));
