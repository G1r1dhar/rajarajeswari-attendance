import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

import {
  initDb,
  isMongo,
  createMongoSessionStore,
  getOwnerPin,
  setOwnerPin,
  findStaffByCode,
  findStaffById,
  listStaff,
  createStaff,
  updateStaffPin,
  toggleStaffActive,
  deleteStaff,
  findDevice,
  registerDevice,
  approveDevice,
  revokeDevice,
  listDevices,
  getAttendanceBoard,
  logScan,
  listScans,
  clearScans,
  listScansExport,
  getTodayAttendance,
  createAttendance,
  updateAttendance,
  listAttendanceExport,
  saveChallenge,
  findChallenge,
  markChallengeUsed,
  cleanupExpiredChallenges
} from './db.js';

dotenv.config();

const getLocalIp = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const QR_SECRET = process.env.QR_SIGNING_SECRET || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';

const SHOP_LAT =
  process.env.SHOP_LAT === '' || process.env.SHOP_LAT == null
    ? null
    : Number(process.env.SHOP_LAT);

const SHOP_LNG =
  process.env.SHOP_LNG === '' || process.env.SHOP_LNG == null
    ? null
    : Number(process.env.SHOP_LNG);

const GEOFENCE = Number(process.env.GEOFENCE_METERS || 50);

const configured =
  Number.isFinite(SHOP_LAT) &&
  Number.isFinite(SHOP_LNG) &&
  SHOP_LAT !== null &&
  SHOP_LNG !== null;

if (SESSION_SECRET.length < 32 || QR_SECRET.length < 32) {
  console.error(
    'Security setup required: SESSION_SECRET and QR_SIGNING_SECRET must each be at least 32 characters.'
  );
  process.exit(1);
}

// Render runs behind a proxy. Required for secure session cookies.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));

// Initialize Session Store
let sessionStore;
if (process.env.MONGODB_URI) {
  const MongoSessionStore = createMongoSessionStore(session);
  sessionStore = new MongoSessionStore();
} else {
  const SQLiteStore = connectSqlite3(session);
  sessionStore = new SQLiteStore({
    db: 'sessions.sqlite',
    dir: DATA_DIR
  });
}

app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

const sign = value =>
  crypto.createHmac('sha256', QR_SECRET).update(value).digest('hex');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function ownerOnly(req, res, next) {
  if (req.session.role !== 'owner') {
    return res.status(401).json({ error: 'Owner login required' });
  }
  next();
}

function staffOnly(req, res, next) {
  if (req.session.role !== 'staff') {
    return res.status(401).json({ error: 'Staff login required' });
  }
  next();
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const rad = n => n * Math.PI / 180;
  const R = 6371000;

  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) *
    Math.cos(rad(bLat)) *
    Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

const limiter = rateLimit({
  windowMs: 60000,
  limit: 150,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', limiter);

// Application status
app.get('/api/status', (req, res) => {
  res.json({
    configured,
    geofenceMeters: GEOFENCE,
    role: req.session.role || null,
    shopName: 'Rajarajeswari',
    shopLat: SHOP_LAT,
    shopLng: SHOP_LNG,
    localIp: getLocalIp(),
    storage: isMongo() ? 'mongodb' : 'sqlite'
  });
});

// Unified login for both Owner and Staff (One form: ID + PIN or QR Token)
app.post(
  '/api/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false
  }),
  async (req, res) => {
    const rawId = String(req.body.id || req.body.code || '').trim();
    const id = rawId.toUpperCase();
    const pin = String(req.body.pin || '');
    const deviceKey = String(req.body.deviceKey || '');
    const authToken = String(req.body.authToken || req.body.auth || '');

    // 1. QR Code Direct Login
    if (authToken && authToken.includes('.')) {
      const parts = authToken.split('.');
      if (parts.length === 2 && safeEqual(sign(parts[0]), parts[1])) {
        try {
          const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
          if (payload.code) {
            const staff = await findStaffByCode(payload.code);
            if (staff) {
              const cleanDevice = /^[a-zA-Z0-9_-]{16,100}$/.test(deviceKey)
                ? deviceKey
                : crypto.randomBytes(16).toString('hex');

              let device = await findDevice(staff.id, cleanDevice);
              if (!device) {
                await registerDevice(staff.id, cleanDevice, 1);
                await logScan(staff.id, null, cleanDevice, 'device_approved', 'Device registered via QR Code Login');
              } else if (!device.approved) {
                await approveDevice(device.id);
              }

              return req.session.regenerate(err => {
                if (err) return res.status(500).json({ error: 'Session error' });
                req.session.role = 'staff';
                req.session.staffId = staff.id;
                req.session.deviceKey = cleanDevice;
                req.session.save(err => {
                  if (err) return res.status(500).json({ error: 'Session save failed' });
                  res.json({
                    ok: true,
                    role: 'staff',
                    staff: { name: staff.name, code: staff.code }
                  });
                });
              });
            }
          }
        } catch {}
      }
    }

    if (!id || !pin) {
      return res.status(400).json({ error: 'Please enter both ID and PIN.' });
    }

    const expectedOwnerPin = await getOwnerPin();
    const isOwnerId = id === 'OWNER' || id === 'ADMIN' || (process.env.OWNER_ID && id === process.env.OWNER_ID.toUpperCase());

    if (isOwnerId) {
      if (!/^\d{4,8}$/.test(pin) || !expectedOwnerPin || !safeEqual(pin, expectedOwnerPin)) {
        return res.status(401).json({ error: 'Invalid Admin ID or PIN.' });
      }

      return req.session.regenerate(err => {
        if (err) return res.status(500).json({ error: 'Session error' });

        req.session.role = 'owner';
        req.session.staffId = null;

        req.session.save(err => {
          if (err) return res.status(500).json({ error: 'Session save failed' });
          res.json({ ok: true, role: 'owner' });
        });
      });
    }

    // Staff authentication
    const staff = await findStaffByCode(id);

    if (!staff || !bcrypt.compareSync(pin, staff.pin_hash)) {
      await logScan(staff?.id, null, deviceKey, 'failed_login', 'Invalid credentials');
      return res.status(401).json({ error: 'Invalid ID or PIN.' });
    }

    const cleanDevice = /^[a-zA-Z0-9_-]{16,100}$/.test(deviceKey)
      ? deviceKey
      : crypto.randomBytes(16).toString('hex');

    let device = await findDevice(staff.id, cleanDevice);

    if (!device) {
      await registerDevice(staff.id, cleanDevice, 1);
      await logScan(staff.id, null, cleanDevice, 'device_approved', 'New device registered & approved');
    } else if (!device.approved) {
      await approveDevice(device.id);
    }

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error' });

      req.session.role = 'staff';
      req.session.staffId = staff.id;
      req.session.deviceKey = cleanDevice;

      req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Session save failed' });
        res.json({
          ok: true,
          role: 'staff',
          staff: {
            name: staff.name,
            code: staff.code
          }
        });
      });
    });
  }
);

// Update Owner unique PIN
app.post('/api/owner/pin', ownerOnly, async (req, res) => {
  const newPin = String(req.body.newPin || '').trim();

  if (!/^\d{4,8}$/.test(newPin)) {
    return res.status(400).json({ error: 'Owner PIN must be 4–8 digits.' });
  }

  await setOwnerPin(newPin);
  res.json({ ok: true, message: 'Owner PIN updated successfully.' });
});

// Owner login (legacy support)
app.post(
  '/api/owner/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false
  }),
  async (req, res) => {
    const pin = String(req.body.pin || '');
    const expectedOwnerPin = await getOwnerPin();

    if (!/^\d{4,8}$/.test(pin) || !expectedOwnerPin || !safeEqual(pin, expectedOwnerPin)) {
      return res.status(401).json({ error: 'Invalid owner PIN' });
    }

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error' });

      req.session.role = 'owner';
      req.session.staffId = null;

      req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Session save failed' });
        res.json({ ok: true });
      });
    });
  }
);

// Staff login (legacy support)
app.post(
  '/api/staff/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false
  }),
  async (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const pin = String(req.body.pin || '');
    const deviceKey = String(req.body.deviceKey || '');

    const staff = await findStaffByCode(code);

    if (!staff || !bcrypt.compareSync(pin, staff.pin_hash)) {
      await logScan(staff?.id, null, deviceKey, 'failed_login', 'Invalid code or PIN');
      return res.status(401).json({ error: 'Invalid staff code or PIN' });
    }

    const cleanDevice = /^[a-zA-Z0-9_-]{16,100}$/.test(deviceKey)
      ? deviceKey
      : crypto.randomBytes(16).toString('hex');

    let device = await findDevice(staff.id, cleanDevice);
    if (!device) {
      await registerDevice(staff.id, cleanDevice, 1);
    } else if (!device.approved) {
      await approveDevice(device.id);
    }

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error' });

      req.session.role = 'staff';
      req.session.staffId = staff.id;
      req.session.deviceKey = cleanDevice;

      req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Session save failed' });
        res.json({
          ok: true,
          staff: {
            name: staff.name,
            code: staff.code
          }
        });
      });
    });
  }
);

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Owner Shop QR Code generator
app.get('/api/owner/qr', ownerOnly, async (req, res) => {
  const expires = Math.floor(Date.now() / 1000) + 45;
  const id = crypto.randomBytes(16).toString('hex');
  const passcode = id.slice(0, 6).toUpperCase();

  const payload = { id, exp: expires, v: 1, code: passcode };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = body + '.' + sign(body);

  await saveChallenge({ id, expires_at: expires, passcode });
  await cleanupExpiredChallenges();

  const localIp = getLocalIp();
  const scanUrl = `http://${localIp}:5173/?scan=${encodeURIComponent(token)}`;

  const dataUrl = await QRCode.toDataURL(scanUrl, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M'
  });

  res.json({ token, scanUrl, dataUrl, expiresAt: expires, passcode });
});

// Add staff
app.post('/api/owner/staff', ownerOnly, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim().toUpperCase();
  const pin = String(req.body.pin || '');

  if (
    !name ||
    name.length > 80 ||
    !/^[A-Z0-9_-]{2,20}$/.test(code) ||
    !/^\d{4,8}$/.test(pin)
  ) {
    return res.status(400).json({
      error: 'Enter a name, staff code (2–20 letters/numbers), and 4–8 digit staff PIN.'
    });
  }

  try {
    const hash = bcrypt.hashSync(pin, 12);
    await createStaff({ code, name, pin_hash: hash });
    res.json({ ok: true });
  } catch (error) {
    res.status(409).json({
      error: 'That staff code already exists.'
    });
  }
});

// List staff
app.get('/api/owner/staff', ownerOnly, async (req, res) => {
  const list = await listStaff();
  res.json(list.map(s => ({ id: s.id, code: s.code, name: s.name, active: s.active })));
});

// List registered devices
app.get('/api/owner/devices', ownerOnly, async (req, res) => {
  res.json(await listDevices());
});

// Approve device
app.post('/api/owner/devices/:id/approve', ownerOnly, async (req, res) => {
  await approveDevice(Number(req.params.id));
  res.json({ ok: true });
});

// Revoke device
app.post('/api/owner/devices/:id/revoke', ownerOnly, async (req, res) => {
  await revokeDevice(Number(req.params.id));
  res.json({ ok: true });
});

// Activate/deactivate staff
app.post('/api/owner/staff/:id/toggle', ownerOnly, async (req, res) => {
  await toggleStaffActive(Number(req.params.id));
  res.json({ ok: true });
});

// Delete staff member (permanent deletion)
app.delete('/api/owner/staff/:id', ownerOnly, async (req, res) => {
  await deleteStaff(Number(req.params.id));
  res.json({ ok: true, message: 'Staff member deleted successfully' });
});

app.post('/api/owner/staff/:id/delete', ownerOnly, async (req, res) => {
  await deleteStaff(Number(req.params.id));
  res.json({ ok: true, message: 'Staff member deleted successfully' });
});

// Admin reset staff PIN
app.post('/api/owner/staff/:id/pin', ownerOnly, async (req, res) => {
  const staffId = Number(req.params.id);
  const newPin = String(req.body.pin || '').trim();

  if (!/^\d{4,8}$/.test(newPin)) {
    return res.status(400).json({ error: 'PIN must be between 4 and 8 digits.' });
  }

  const staff = await findStaffById(staffId);
  if (!staff) return res.status(404).json({ error: 'Staff member not found.' });

  const hash = bcrypt.hashSync(newPin, 12);
  await updateStaffPin(staffId, hash);
  await logScan(staffId, null, null, 'admin_pin_reset', `Admin reset PIN for staff ${staff.code}`);

  res.json({ ok: true, message: `PIN updated successfully for ${staff.name} (${staff.code}).` });
});

// Admin attendance board with calendar date filter
app.get('/api/owner/board', ownerOnly, async (req, res) => {
  const targetDate = String(req.query.date || today()).slice(0, 10);
  const rows = await getAttendanceBoard(targetDate);
  res.json(rows);
});

// Staff Login QR Code generator
app.get('/api/owner/staff/:id/login-qr', ownerOnly, async (req, res) => {
  const staff = await findStaffById(Number(req.params.id));
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });

  const payload = { code: staff.code, t: Date.now() };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = body + '.' + sign(body);

  const localIp = getLocalIp();
  const directLoginUrl = `http://${localIp}:5173/?auth=${token}`;
  const dataUrl = await QRCode.toDataURL(directLoginUrl, { width: 320, margin: 2 });

  res.json({
    ok: true,
    name: staff.name,
    code: staff.code,
    loginUrl: directLoginUrl,
    dataUrl
  });
});

// Scan logs
app.get('/api/owner/logs', ownerOnly, async (req, res) => {
  res.json(await listScans(250));
});

// Clear Security Audit Logs
app.delete('/api/owner/logs', ownerOnly, async (req, res) => {
  await clearScans();
  res.json({ ok: true, message: 'Security audit logs cleared' });
});

// Export Security Audit Logs CSV
app.get('/api/owner/export-logs.csv', ownerOnly, async (req, res) => {
  const rows = await listScansExport();

  const cols = [
    'id',
    'attempted_at',
    'code',
    'name',
    'result',
    'latitude',
    'longitude',
    'device_key',
    'detail'
  ];

  const esc = value =>
    '"' + String(value ?? '').replace(/"/g, '""') + '"';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="rajarajeswari-security-audit-logs.csv"'
  );

  res.send([
    cols.join(','),
    ...rows.map(row => cols.map(col => esc(row[col])).join(','))
  ].join('\r\n'));
});

// Export attendance CSV
app.get('/api/owner/export.csv', ownerOnly, async (req, res) => {
  const rows = await listAttendanceExport();

  const cols = [
    'code',
    'name',
    'work_date',
    'clock_in',
    'break_started',
    'total_break_minutes',
    'clock_out',
    'net_work_minutes',
    'status'
  ];

  const esc = value =>
    '"' + String(value ?? '').replace(/"/g, '""') + '"';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="rajarajeswari-attendance.csv"'
  );

  res.send([
    cols.join(','),
    ...rows.map(row => cols.map(col => esc(row[col])).join(','))
  ].join('\r\n'));
});

// Attendance QR scan
app.post('/api/attendance/scan', async (req, res) => {
  let rawToken = String(req.body.token || '').trim();
  if (rawToken.includes('?scan=')) {
    const match = rawToken.match(/[?&]scan=([^&#]+)/);
    if (match) rawToken = decodeURIComponent(match[1]);
  }

  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  const coords = hasCoords ? { latitude, longitude } : null;

  let device = req.session.deviceKey || String(req.body.deviceKey || '');
  let staffId = req.session.staffId;

  // Support inline login if credentials passed with scan
  if (!staffId && req.body.code && req.body.pin) {
    const code = String(req.body.code).trim().toUpperCase();
    const pin = String(req.body.pin);
    const staff = await findStaffByCode(code);
    if (staff && bcrypt.compareSync(pin, staff.pin_hash)) {
      staffId = staff.id;
      req.session.role = 'staff';
      req.session.staffId = staff.id;
      req.session.deviceKey = device;
    } else {
      await logScan(null, coords, device, 'failed_login', `Login failed during scan for Staff ID ${code}`);
      return res.status(401).json({ error: 'Invalid Staff ID or PIN' });
    }
  }

  const fail = async (status, detail, code = 400) => {
    await logScan(staffId, coords, device, status, detail);
    return res.status(code).json({ error: detail });
  };

  if (!staffId) {
    return await fail('unauthenticated_scan', 'Staff login required to record attendance.', 401);
  }

  if (!configured) {
    return await fail('blocked', 'Shop GPS coordinates are not configured by the owner.', 503);
  }

  if (!hasCoords) {
    return await fail('failed_gps', 'Valid GPS coordinates are required to verify presence.');
  }

  const meters = distanceMeters(SHOP_LAT, SHOP_LNG, latitude, longitude);

  if (meters > GEOFENCE) {
    return await fail('failed_geofence', `Outside the shop geofence (${Math.round(meters)} metres away).`, 403);
  }

  let payloadId = null;

  if (rawToken.includes('.')) {
    const parts = rawToken.split('.');
    if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) {
      return await fail('failed_qr', 'Invalid QR signature.', 403);
    }

    try {
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      if (!payload.id || !Number.isInteger(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) {
        return await fail('expired_qr', 'QR code expired. Scan the live shop screen again.', 403);
      }
      payloadId = payload.id;
    } catch {
      return await fail('failed_qr', 'Unreadable QR token.', 403);
    }
  } else {
    // 6-character live shop passcode support
    const cleanPasscode = rawToken.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const challenge = await findChallenge(cleanPasscode);

    if (!challenge) {
      return await fail('invalid_passcode', 'Invalid or expired shop QR passcode.', 403);
    }
    payloadId = challenge.id;
  }

  const challenge = await findChallenge(payloadId);

  if (!challenge || challenge.used || challenge.expires_at < Math.floor(Date.now() / 1000)) {
    return await fail('replay_qr', 'QR code is invalid, expired or already used.', 403);
  }

  const consumed = await markChallengeUsed(payloadId);
  if (!consumed) {
    return await fail('replay_qr', 'QR code has already been used.', 403);
  }

  const staff = await findStaffById(staffId);
  let row = await getTodayAttendance(staffId, today());

  if (!row) {
    row = await createAttendance({ staff_id: staffId, work_date: today(), status: 'out' });
  }

  let action = String(req.body.action || '').trim().toLowerCase();
  if (!action) {
    if (!row.clock_in) {
      action = 'in';
    } else if (row.status === 'lunch') {
      action = 'lunch';
    } else {
      action = 'out';
    }
  }
  const time = nowIso();

  if (action === 'in') {
    if (row.clock_in && !row.clock_out) {
      return await fail('rejected', 'You have already clocked in today.');
    }
    if (row.clock_in && row.clock_out) {
      return await fail('rejected', 'Your attendance for today is already completed.');
    }
    row = await updateAttendance(row.id, { clock_in: time, status: 'in' });

  } else if (action === 'lunch') {
    if (!row.clock_in || row.clock_out) {
      return await fail('rejected', 'You must be clocked in to use lunch.');
    }

    if (row.status === 'lunch' && row.break_started) {
      const mins = Math.max(
        0,
        Math.round((Date.now() - new Date(row.break_started).getTime()) / 60000)
      );

      row = await updateAttendance(row.id, {
        break_started: null,
        total_break_minutes: (row.total_break_minutes || 0) + mins,
        status: 'in'
      });
    } else if (row.status === 'in') {
      row = await updateAttendance(row.id, { break_started: time, status: 'lunch' });
    } else {
      return await fail('rejected', 'Lunch action is not available in the current status.');
    }

  } else if (action === 'out') {
    if (!row.clock_in || row.clock_out || row.status === 'lunch') {
      return await fail('rejected', 'Finish lunch and ensure you are clocked in before clocking out.');
    }

    const net = Math.max(
      0,
      Math.round((Date.now() - new Date(row.clock_in).getTime()) / 60000) - (row.total_break_minutes || 0)
    );

    row = await updateAttendance(row.id, { clock_out: time, status: 'out', net_work_minutes: net });

  } else {
    return await fail('rejected', 'Unknown attendance action.');
  }

  await logScan(staffId, coords, device, 'success', `Attendance action: ${action}`);

  res.json({
    ok: true,
    staff: { name: staff.name, code: staff.code },
    attendance: row
  });
});

// Staff dashboard
app.get('/api/staff/me', staffOnly, async (req, res) => {
  const staff = await findStaffById(req.session.staffId);
  const attendance = await getTodayAttendance(req.session.staffId, today());

  res.json({
    staff: staff ? { name: staff.name, code: staff.code } : null,
    attendance: attendance || null
  });
});

// Staff self-service PIN change
app.post('/api/staff/pin', staffOnly, async (req, res) => {
  const currentPin = String(req.body.currentPin || '');
  const newPin = String(req.body.newPin || '').trim();

  if (!/^\d{4,8}$/.test(newPin)) {
    return res.status(400).json({ error: 'New PIN must be between 4 and 8 numeric digits.' });
  }

  const staff = await findStaffById(req.session.staffId);
  if (!staff) {
    return res.status(404).json({ error: 'Staff account not found.' });
  }

  if (!bcrypt.compareSync(currentPin, staff.pin_hash)) {
    await logScan(staff.id, null, req.session.deviceKey, 'failed_pin_change', 'Incorrect current PIN provided');
    return res.status(401).json({ error: 'Current PIN is incorrect.' });
  }

  const newHash = bcrypt.hashSync(newPin, 12);
  await updateStaffPin(staff.id, newHash);
  await logScan(staff.id, null, req.session.deviceKey, 'pin_changed', 'Staff updated their security PIN');

  res.json({ ok: true, message: 'Your security PIN has been updated successfully.' });
});

// React frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Initialize DB and start server
async function startServer() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rajarajeswari Attendance running on port ${PORT} [Storage: ${isMongo() ? 'MongoDB Atlas' : 'SQLite'}]`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
