import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Store,
  ShieldCheck,
  Users,
  ScanLine,
  Clock,
  LogOut,
  Download,
  RefreshCw,
  Plus,
  Check,
  AlertTriangle,
  MapPin,
  Smartphone,
  Lock,
  Eye,
  EyeOff,
  Search,
  Coffee,
  CheckCircle2,
  XCircle,
  QrCode,
  User,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Copy,
  KeyRound,
  ExternalLink,
  Info
} from 'lucide-react';
import './style.css';

const api = async (path, opts = {}) => {
  const r = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  let d = {};
  try {
    d = await r.json();
  } catch {}
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};

const getDeviceKey = () => {
  let k = localStorage.getItem('rr_device_key');
  if (!k) {
    k = crypto.randomUUID().replaceAll('-', '');
    localStorage.setItem('rr_device_key', k);
  }
  return k;
};

function distanceMeters(aLat, aLng, bLat, bLng) {
  const rad = n => (n * Math.PI) / 180;
  const R = 6371000;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function App() {
  const [role, setRole] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Single Unified Login States (Only ID + PIN)
  const [loginId, setLoginId] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [showPin, setShowPin] = useState(false);

  // Owner Data States
  const [staff, setStaff] = useState([]);
  const [board, setBoard] = useState([]);
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [qr, setQr] = useState(null);
  const [tab, setTab] = useState('board');
  const [searchQuery, setSearchQuery] = useState('');

  // Add Staff form states
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffCode, setNewStaffCode] = useState('');
  const [newStaffPin, setNewStaffPin] = useState('');
  const [createdStaffCreds, setCreatedStaffCreds] = useState(null);

  // Owner Unique PIN Management
  const [ownerNewPin, setOwnerNewPin] = useState('');
  const [pinChangeMsg, setPinChangeMsg] = useState('');

  // Staff Portal States
  const [me, setMe] = useState(null);
  const [action, setAction] = useState('in'); // 'in' | 'lunch' | 'out'
  const [scanOpen, setScanOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [geoStatus, setGeoStatus] = useState({ state: 'checking', text: 'Checking Shop Geofence...' });
  const scanner = useRef(null);

  const portalUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';

  const flash = (msg, err = '') => {
    setMessage(msg);
    setError(err);
    if (msg || err) {
      setTimeout(() => {
        setMessage('');
        setError('');
      }, 5000);
    }
  };

  // Live Clock Ticker
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch initial system status
  useEffect(() => {
    api('/status')
      .then(res => {
        setStatus(res);
        if (res.role) setRole(res.role);
      })
      .catch(e => flash('', e.message));
  }, []);

  // Fetch Owner Data
  const refreshOwner = async () => {
    try {
      const [s, b, d, l] = await Promise.all([
        api('/owner/staff'),
        api('/owner/board'),
        api('/owner/devices'),
        api('/owner/logs')
      ]);
      setStaff(s);
      setBoard(b);
      setDevices(d);
      setLogs(l);
    } catch (e) {
      flash('', e.message);
    }
  };

  useEffect(() => {
    if (role === 'owner') {
      refreshOwner();
      const t = setInterval(refreshOwner, 12000);
      return () => clearInterval(t);
    }
  }, [role]);

  // Shop QR Polling for Owner Kiosk
  useEffect(() => {
    if (role === 'owner' && tab === 'qr') {
      const loadQr = () => api('/owner/qr').then(setQr).catch(e => flash('', e.message));
      loadQr();
      const t = setInterval(loadQr, 25000);
      return () => clearInterval(t);
    }
  }, [role, tab]);

  // Fetch Staff Status & Check Geofence
  const refreshStaff = () => {
    if (role === 'staff') {
      api('/staff/me')
        .then(setMe)
        .catch(e => {
          setRole(null);
          flash('', e.message);
        });
    }
  };

  useEffect(() => {
    if (role === 'staff') {
      refreshStaff();
      checkGeofence();
    }
  }, [role, status]);

  const checkGeofence = () => {
    if (!navigator.geolocation) {
      setGeoStatus({ state: 'outside', text: 'GPS Not Supported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (status?.shopLat != null && status?.shopLng != null) {
          const meters = Math.round(
            distanceMeters(status.shopLat, status.shopLng, pos.coords.latitude, pos.coords.longitude)
          );
          const limit = status.geofenceMeters || 50;
          if (meters <= limit) {
            setGeoStatus({ state: 'inside', text: `Within Shop Zone (${meters}m / ${limit}m)` });
          } else {
            setGeoStatus({ state: 'outside', text: `Outside Shop Range (${meters}m away)` });
          }
        } else {
          setGeoStatus({ state: 'inside', text: `Within Shop Zone (${status?.geofenceMeters || 50}m)` });
        }
      },
      () => {
        setGeoStatus({ state: 'outside', text: 'Location Access Needed' });
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  // ----------------------------------------------------
  // SINGLE UNIFIED LOGIN HANDLER (Only ID + PIN)
  // ----------------------------------------------------
  const handleUnifiedLogin = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          id: loginId.trim(),
          pin: loginPin.trim(),
          deviceKey: getDeviceKey()
        })
      });

      if (d.role === 'owner') {
        setRole('owner');
        setLoginId('');
        setLoginPin('');
        flash('Welcome, Shop Owner');
      } else if (d.role === 'staff') {
        setRole('staff');
        setMe({ staff: d.staff, attendance: null });
        setLoginId('');
        setLoginPin('');
        flash(`Welcome back, ${d.staff.name}`);
      }
    } catch (e) {
      flash('', e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {}
    setRole(null);
    setMe(null);
    setQr(null);
    setTab('board');
  };

  // Owner Management Handlers
  const handleAddStaff = async e => {
    e.preventDefault();
    const staffName = newStaffName.trim();
    const staffCode = newStaffCode.trim().toUpperCase();
    const staffPin = newStaffPin.trim();

    try {
      await api('/owner/staff', {
        method: 'POST',
        body: JSON.stringify({
          name: staffName,
          code: staffCode,
          pin: staffPin
        })
      });

      // Save credentials for owner to share with staff
      setCreatedStaffCreds({
        name: staffName,
        code: staffCode,
        pin: staffPin,
        portalUrl
      });

      setNewStaffName('');
      setNewStaffCode('');
      setNewStaffPin('');
      flash('Staff member successfully created!');
      refreshOwner();
    } catch (e) {
      flash('', e.message);
    }
  };

  const handleUpdateOwnerPin = async e => {
    e.preventDefault();
    try {
      await api('/owner/pin', {
        method: 'POST',
        body: JSON.stringify({ newPin: ownerNewPin })
      });
      setPinChangeMsg('Owner unique PIN updated successfully.');
      setOwnerNewPin('');
      setTimeout(() => setPinChangeMsg(''), 5000);
      flash('Owner unique PIN updated');
    } catch (e) {
      flash('', e.message);
    }
  };

  const copyToClipboard = (text, note = 'Copied to clipboard!') => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      flash(note);
    }
  };

  const handleDeviceAction = async (id, act) => {
    try {
      await api(`/owner/devices/${id}/${act}`, { method: 'POST' });
      flash(act === 'approve' ? 'Device approved successfully' : 'Device access revoked');
      refreshOwner();
    } catch (e) {
      flash('', e.message);
    }
  };

  const handleToggleStaff = async id => {
    try {
      await api(`/owner/staff/${id}/toggle`, { method: 'POST' });
      refreshOwner();
    } catch (e) {
      flash('', e.message);
    }
  };

  // Scanner Logic
  const startScanner = async forcedAction => {
    const targetAction = forcedAction || action;
    setAction(targetAction);
    setScanOpen(true);
    setTimeout(async () => {
      try {
        const q = new Html5Qrcode('qr-reader');
        scanner.current = q;
        await q.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          async decoded => {
            await q.stop();
            scanner.current = null;
            setScanOpen(false);
            await submitAttendance(decoded, targetAction);
          },
          () => {}
        );
      } catch (e) {
        setScanOpen(false);
        flash('', `Camera permission error: ${e.message || e}`);
      }
    }, 120);
  };

  const stopScanner = async () => {
    try {
      if (scanner.current) {
        await scanner.current.stop();
        scanner.current = null;
      }
    } catch {}
    setScanOpen(false);
  };

  const submitAttendance = async (token, actionType) => {
    setBusy(true);
    try {
      if (!navigator.geolocation) throw new Error('GPS is not available on this phone');
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        })
      );
      const d = await api('/attendance/scan', {
        method: 'POST',
        body: JSON.stringify({
          token,
          action: actionType || action,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        })
      });
      setMe({ staff: d.staff, attendance: d.attendance });
      checkGeofence();
      flash('Attendance verified & saved successfully');
    } catch (e) {
      flash(
        '',
        e.message === 'User denied Geolocation'
          ? 'Location access denied. Please allow GPS to mark attendance.'
          : e.message
      );
    } finally {
      setBusy(false);
    }
  };

  // Formatting helpers
  const fmtTime = t =>
    t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

  const fmtDuration = (mins = 0) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m < 10 ? '0' : ''}${m}m`;
  };

  // Filtered Board Data
  const filteredBoard = useMemo(() => {
    if (!searchQuery) return board;
    const q = searchQuery.toLowerCase();
    return board.filter(
      item => item.name?.toLowerCase().includes(q) || item.code?.toLowerCase().includes(q)
    );
  }, [board, searchQuery]);

  // ----------------------------------------------------
  // 1. UNIFIED LOGIN SCREEN (ONLY ID AND PIN)
  // ----------------------------------------------------
  if (!role) {
    return (
      <main className="login-container">
        <div className="login-brand">
          <div className="brand-badge">
            <Store size={28} />
          </div>
          <h1>Rajarajeswari</h1>
          <p>Staff Attendance & Workforce Portal</p>
        </div>

        <section className="login-card">
          <div className="login-card-header">
            <h2>Sign In</h2>
            <p>Enter your assigned ID and PIN to access the portal</p>
          </div>

          <form onSubmit={handleUnifiedLogin}>
            {/* ID Input */}
            <div className="form-group">
              <label className="form-label">
                <span>Account ID</span>
                <span className="section-label" style={{ fontSize: '0.68rem' }}>Staff ID or OWNER</span>
              </label>
              <div className="input-wrapper">
                <span className="input-icon-left">
                  <User size={18} />
                </span>
                <input
                  value={loginId}
                  onChange={e => setLoginId(e.target.value.toUpperCase())}
                  placeholder="e.g. RR001 or OWNER"
                  className="form-input font-mono"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
                  required
                  autoFocus
                />
              </div>
            </div>

            {/* PIN Input */}
            <div className="form-group">
              <label className="form-label">
                <span>Security PIN</span>
                <span className="section-label" style={{ fontSize: '0.68rem' }}>Numeric</span>
              </label>
              <div className="input-wrapper">
                <span className="input-icon-left">
                  <Lock size={18} />
                </span>
                <input
                  value={loginPin}
                  onChange={e => setLoginPin(e.target.value)}
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="Enter your PIN"
                  className="form-input font-mono"
                  required
                />
                <button
                  type="button"
                  className="toggle-password-btn"
                  onClick={() => setShowPin(!showPin)}
                  title={showPin ? 'Hide PIN' : 'Show PIN'}
                >
                  {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Role Notice */}
            <div className="login-role-hint">
              <Info size={16} style={{ flexShrink: 0, marginTop: '2px', color: '#059669' }} />
              <div>
                <strong>Staff:</strong> Enter your Staff ID (e.g. <code>RR001</code>) and PIN.<br />
                <strong>Owner:</strong> Enter ID <code>OWNER</code> with your unique Owner PIN.
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={busy}>
              <ChevronRight size={18} /> {busy ? 'Verifying Credentials…' : 'Sign In'}
            </button>
          </form>

          <div className="login-footer">
            <ShieldCheck size={14} /> Retail SaaS Grade Security · Rajarajeswari
          </div>
        </section>

        <ToastNotice message={message} error={error} />
      </main>
    );
  }

  // ----------------------------------------------------
  // 2. MAIN APP SHELL
  // ----------------------------------------------------
  const currentStatus = me?.attendance?.status || 'out';

  return (
    <div className="app-container">
      {/* Top Bar */}
      <header className="app-topbar">
        <div className="topbar-brand">
          <div className="topbar-logo">
            <Store size={22} />
          </div>
          <div>
            <h1 className="topbar-title">Rajarajeswari</h1>
            <p className="topbar-subtitle">Staff Attendance</p>
          </div>
        </div>

        <div className="topbar-user">
          {role === 'staff' ? (
            <div className="user-badge">
              <span className="user-name">{me?.staff?.name || 'Staff'}</span>
              <span className="staff-code-pill font-mono">{me?.staff?.code || 'RR001'}</span>
            </div>
          ) : (
            <div className="user-badge">
              <span className="user-name">Shop Owner</span>
              <span className="staff-code-pill font-mono">OWNER</span>
            </div>
          )}
          <button className="btn-icon-logout" onClick={handleLogout} title="Log Out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* ----------------------------------------------------
          A. STAFF ATTENDANCE SCREEN
          ---------------------------------------------------- */}
      {role === 'staff' ? (
        <div className="staff-layout">
          {/* Hero Status Card */}
          <section className="hero-status-card">
            <p className="section-label">Live System Clock</p>
            <div className="digital-clock font-mono">
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
            </div>
            <p className="clock-subtext">
              {currentTime.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}
            </p>

            {/* Geofence Status Pill */}
            <div className={`geofence-pill ${geoStatus.state}`}>
              <span className="pulse-dot" />
              <span>{geoStatus.text}</span>
            </div>

            <div className="current-shift-badge">
              <StatusBadge status={currentStatus} />
            </div>
          </section>

          {/* Primary Action Grid (Large Thumb-Friendly Buttons) */}
          <section className="action-card">
            <div className="action-card-header">
              <h3>Attendance Actions</h3>
              <p>Select action and scan the live QR code at the shop desk</p>
            </div>

            <div className="attendance-action-grid">
              {currentStatus === 'out' ? (
                <button
                  className="btn-action-primary"
                  onClick={() => startScanner('in')}
                  disabled={busy}
                >
                  <Store size={22} />
                  <span>Check In for Shift</span>
                </button>
              ) : currentStatus === 'in' ? (
                <div className="split-action-row">
                  <button
                    className="btn-lunch"
                    onClick={() => startScanner('lunch')}
                    disabled={busy}
                  >
                    <Coffee size={18} />
                    <span>Start Lunch</span>
                  </button>
                  <button
                    className="btn-checkout"
                    onClick={() => startScanner('out')}
                    disabled={busy}
                  >
                    <LogOut size={18} />
                    <span>Check Out</span>
                  </button>
                </div>
              ) : (
                <div className="split-action-row">
                  <button
                    className="btn-lunch"
                    style={{ background: '#ECFDF5', borderColor: '#A7F3D0', color: '#047857' }}
                    onClick={() => startScanner('lunch')}
                    disabled={busy}
                  >
                    <CheckCircle2 size={18} />
                    <span>End Lunch (Return)</span>
                  </button>
                  <button
                    className="btn-checkout"
                    onClick={() => startScanner('out')}
                    disabled={busy}
                  >
                    <LogOut size={18} />
                    <span>Check Out</span>
                  </button>
                </div>
              )}

              {/* QR / Barcode Scan Trigger */}
              <button
                type="button"
                className="btn-secondary"
                style={{ justifyContent: 'center', height: '48px', fontSize: '0.92rem' }}
                onClick={() => startScanner(action)}
                disabled={busy}
              >
                <ScanLine size={19} />
                <span>Open QR & Barcode Camera</span>
              </button>
            </div>

            {/* QR Scanner Container */}
            {scanOpen && (
              <div style={{ marginTop: '16px' }}>
                <div id="qr-reader" className="scanner-view-box" />
                <button type="button" className="scanner-cancel-btn" onClick={stopScanner}>
                  Cancel Camera
                </button>
              </div>
            )}
          </section>

          {/* Today's Timeline Card */}
          <section className="timeline-card">
            <div className="timeline-header">
              <span className="section-label">Today's Shift Log</span>
              <span className="timeline-hours-pill font-mono">
                {fmtDuration(me?.attendance?.net_work_minutes || 0)} Worked
              </span>
            </div>

            <div className="timeline-list">
              <div className={`timeline-item ${me?.attendance?.clock_in ? 'active' : ''}`}>
                <span className="timeline-dot" />
                <span className="timeline-label">Entry (Clock In)</span>
                <span className="timeline-time font-mono">{fmtTime(me?.attendance?.clock_in)}</span>
              </div>

              <div className={`timeline-item ${me?.attendance?.break_started ? 'active' : ''}`}>
                <span className="timeline-dot" />
                <span className="timeline-label">Lunch Started</span>
                <span className="timeline-time font-mono">{fmtTime(me?.attendance?.break_started)}</span>
              </div>

              <div className={`timeline-item ${(me?.attendance?.total_break_minutes || 0) > 0 ? 'active' : ''}`}>
                <span className="timeline-dot" />
                <span className="timeline-label">Lunch Duration</span>
                <span className="timeline-time font-mono">
                  {(me?.attendance?.total_break_minutes || 0) > 0
                    ? `${me?.attendance?.total_break_minutes} mins`
                    : '—'}
                </span>
              </div>

              <div className={`timeline-item ${me?.attendance?.clock_out ? 'active' : ''}`}>
                <span className="timeline-dot" />
                <span className="timeline-label">Exit (Clock Out)</span>
                <span className="timeline-time font-mono">{fmtTime(me?.attendance?.clock_out)}</span>
              </div>
            </div>
          </section>
        </div>
      ) : (
        /* ----------------------------------------------------
            B. OWNER DASHBOARD LAYOUT
            ---------------------------------------------------- */
        <div>
          <div className="owner-header-row">
            <div className="owner-title-block">
              <p className="section-label">Retail Operations</p>
              <h2>Attendance & Staff Console</h2>
              <p>Real-time shop presence, geofence audit, and biometric QR challenge</p>
            </div>
            <button className="btn-secondary" onClick={refreshOwner}>
              <RefreshCw size={15} /> Refresh Data
            </button>
          </div>

          {/* Top Summary Strip: 3-Column KPI Grid */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-icon staff">
                <Users size={24} />
              </div>
              <div>
                <span className="kpi-label">Total Staff</span>
                <div className="kpi-value font-mono">{staff.length}</div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon present">
                <Store size={24} />
              </div>
              <div>
                <span className="kpi-label">Present Now</span>
                <div className="kpi-value font-mono">
                  {board.filter(b => b.status === 'in').length}
                </div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon break">
                <Coffee size={24} />
              </div>
              <div>
                <span className="kpi-label">On Break / Absent</span>
                <div className="kpi-value font-mono">
                  {board.filter(b => b.status === 'lunch' || b.status === 'out').length}
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="dashboard-tabs">
            {[
              ['board', 'Live Board', Users],
              ['qr', 'Shop QR', QrCode],
              ['staff', 'Staff Management & Login Info', User],
              ['devices', 'Registered Phones', Smartphone],
              ['logs', 'Security Audit Logs', ShieldCheck]
            ].map(([k, label, IconComponent]) => (
              <button
                key={k}
                className={`dashboard-tab-btn ${tab === k ? 'active' : ''}`}
                onClick={() => setTab(k)}
              >
                <IconComponent size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {/* Action Bar for Live Board */}
          {tab === 'board' && (
            <div className="action-bar">
              <div className="search-input-wrapper">
                <Search size={16} className="search-icon" />
                <input
                  type="text"
                  placeholder="Filter by name or ID (e.g. RR001)…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>

              <div className="action-buttons-group">
                <button className="btn-accent" onClick={() => setTab('staff')}>
                  <Plus size={16} /> Add Staff
                </button>
                <button className="btn-secondary" onClick={() => setTab('qr')}>
                  <QrCode size={16} /> Generate QR
                </button>
                <a className="btn-secondary" href="/api/owner/export.csv" download>
                  <Download size={16} /> Export CSV
                </a>
              </div>
            </div>
          )}

          {/* TAB 1: LIVE BOARD */}
          {tab === 'board' && (
            <section className="content-card">
              <div className="card-header">
                <h3 className="card-title">Today's Attendance Status</h3>
                <span className="geofence-pill inside">
                  <span className="pulse-dot" />
                  <span>LIVE REFRESHING</span>
                </span>
              </div>

              {/* Desktop Table View */}
              <div className="table-responsive desktop-table-view">
                <table className="saas-table">
                  <thead>
                    <tr>
                      <th>Staff Member</th>
                      <th>Staff ID</th>
                      <th>Current Status</th>
                      <th>Entry Time</th>
                      <th>Lunch Duration</th>
                      <th>Exit Time</th>
                      <th>Total Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBoard.map(row => (
                      <tr key={row.id}>
                        <td>
                          <div className="staff-table-cell">
                            <div className="staff-avatar-mini">
                              {(row.name || 'S').slice(0, 1).toUpperCase()}
                            </div>
                            <span className="staff-name-text">{row.name}</span>
                          </div>
                        </td>
                        <td>
                          <span className="staff-code-pill font-mono">{row.code}</span>
                        </td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="font-mono">{fmtTime(row.clock_in)}</td>
                        <td className="font-mono">{row.total_break_minutes || 0} mins</td>
                        <td className="font-mono">{fmtTime(row.clock_out)}</td>
                        <td className="font-mono" style={{ fontWeight: 600 }}>
                          {fmtDuration(row.net_work_minutes || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredBoard.length && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
                    No staff records found matching criteria.
                  </div>
                )}
              </div>

              {/* Mobile Scannable Cards View */}
              <div className="mobile-card-list">
                {filteredBoard.map(row => (
                  <div className="mobile-attendance-card" key={row.id}>
                    <div className="mobile-card-top">
                      <div className="staff-table-cell">
                        <div className="staff-avatar-mini">
                          {(row.name || 'S').slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <span className="staff-name-text">{row.name}</span>
                          <span className="staff-code-pill font-mono" style={{ marginLeft: '6px' }}>
                            {row.code}
                          </span>
                        </div>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>

                    <div className="mobile-card-grid">
                      <div className="mobile-grid-item">
                        <span>Entry</span>
                        <strong className="font-mono">{fmtTime(row.clock_in)}</strong>
                      </div>
                      <div className="mobile-grid-item">
                        <span>Lunch</span>
                        <strong className="font-mono">{row.total_break_minutes || 0}m</strong>
                      </div>
                      <div className="mobile-grid-item">
                        <span>Exit</span>
                        <strong className="font-mono">{fmtTime(row.clock_out)}</strong>
                      </div>
                      <div className="mobile-grid-item">
                        <span>Net Time</span>
                        <strong className="font-mono">{fmtDuration(row.net_work_minutes || 0)}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TAB 2: SHOP QR */}
          {tab === 'qr' && (
            <section className="content-card qr-container-card">
              <div className="card-header" style={{ justifyContent: 'center' }}>
                <h3 className="card-title">Live Shop Screen QR</h3>
              </div>
              <p style={{ color: '#64748B', fontSize: '0.9rem', marginTop: '12px' }}>
                Mount this display at the shop checkout or entry desk. Staff scan this QR from their registered smartphones.
              </p>

              {qr ? (
                <>
                  <div className="qr-code-frame">
                    <img src={qr.dataUrl} alt="Live rotating QR attendance code" />
                  </div>
                  <div className="qr-countdown font-mono">
                    <Clock size={16} />
                    <span>Expires at {new Date(qr.expiresAt * 1000).toLocaleTimeString()}</span>
                  </div>
                </>
              ) : (
                <div style={{ padding: '60px 20px', color: '#94A3B8' }}>
                  Generating cryptographically signed QR…
                </div>
              )}

              <p className="login-footer" style={{ marginTop: '20px' }}>
                <ShieldCheck size={16} /> HMAC-SHA256 Token Signature · 30-Second Rotation · Single-Use Anti-Replay
              </p>
            </section>
          )}

          {/* TAB 3: STAFF MANAGEMENT & WHERE THEY CAN LOGIN */}
          {tab === 'staff' && (
            <div>
              {/* WHERE STAFF CAN LOGIN IT - Top Informational Banner */}
              <div className="portal-link-banner">
                <div className="portal-link-header">
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#064E3B' }}>
                      Where Staff Can Log In
                    </h4>
                    <p style={{ fontSize: '0.85rem', color: '#475569', marginTop: '2px' }}>
                      Tell staff to open this web address on their smartphones to sign in:
                    </p>
                  </div>

                  <button
                    className="btn-accent"
                    style={{ padding: '8px 14px', fontSize: '0.82rem' }}
                    onClick={() =>
                      copyToClipboard(
                        `Rajarajeswari Staff Attendance Portal:\nOpen this link: ${portalUrl}\nEnter your assigned Staff ID and PIN to clock in.`,
                        'Portal link & instructions copied!'
                      )
                    }
                  >
                    <Copy size={15} /> Copy Staff Login Instructions
                  </button>
                </div>

                <div className="portal-url-badge">
                  <Smartphone size={16} />
                  <span>{portalUrl}</span>
                </div>
              </div>

              {/* Just Created Staff Credentials Alert */}
              {createdStaffCreds && (
                <div className="created-credentials-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle2 size={20} color="#059669" />
                      <strong style={{ color: '#064E3B', fontSize: '0.95rem' }}>
                        Staff Member Created Successfully!
                      </strong>
                    </div>
                    <button
                      className="btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                      onClick={() => setCreatedStaffCreds(null)}
                    >
                      Dismiss
                    </button>
                  </div>

                  <div className="credentials-grid">
                    <div className="credential-item">
                      <span>Staff Name</span>
                      <strong>{createdStaffCreds.name}</strong>
                    </div>
                    <div className="credential-item">
                      <span>Staff ID (Login)</span>
                      <strong className="font-mono">{createdStaffCreds.code}</strong>
                    </div>
                    <div className="credential-item">
                      <span>PIN</span>
                      <strong className="font-mono">{createdStaffCreds.pin}</strong>
                    </div>
                  </div>

                  <button
                    className="btn-accent"
                    style={{ width: '100%', marginTop: '4px', fontSize: '0.88rem' }}
                    onClick={() =>
                      copyToClipboard(
                        `Hello ${createdStaffCreds.name},\nHere are your Rajarajeswari Attendance login credentials:\n• Login Link: ${createdStaffCreds.portalUrl}\n• Staff ID: ${createdStaffCreds.code}\n• PIN: ${createdStaffCreds.pin}\nOpen the link on your phone to check in.`,
                        'Staff credentials message copied to clipboard!'
                      )
                    }
                  >
                    <Copy size={16} /> Copy Credentials Message (for WhatsApp / SMS)
                  </button>
                </div>
              )}

              <div className="split-directory-grid">
                {/* Add Staff Card */}
                <div className="content-card staff-form-card">
                  <h3 className="card-title" style={{ marginBottom: '16px' }}>
                    Create New Staff
                  </h3>
                  <form onSubmit={handleAddStaff}>
                    <div className="form-group">
                      <label className="form-label">Full Name of Staff</label>
                      <input
                        type="text"
                        value={newStaffName}
                        onChange={e => setNewStaffName(e.target.value)}
                        placeholder="e.g. Ramesh Kumar"
                        className="form-input no-left-icon"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        <span>Staff ID</span>
                        <span className="section-label" style={{ fontSize: '0.68rem' }}>Unique Code</span>
                      </label>
                      <input
                        type="text"
                        value={newStaffCode}
                        onChange={e => setNewStaffCode(e.target.value.toUpperCase())}
                        placeholder="e.g. RR001"
                        className="form-input no-left-icon font-mono"
                        style={{ textTransform: 'uppercase' }}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        <span>Staff PIN</span>
                        <span className="section-label" style={{ fontSize: '0.68rem' }}>4–8 Digits</span>
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        value={newStaffPin}
                        onChange={e => setNewStaffPin(e.target.value)}
                        placeholder="e.g. 1234"
                        className="form-input no-left-icon font-mono"
                        required
                      />
                    </div>

                    <button type="submit" className="btn-primary">
                      <Plus size={16} /> Create Staff Member
                    </button>
                  </form>

                  {/* Owner Unique PIN Configuration */}
                  <div style={{ marginTop: '32px', paddingTop: '20px', borderTop: '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <KeyRound size={17} color="#064E3B" />
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#064E3B' }}>
                        Owner Unique PIN
                      </h4>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '12px' }}>
                      Owner Login ID is <strong>OWNER</strong>. You can change your private Owner PIN below.
                    </p>

                    <form onSubmit={handleUpdateOwnerPin}>
                      <div className="form-group">
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={8}
                          value={ownerNewPin}
                          onChange={e => setOwnerNewPin(e.target.value)}
                          placeholder="Enter new 4–8 digit PIN"
                          className="form-input no-left-icon font-mono"
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        className="btn-secondary"
                        style={{ width: '100%', justifyContent: 'center' }}
                      >
                        Update Owner PIN
                      </button>
                    </form>
                    {pinChangeMsg && (
                      <p style={{ fontSize: '0.8rem', color: '#059669', marginTop: '8px', fontWeight: 600 }}>
                        {pinChangeMsg}
                      </p>
                    )}
                  </div>
                </div>

                {/* Staff Directory List */}
                <div className="content-card directory-list">
                  <div className="card-header" style={{ paddingLeft: '0', paddingRight: '0' }}>
                    <h3 className="card-title">Staff Members ({staff.length})</h3>
                  </div>
                  {staff.map(s => (
                    <div className="directory-row" key={s.id}>
                      <div className="staff-table-cell">
                        <div className="staff-avatar-mini">
                          {(s.name || 'S').slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <strong style={{ display: 'block', fontSize: '0.92rem' }}>{s.name}</strong>
                          <span className="staff-code-pill font-mono" style={{ fontSize: '0.72rem' }}>
                            {s.code}
                          </span>
                          <span
                            style={{
                              marginLeft: '8px',
                              fontSize: '0.75rem',
                              color: s.active ? '#059669' : '#94A3B8'
                            }}
                          >
                            {s.active ? '● Active' : '● Inactive'}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                          onClick={() =>
                            copyToClipboard(
                              `Staff Login: ID=${s.code} | URL=${portalUrl}`,
                              `Copied ${s.name}'s login details!`
                            )
                          }
                          title="Copy Staff Login Details"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleToggleStaff(s.id)}
                        >
                          {s.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {!staff.length && (
                    <div style={{ padding: '30px 0', textAlign: 'center', color: '#94A3B8' }}>
                      No staff members registered yet. Create one on the left.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: REGISTERED DEVICES */}
          {tab === 'devices' && (
            <section className="content-card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Registered Staff Smartphones</h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '2px' }}>
                    First-time logins require owner device approval before shifts can be logged.
                  </p>
                </div>
              </div>

              <div className="table-responsive">
                <table className="saas-table">
                  <thead>
                    <tr>
                      <th>Staff Member</th>
                      <th>Device Fingerprint</th>
                      <th>Status</th>
                      <th>Registered At</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map(d => (
                      <tr key={d.id}>
                        <td>
                          <strong>{d.name}</strong>
                          <span className="staff-code-pill font-mono" style={{ marginLeft: '6px' }}>
                            {d.code}
                          </span>
                        </td>
                        <td className="font-mono" style={{ fontSize: '0.78rem', color: '#64748B' }}>
                          {d.device_key.slice(0, 16)}…
                        </td>
                        <td>
                          <StatusBadge status={d.approved ? 'approved' : 'pending'} />
                        </td>
                        <td className="font-mono">{new Date(d.created_at).toLocaleDateString()}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {!d.approved && (
                              <button
                                className="btn-accent"
                                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                onClick={() => handleDeviceAction(d.id, 'approve')}
                              >
                                <Check size={14} /> Approve
                              </button>
                            )}
                            <button
                              className="btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                              onClick={() => handleDeviceAction(d.id, 'revoke')}
                            >
                              Revoke
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!devices.length && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
                    No smartphone devices registered yet.
                  </div>
                )}
              </div>
            </section>
          )}

          {/* TAB 5: SECURITY AUDIT LOGS */}
          {tab === 'logs' && (
            <section className="content-card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Security & Scan Audit Trail</h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '2px' }}>
                    Comprehensive tamper-proof log of all GPS coordinates and QR verifications
                  </p>
                </div>
                <a className="btn-secondary" href="/api/owner/export.csv" download>
                  <Download size={16} /> Export Audit Log
                </a>
              </div>

              <div className="table-responsive">
                <table className="saas-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Staff Member</th>
                      <th>Result</th>
                      <th>Coordinates (GPS)</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id}>
                        <td className="font-mono" style={{ fontSize: '0.8rem' }}>
                          {new Date(log.attempted_at).toLocaleString()}
                        </td>
                        <td>
                          <strong>{log.name || 'Unknown'}</strong>
                          {log.code && (
                            <span className="staff-code-pill font-mono" style={{ marginLeft: '6px' }}>
                              {log.code}
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={log.result} />
                        </td>
                        <td className="font-mono" style={{ fontSize: '0.8rem' }}>
                          {log.latitude && log.longitude
                            ? `${log.latitude.toFixed(4)}, ${log.longitude.toFixed(4)}`
                            : '—'}
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{log.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!logs.length && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
                    No scan events recorded yet.
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <footer className="app-footer-credit">
        Rajarajeswari Staff Attendance · Modern Enterprise Retail SaaS
      </footer>

      <ToastNotice message={message} error={error} />
    </div>
  );
}

// Subcomponents
function StatusBadge({ status }) {
  const s = String(status || 'out').toLowerCase();
  let label = s.replaceAll('_', ' ');

  if (s === 'in' || s === 'present') label = 'Present';
  else if (s === 'lunch' || s === 'break') label = 'On Lunch';
  else if (s === 'out' || s === 'absent') label = 'Checked Out';

  return (
    <span className={`status-badge ${s}`}>
      <span className="pulse-dot" style={{ width: 6, height: 6 }} />
      <span>{label}</span>
    </span>
  );
}

function ToastNotice({ message, error }) {
  if (!message && !error) return null;
  const isErr = Boolean(error);
  return (
    <div className={`saas-toast ${isErr ? 'bad' : 'good'}`}>
      {isErr ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
      <span>{error || message}</span>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
