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
  getSetting,
  setSetting,
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
  getOpenAttendances,
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

const getBaseUrl = (req) => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }

  const forwardedHost = req.get('x-forwarded-host');
  const host = forwardedHost || req.get('host') || '';
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = forwardedProto || (req.secure ? 'https' : (host.includes('onrender.com') ? 'https' : 'http'));

  if (host.includes('onrender.com')) {
    return `https://${host}`;
  }

  // If request comes from browser origin/referer (e.g. Vite dev on :5173 or custom port)
  const origin = req.get('origin') || req.get('referer');
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.protocol && u.host) {
        return `${u.protocol}//${u.host}`;
      }
    } catch (_) {}
  }

  if (host) {
    return `${proto}://${host}`;
  }

  const localIp = getLocalIp();
  return `http://${localIp}:5173`;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_QR_SECRET = '021f4d885ed69d1875d738cdf6b2cf2a1cc1a6834531ee6298fd9613295dc2a5';
const QR_SECRET = process.env.QR_SIGNING_SECRET || DEFAULT_QR_SECRET;

const DEFAULT_SESSION_SECRET = 'e9a6ea7cd07805595f4870f8d177a787088ab37113b5d508c87dc81e5e5b2f4a';
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;

async function getShopConfig() {
  const dbLat = await getSetting('shop_lat');
  const dbLng = await getSetting('shop_lng');
  const dbGeofence = await getSetting('geofence_meters');

  // Prioritize environment variables configured in Render dashboard
  const envLat = process.env.SHOP_LAT ? Number(process.env.SHOP_LAT) : null;
  const envLng = process.env.SHOP_LNG ? Number(process.env.SHOP_LNG) : null;
  const envGeofence = process.env.GEOFENCE_METERS ? Number(process.env.GEOFENCE_METERS) : null;

  const lat = envLat !== null && Number.isFinite(envLat)
    ? envLat
    : (dbLat !== null && dbLat !== undefined && dbLat !== '' ? Number(dbLat) : null);

  const lng = envLng !== null && Number.isFinite(envLng)
    ? envLng
    : (dbLng !== null && dbLng !== undefined && dbLng !== '' ? Number(dbLng) : null);

  const geofence = envGeofence && Number.isFinite(envGeofence)
    ? envGeofence
    : (dbGeofence ? Number(dbGeofence) : 150);

  const isConfigured = Number.isFinite(lat) && Number.isFinite(lng) && lat !== null && lng !== null;
  return { lat, lng, geofence, isConfigured };
}

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
app.get('/api/status', async (req, res) => {
  const shopConfig = await getShopConfig();
  const baseUrl = getBaseUrl(req);
  res.json({
    configured: shopConfig.isConfigured,
    geofenceMeters: shopConfig.geofence,
    role: req.session.role || null,
    shopName: 'Rajarajeswari',
    shopLat: shopConfig.lat,
    shopLng: shopConfig.lng,
    localIp: getLocalIp(),
    baseUrl,
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
    if (authToken) {
      const cleanAuth = String(authToken).trim();
      let tokenToVerify = cleanAuth;

      if (cleanAuth.includes('?auth=')) {
        try {
          const u = new URL(cleanAuth);
          tokenToVerify = u.searchParams.get('auth') || cleanAuth;
        } catch {
          const m = cleanAuth.match(/[?&]auth=([^&#]+)/);
          if (m) tokenToVerify = decodeURIComponent(m[1]);
        }
      }

      if (tokenToVerify.includes('.')) {
        const parts = tokenToVerify.split('.');
        if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) {
          return res.status(401).json({
            error: 'QR login signature mismatch. Please generate the staff QR on the live portal (https://rajarajeswari-attendance.onrender.com) so both devices use the same server key.'
          });
        }

        try {
          const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
          if (payload.id && payload.exp) {
            return res.status(400).json({
              error: 'That is the Shop Attendance QR. To sign in, enter your Staff ID & PIN or scan your personal Staff Login QR.'
            });
          }

          if (payload.code) {
            const staff = await findStaffByCode(payload.code);
            if (!staff) {
              return res.status(404).json({ error: `Staff member (${payload.code}) not found in database.` });
            }

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
        } catch {
          return res.status(400).json({ error: 'Corrupted QR code data.' });
        }
      } else {
        return res.status(400).json({ error: 'Invalid QR token format.' });
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
  const expires = Math.floor(Date.now() / 1000) + 90; // 90 seconds lifetime
  const id = crypto.randomBytes(16).toString('hex');
  const passcode = id.slice(0, 6).toUpperCase();

  const payload = { id, exp: expires, v: 1, code: passcode };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = body + '.' + sign(body);

  await saveChallenge({ id, expires_at: expires, passcode });
  await cleanupExpiredChallenges();

  const baseUrl = getBaseUrl(req);
  const scanUrl = `${baseUrl}/?scan=${encodeURIComponent(token)}`;

  const dataUrl = await QRCode.toDataURL(scanUrl, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M'
  });

  res.json({ token, scanUrl, dataUrl, expiresAt: expires, passcode, baseUrl });
});

// Calibrate or update Shop GPS location & Geofence
app.post('/api/owner/location', ownerOnly, async (req, res) => {
  const lat = Number(req.body.latitude);
  const lng = Number(req.body.longitude);
  const geofence = req.body.geofence ? Number(req.body.geofence) : null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid latitude (-90 to 90) and longitude (-180 to 180) are required.' });
  }

  await setSetting('shop_lat', String(lat));
  await setSetting('shop_lng', String(lng));
  if (geofence && geofence > 0) {
    await setSetting('geofence_meters', String(geofence));
  }

  res.json({ ok: true, latitude: lat, longitude: lng, geofence: geofence || 100 });
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

// Auto-Cut Worker: Closes all open shifts at Shop Closing Time (9:45 PM IST)
async function autoCutShopClosing() {
  try {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: 'numeric',
      minute: 'numeric'
    }).formatToParts(d);
    const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find(p => p.type === 'minute')?.value || 0);
    const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

    const isPastClosing = hour > 21 || (hour === 21 && minute >= 45);

    const openRows = await getOpenAttendances();
    for (const row of openRows) {
      const isPastDay = row.work_date < istToday;
      const isTodayAndPastClosing = row.work_date === istToday && isPastClosing;

      if (isPastDay || isTodayAndPastClosing) {
        const closingIso = new Date(`${row.work_date}T21:45:00+05:30`).toISOString();

        if (row.status === 'emergency') {
          // Left on emergency exit and never came back -> Marked as Day Off / Incomplete
          const cutTime = row.emergency_started || row.emergency_start || closingIso;
          const net = Math.max(
            0,
            Math.round((new Date(cutTime).getTime() - new Date(row.clock_in).getTime()) / 60000) -
              (row.total_break_minutes || 0) - (row.total_emergency_minutes || 0)
          );

          await updateAttendance(row.id, {
            clock_out: cutTime,
            emergency_started: null,
            emergency_end: cutTime,
            status: 'day_off',
            auto_cut: 1,
            note: 'Auto cut at 9:45 PM (Emergency Exit - Day Off)',
            net_work_minutes: net
          });

          await logScan(row.staff_id, null, null, 'auto_cut', 'Auto cut at 9:45 PM: Left on Emergency Exit (Day Off)');
        } else if (row.status === 'lunch') {
          const cutTime = closingIso;
          const net = Math.max(
            0,
            Math.round((new Date(cutTime).getTime() - new Date(row.clock_in).getTime()) / 60000) -
              (row.total_break_minutes || 0) - (row.total_emergency_minutes || 0)
          );

          await updateAttendance(row.id, {
            clock_out: cutTime,
            break_started: null,
            lunch_end: cutTime,
            status: 'out',
            auto_cut: 1,
            note: 'Auto cut at 9:45 PM (Shop Closing)',
            net_work_minutes: net
          });

          await logScan(row.staff_id, null, null, 'auto_cut', 'Auto cut at 9:45 PM: Shift closed');
        } else {
          // Active on duty
          const cutTime = closingIso;
          const net = Math.max(
            0,
            Math.round((new Date(cutTime).getTime() - new Date(row.clock_in).getTime()) / 60000) -
              (row.total_break_minutes || 0) - (row.total_emergency_minutes || 0)
          );

          await updateAttendance(row.id, {
            clock_out: cutTime,
            status: 'out',
            auto_cut: 1,
            note: 'Auto cut at 9:45 PM (Shop Closing)',
            net_work_minutes: net
          });

          await logScan(row.staff_id, null, null, 'auto_cut', 'Auto cut at 9:45 PM: Shift closed');
        }
      }
    }
  } catch (err) {
    console.error('Error in autoCutShopClosing:', err);
  }
}

// Background auto-cut runner every 60 seconds
setInterval(autoCutShopClosing, 60 * 1000);

// Admin attendance board with calendar date filter
app.get('/api/owner/board', ownerOnly, async (req, res) => {
  await autoCutShopClosing();
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

  const baseUrl = getBaseUrl(req);
  const directLoginUrl = `${baseUrl}/?auth=${token}`;
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
    'lunch_start',
    'lunch_end',
    'total_break_minutes',
    'emergency_start',
    'emergency_end',
    'total_emergency_minutes',
    'clock_out',
    'net_work_minutes',
    'status',
    'auto_cut',
    'note'
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

  const shopConfig = await getShopConfig();

  if (!shopConfig.isConfigured) {
    return await fail('blocked', 'Shop GPS coordinates are not configured. The owner can set them in Admin settings.', 503);
  }

  if (!hasCoords) {
    return await fail('failed_gps', 'Valid GPS coordinates are required to verify presence.');
  }

  const meters = distanceMeters(shopConfig.lat, shopConfig.lng, latitude, longitude);

  if (meters > shopConfig.geofence) {
    return await fail('failed_geofence', `Outside shop geofence (${Math.round(meters)}m away, limit is ${shopConfig.geofence}m).`, 403);
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
    if (row.status === 'emergency') {
      return await fail('rejected', 'Please return from Emergency Exit before starting lunch.');
    }

    if (row.status === 'lunch' && row.break_started) {
      const mins = Math.max(
        0,
        Math.round((Date.now() - new Date(row.break_started).getTime()) / 60000)
      );

      row = await updateAttendance(row.id, {
        break_started: null,
        lunch_start: row.lunch_start || row.break_started,
        lunch_end: time,
        total_break_minutes: (row.total_break_minutes || 0) + mins,
        status: 'in'
      });
    } else if (row.status === 'in') {
      if ((row.total_break_minutes || 0) > 0) {
        return await fail('rejected', 'Lunch break has already been completed for today.');
      }
      row = await updateAttendance(row.id, {
        break_started: time,
        lunch_start: time,
        lunch_end: null,
        status: 'lunch'
      });
    } else {
      return await fail('rejected', 'Lunch action is not available in the current status.');
    }

  } else if (action === 'emergency') {
    if (!row.clock_in || row.clock_out) {
      return await fail('rejected', 'You must be clocked in to record an emergency exit.');
    }
    if (row.status === 'lunch') {
      return await fail('rejected', 'Please return from lunch before recording an emergency exit.');
    }

    if (row.status === 'emergency' && row.emergency_started) {
      // Returning from emergency exit -> resume duty
      const mins = Math.max(
        0,
        Math.round((Date.now() - new Date(row.emergency_started).getTime()) / 60000)
      );

      row = await updateAttendance(row.id, {
        emergency_started: null,
        emergency_start: row.emergency_start || row.emergency_started,
        emergency_end: time,
        total_emergency_minutes: (row.total_emergency_minutes || 0) + mins,
        status: 'in'
      });
    } else if (row.status === 'in') {
      // Stepping out on emergency exit
      row = await updateAttendance(row.id, {
        emergency_started: time,
        emergency_start: time,
        emergency_end: null,
        status: 'emergency'
      });
    } else {
      return await fail('rejected', 'Emergency action is not available in the current status.');
    }

  } else if (action === 'out') {
    if (!row.clock_in || row.clock_out) {
      return await fail('rejected', 'You must be clocked in before clocking out.');
    }
    if (row.status === 'lunch') {
      return await fail('rejected', 'Finish lunch and ensure you are clocked in before clocking out.');
    }

    if (row.status === 'emergency') {
      // Clocking out while in emergency exit -> Day Off / Early Exit
      const cutTime = row.emergency_started || time;
      const net = Math.max(
        0,
        Math.round((new Date(cutTime).getTime() - new Date(row.clock_in).getTime()) / 60000) -
          (row.total_break_minutes || 0) - (row.total_emergency_minutes || 0)
      );

      row = await updateAttendance(row.id, {
        emergency_started: null,
        emergency_end: cutTime,
        clock_out: cutTime,
        status: 'day_off',
        note: 'Left on Emergency Exit (Day Off)',
        net_work_minutes: net
      });
    } else {
      const net = Math.max(
        0,
        Math.round((Date.now() - new Date(row.clock_in).getTime()) / 60000) -
          (row.total_break_minutes || 0) - (row.total_emergency_minutes || 0)
      );

      row = await updateAttendance(row.id, {
        clock_out: time,
        status: 'out',
        net_work_minutes: net
      });
    }

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
  await autoCutShopClosing();
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
