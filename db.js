import { MongoClient } from 'mongodb';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || __dirname;

let mongoClient = null;
let mongoDb = null;
let sqliteDb = null;
let usingMongo = false;

export function isMongo() {
  return usingMongo;
}

export function createMongoSessionStore(session) {
  const Store = session.Store;
  return class MongoSessionStore extends Store {
    constructor(options = {}) {
      super(options);
    }
    async get(sid, fn) {
      try {
        if (!mongoDb) return fn(null, null);
        const doc = await mongoDb.collection('sessions').findOne({ _id: sid });
        if (!doc) return fn(null, null);
        if (doc.expires && new Date(doc.expires) < new Date()) {
          await mongoDb.collection('sessions').deleteOne({ _id: sid });
          return fn(null, null);
        }
        return fn(null, doc.session);
      } catch (err) {
        return fn(err);
      }
    }
    async set(sid, sess, fn) {
      try {
        if (!mongoDb) return fn ? fn(null) : null;
        const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + 8 * 60 * 60 * 1000);
        await mongoDb.collection('sessions').updateOne(
          { _id: sid },
          { $set: { session: sess, expires } },
          { upsert: true }
        );
        return fn ? fn(null) : null;
      } catch (err) {
        return fn ? fn(err) : null;
      }
    }
    async destroy(sid, fn) {
      try {
        if (mongoDb) await mongoDb.collection('sessions').deleteOne({ _id: sid });
        return fn ? fn(null) : null;
      } catch (err) {
        return fn ? fn(err) : null;
      }
    }
    async touch(sid, sess, fn) {
      try {
        if (!mongoDb) return fn ? fn(null) : null;
        const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + 8 * 60 * 60 * 1000);
        await mongoDb.collection('sessions').updateOne(
          { _id: sid },
          { $set: { expires } }
        );
        return fn ? fn(null) : null;
      } catch (err) {
        return fn ? fn(err) : null;
      }
    }
  };
}

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export async function initDb() {
  const mongoUri = process.env.MONGODB_URI;

  if (mongoUri) {
    try {
      console.log('Connecting to MongoDB Atlas...');
      mongoClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
      await mongoClient.connect();
      mongoDb = mongoClient.db(process.env.MONGODB_DB_NAME || 'rajarajeswari');
      usingMongo = true;
      console.log('✓ Successfully connected to MongoDB Atlas!');

      // Create indexes safely
      try {
        await mongoDb.collection('staff').createIndex({ code: 1 }, { unique: true });
        await mongoDb.collection('devices').createIndex({ staff_id: 1, device_key: 1 });
        await mongoDb.collection('attendance').createIndex({ staff_id: 1, work_date: 1 }, { unique: true });
        await mongoDb.collection('scans').createIndex({ attempted_at: -1 });
        await mongoDb.collection('qr_challenges').createIndex({ expires_at: 1 }, { expireAfterSeconds: 120 });
      } catch (idxErr) {
        console.warn('Index note:', idxErr.message);
      }

      // Check if we should migrate existing SQLite data
      await migrateFromSqliteIfNeeded();
      return;
    } catch (err) {
      console.error('Failed to connect to MongoDB Atlas:', err.message);
      console.log('Falling back to local SQLite database...');
      usingMongo = false;
    }
  }

  // Fallback to SQLite
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sqliteDb = new Database(path.join(DATA_DIR, 'attendance.sqlite'));

  const schema = `
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    device_key TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(staff_id, device_key)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    work_date TEXT NOT NULL,
    clock_in TEXT,
    clock_out TEXT,
    status TEXT NOT NULL DEFAULT 'out',
    break_started TEXT,
    total_break_minutes INTEGER NOT NULL DEFAULT 0,
    net_work_minutes INTEGER
  );

  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    attempted_at TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    device_key TEXT,
    result TEXT NOT NULL,
    detail TEXT
  );

  CREATE TABLE IF NOT EXISTS qr_challenges (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `;
  sqliteDb.exec(schema);
  console.log('✓ Initialized local SQLite database.');
}

async function getNextSequence(name) {
  if (!usingMongo) return null;
  const result = await mongoDb.collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result?.seq || (await mongoDb.collection(name).countDocuments()) + 1;
}

async function migrateFromSqliteIfNeeded() {
  try {
    const sqlitePath = path.join(DATA_DIR, 'attendance.sqlite');
    if (!fs.existsSync(sqlitePath)) return;

    const staffCount = await mongoDb.collection('staff').countDocuments();
    if (staffCount > 0) return; // Already has data

    console.log('Migrating existing data from SQLite to MongoDB Atlas...');
    const localDb = new Database(sqlitePath);

    const staffList = localDb.prepare('SELECT * FROM staff').all();
    for (const s of staffList) {
      await mongoDb.collection('staff').updateOne(
        { code: s.code },
        { $setOnInsert: { id: s.id, code: s.code, name: s.name, pin_hash: s.pin_hash, active: s.active, created_at: s.created_at } },
        { upsert: true }
      );
      await mongoDb.collection('counters').updateOne(
        { _id: 'staff' },
        { $max: { seq: s.id } },
        { upsert: true }
      );
    }

    const settingsList = localDb.prepare('SELECT * FROM settings').all();
    for (const set of settingsList) {
      await mongoDb.collection('settings').updateOne(
        { key: set.key },
        { $set: { value: set.value } },
        { upsert: true }
      );
    }

    console.log(`✓ Migrated ${staffList.length} staff member(s) to MongoDB Atlas.`);
  } catch (err) {
    console.warn('SQLite migration skipped:', err.message);
  }
}

// ----------------------------------------------------
// SETTINGS
// ----------------------------------------------------
export async function getOwnerPin() {
  if (usingMongo) {
    const row = await mongoDb.collection('settings').findOne({ key: 'owner_pin' });
    return row ? String(row.value) : String(process.env.OWNER_PIN || '');
  }
  const row = sqliteDb.prepare('SELECT value FROM settings WHERE key = ?').get('owner_pin');
  return row ? String(row.value) : String(process.env.OWNER_PIN || '');
}

export async function setOwnerPin(newPin) {
  if (usingMongo) {
    await mongoDb.collection('settings').updateOne(
      { key: 'owner_pin' },
      { $set: { value: String(newPin) } },
      { upsert: true }
    );
    return;
  }
  sqliteDb.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('owner_pin', String(newPin));
}

// ----------------------------------------------------
// STAFF
// ----------------------------------------------------
export async function findStaffByCode(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (usingMongo) {
    return await mongoDb.collection('staff').findOne({ code: cleanCode, active: 1 });
  }
  return sqliteDb.prepare('SELECT * FROM staff WHERE code = ? AND active = 1').get(cleanCode);
}

export async function findStaffById(id) {
  const numId = Number(id);
  if (usingMongo) {
    return await mongoDb.collection('staff').findOne({ id: numId });
  }
  return sqliteDb.prepare('SELECT * FROM staff WHERE id = ?').get(numId);
}

export async function listStaff() {
  if (usingMongo) {
    return await mongoDb.collection('staff').find({}).sort({ code: 1 }).toArray();
  }
  return sqliteDb.prepare('SELECT * FROM staff ORDER BY code').all();
}

export async function createStaff({ code, name, pin_hash }) {
  const cleanCode = String(code).trim().toUpperCase();
  const cleanName = String(name).trim();
  const time = nowIso();

  if (usingMongo) {
    const nextId = await getNextSequence('staff');
    await mongoDb.collection('staff').insertOne({
      id: nextId,
      code: cleanCode,
      name: cleanName,
      pin_hash,
      active: 1,
      created_at: time
    });
    return { id: nextId, code: cleanCode, name: cleanName };
  }

  const res = sqliteDb.prepare(`
    INSERT INTO staff (code, name, pin_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(cleanCode, cleanName, pin_hash, time);
  return { id: res.lastInsertRowid, code: cleanCode, name: cleanName };
}

export async function updateStaffPin(id, pin_hash) {
  const numId = Number(id);
  if (usingMongo) {
    await mongoDb.collection('staff').updateOne({ id: numId }, { $set: { pin_hash } });
    return;
  }
  sqliteDb.prepare('UPDATE staff SET pin_hash = ? WHERE id = ?').run(pin_hash, numId);
}

export async function toggleStaffActive(id) {
  const numId = Number(id);
  if (usingMongo) {
    const staff = await mongoDb.collection('staff').findOne({ id: numId });
    if (!staff) return;
    const newActive = staff.active ? 0 : 1;
    await mongoDb.collection('staff').updateOne({ id: numId }, { $set: { active: newActive } });
    return newActive;
  }
  sqliteDb.prepare('UPDATE staff SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(numId);
}

export async function deleteStaff(id) {
  const numId = Number(id);
  if (usingMongo) {
    await mongoDb.collection('scans').deleteMany({ staff_id: numId });
    await mongoDb.collection('devices').deleteMany({ staff_id: numId });
    await mongoDb.collection('attendance').deleteMany({ staff_id: numId });
    await mongoDb.collection('staff').deleteOne({ id: numId });
    return;
  }
  sqliteDb.prepare('DELETE FROM scans WHERE staff_id = ?').run(numId);
  sqliteDb.prepare('DELETE FROM devices WHERE staff_id = ?').run(numId);
  sqliteDb.prepare('DELETE FROM attendance WHERE staff_id = ?').run(numId);
  sqliteDb.prepare('DELETE FROM staff WHERE id = ?').run(numId);
}

// ----------------------------------------------------
// DEVICES
// ----------------------------------------------------
export async function findDevice(staffId, deviceKey) {
  const numId = Number(staffId);
  const key = String(deviceKey || '');
  if (usingMongo) {
    return await mongoDb.collection('devices').findOne({ staff_id: numId, device_key: key });
  }
  return sqliteDb.prepare('SELECT * FROM devices WHERE staff_id = ? AND device_key = ?').get(numId, key);
}

export async function registerDevice(staffId, deviceKey, approved = 1) {
  const numId = Number(staffId);
  const key = String(deviceKey || '');
  const time = nowIso();

  if (usingMongo) {
    const nextId = await getNextSequence('devices');
    await mongoDb.collection('devices').updateOne(
      { staff_id: numId, device_key: key },
      { $setOnInsert: { id: nextId, staff_id: numId, device_key: key, approved: approved ? 1 : 0, created_at: time } },
      { upsert: true }
    );
    return;
  }
  sqliteDb.prepare('INSERT OR IGNORE INTO devices (staff_id, device_key, approved, created_at) VALUES (?, ?, ?, ?)').run(numId, key, approved ? 1 : 0, time);
}

export async function approveDevice(id) {
  const numId = Number(id);
  if (usingMongo) {
    await mongoDb.collection('devices').updateOne({ id: numId }, { $set: { approved: 1 } });
    return;
  }
  sqliteDb.prepare('UPDATE devices SET approved = 1 WHERE id = ?').run(numId);
}

export async function revokeDevice(id) {
  const numId = Number(id);
  if (usingMongo) {
    await mongoDb.collection('devices').deleteOne({ id: numId });
    return;
  }
  sqliteDb.prepare('DELETE FROM devices WHERE id = ?').run(numId);
}

export async function listDevices() {
  if (usingMongo) {
    const devices = await mongoDb.collection('devices').find({}).sort({ approved: 1, created_at: -1 }).toArray();
    const staff = await mongoDb.collection('staff').find({}).toArray();
    const staffMap = new Map(staff.map(s => [s.id, s]));
    return devices.map(d => {
      const s = staffMap.get(d.staff_id) || {};
      return {
        ...d,
        name: s.name || '',
        code: s.code || ''
      };
    });
  }
  return sqliteDb.prepare(`
    SELECT d.id, d.device_key, d.approved, d.created_at,
    s.name, s.code
    FROM devices d
    JOIN staff s ON s.id = d.staff_id
    ORDER BY d.approved, d.created_at DESC
  `).all();
}

export async function getAttendanceBoard(targetDate) {
  const d = String(targetDate || today()).slice(0, 10);
  if (usingMongo) {
    const staff = await mongoDb.collection('staff').find({ active: 1 }).sort({ name: 1 }).toArray();
    const attendance = await mongoDb.collection('attendance').find({ work_date: d }).toArray();
    const attMap = new Map(attendance.map(a => [a.staff_id, a]));

    return staff.map(s => {
      const a = attMap.get(s.id) || {};
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        work_date: d,
        status: a.clock_in ? (a.status || 'out') : 'absent',
        clock_in: a.clock_in || null,
        break_started: a.break_started || null,
        clock_out: a.clock_out || null,
        total_break_minutes: a.total_break_minutes || 0,
        net_work_minutes: a.net_work_minutes || null
      };
    });
  }

  const rows = sqliteDb.prepare(`
    SELECT s.id, s.code, s.name, a.status, a.clock_in,
    a.break_started, a.clock_out, a.total_break_minutes,
    a.net_work_minutes
    FROM staff s
    LEFT JOIN attendance a
    ON a.staff_id = s.id AND a.work_date = ?
    WHERE s.active = 1
    ORDER BY s.name
  `).all(d);

  return rows.map(row => ({
    ...row,
    work_date: d,
    status: row.clock_in ? (row.status || 'out') : 'absent'
  }));
}

// ----------------------------------------------------
// ATTENDANCE
// ----------------------------------------------------
export async function getTodayAttendance(staffId, workDate) {
  const numId = Number(staffId);
  const d = workDate || today();

  if (usingMongo) {
    return await mongoDb.collection('attendance').findOne({ staff_id: numId, work_date: d });
  }
  return sqliteDb.prepare('SELECT * FROM attendance WHERE staff_id = ? AND work_date = ?').get(numId, d);
}

export async function createAttendance({ staff_id, work_date, status = 'out' }) {
  const numId = Number(staff_id);
  const d = work_date || today();

  if (usingMongo) {
    const nextId = await getNextSequence('attendance');
    const doc = {
      id: nextId,
      staff_id: numId,
      work_date: d,
      clock_in: null,
      clock_out: null,
      status,
      break_started: null,
      total_break_minutes: 0,
      net_work_minutes: null
    };
    await mongoDb.collection('attendance').insertOne(doc);
    return doc;
  }

  sqliteDb.prepare(`
    INSERT INTO attendance (staff_id, work_date, status)
    VALUES (?, ?, ?)
  `).run(numId, d, status);

  return sqliteDb.prepare('SELECT * FROM attendance WHERE staff_id = ? AND work_date = ?').get(numId, d);
}

export async function updateAttendance(id, fields) {
  const numId = Number(id);

  if (usingMongo) {
    await mongoDb.collection('attendance').updateOne({ id: numId }, { $set: fields });
    return await mongoDb.collection('attendance').findOne({ id: numId });
  }

  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(fields), numId];
  sqliteDb.prepare(`UPDATE attendance SET ${setClauses} WHERE id = ?`).run(...values);
  return sqliteDb.prepare('SELECT * FROM attendance WHERE id = ?').get(numId);
}

export async function listAttendanceExport() {
  if (usingMongo) {
    const attendance = await mongoDb.collection('attendance').find({}).sort({ work_date: -1 }).toArray();
    const staff = await mongoDb.collection('staff').find({}).toArray();
    const staffMap = new Map(staff.map(s => [s.id, s]));

    return attendance.map(a => {
      const s = staffMap.get(a.staff_id) || {};
      return {
        ...a,
        code: s.code || '',
        name: s.name || ''
      };
    });
  }

  return sqliteDb.prepare(`
    SELECT a.*, s.code, s.name
    FROM attendance a
    JOIN staff s ON s.id = a.staff_id
    ORDER BY a.work_date DESC, s.name
  `).all();
}

// ----------------------------------------------------
// SCANS / AUDIT LOGS
// ----------------------------------------------------
export async function logScan(staffId, coords, deviceKey, result, detail) {
  const time = nowIso();
  const lat = coords?.latitude ?? null;
  const lng = coords?.longitude ?? null;
  const numStaffId = staffId ? Number(staffId) : null;
  const key = deviceKey || null;
  const det = detail || '';

  if (usingMongo) {
    const nextId = await getNextSequence('scans');
    await mongoDb.collection('scans').insertOne({
      id: nextId,
      staff_id: numStaffId,
      attempted_at: time,
      latitude: lat,
      longitude: lng,
      device_key: key,
      result,
      detail: det
    });
    return;
  }

  sqliteDb.prepare(`
    INSERT INTO scans (staff_id, attempted_at, latitude, longitude, device_key, result, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(numStaffId, time, lat, lng, key, result, det);
}

export async function listScans(limit = 250) {
  if (usingMongo) {
    const scans = await mongoDb.collection('scans').find({}).sort({ attempted_at: -1 }).limit(limit).toArray();
    const staff = await mongoDb.collection('staff').find({}).toArray();
    const staffMap = new Map(staff.map(s => [s.id, s]));

    return scans.map(sc => {
      const s = staffMap.get(sc.staff_id) || {};
      return {
        ...sc,
        name: s.name || null,
        code: s.code || null
      };
    });
  }

  return sqliteDb.prepare(`
    SELECT sc.*, s.name, s.code
    FROM scans sc
    LEFT JOIN staff s ON s.id = sc.staff_id
    ORDER BY sc.id DESC
    LIMIT ?
  `).all(limit);
}

export async function clearScans() {
  if (usingMongo) {
    await mongoDb.collection('scans').deleteMany({});
    return;
  }
  sqliteDb.prepare('DELETE FROM scans').run();
}

export async function listScansExport() {
  if (usingMongo) {
    const scans = await mongoDb.collection('scans').find({}).sort({ attempted_at: -1 }).toArray();
    const staff = await mongoDb.collection('staff').find({}).toArray();
    const staffMap = new Map(staff.map(s => [s.id, s]));

    return scans.map(sc => {
      const s = staffMap.get(sc.staff_id) || {};
      return {
        ...sc,
        code: s.code || '',
        name: s.name || ''
      };
    });
  }

  return sqliteDb.prepare(`
    SELECT sc.id, sc.attempted_at, s.code, s.name, sc.result,
    sc.latitude, sc.longitude, sc.device_key, sc.detail
    FROM scans sc
    LEFT JOIN staff s ON s.id = sc.staff_id
    ORDER BY sc.id DESC
  `).all();
}

// ----------------------------------------------------
// QR CHALLENGES
// ----------------------------------------------------
export async function saveChallenge({ id, expires_at, passcode }) {
  const cleanId = String(id).toLowerCase();
  const cleanPasscode = (passcode || cleanId.slice(0, 6)).toUpperCase();
  if (usingMongo) {
    await mongoDb.collection('qr_challenges').insertOne({
      id: cleanId,
      passcode: cleanPasscode,
      expires_at,
      used: 0
    });
    return;
  }
  sqliteDb.prepare(`
    INSERT INTO qr_challenges (id, expires_at, used)
    VALUES (?, ?, 0)
  `).run(cleanId, expires_at);
}

export async function findChallenge(idOrPasscode) {
  const now = Math.floor(Date.now() / 1000);
  const raw = String(idOrPasscode || '').trim();

  if (usingMongo) {
    if (raw.length === 6) {
      return await mongoDb.collection('qr_challenges').findOne({
        passcode: raw.toUpperCase(),
        used: 0,
        expires_at: { $gte: now }
      });
    }
    return await mongoDb.collection('qr_challenges').findOne({
      id: raw.toLowerCase(),
      used: 0,
      expires_at: { $gte: now }
    });
  }

  if (raw.length === 6) {
    return sqliteDb.prepare('SELECT id FROM qr_challenges WHERE id LIKE ? AND used = 0 AND expires_at >= ?').get(raw.toUpperCase() + '%', now);
  }
  return sqliteDb.prepare('SELECT * FROM qr_challenges WHERE id = ?').get(raw.toLowerCase());
}

export async function markChallengeUsed(id) {
  const cleanId = String(id).toLowerCase();
  if (usingMongo) {
    const res = await mongoDb.collection('qr_challenges').updateOne(
      { id: cleanId, used: 0 },
      { $set: { used: 1 } }
    );
    return res.modifiedCount === 1;
  }

  const res = sqliteDb.prepare(`
    UPDATE qr_challenges SET used = 1
    WHERE id = ? AND used = 0
  `).run(cleanId);
  return res.changes === 1;
}

export async function cleanupExpiredChallenges() {
  const threshold = Math.floor(Date.now() / 1000) - 60;
  if (usingMongo) {
    await mongoDb.collection('qr_challenges').deleteMany({
      $or: [{ expires_at: { $lt: threshold } }, { used: 1 }]
    });
    return;
  }
  sqliteDb.prepare('DELETE FROM qr_challenges WHERE expires_at < ? OR used = 1').run(threshold);
}
