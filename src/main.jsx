import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';
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
  Info,
  Calendar,
  Trash2,
  Camera,
  Upload,
  X,
  Filter,
  Compass
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
  if (!k || k.length < 16) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try {
        k = crypto.randomUUID().replace(/-/g, '');
      } catch {}
    }
    if (!k || k.length < 16) {
      k = 'dev_' + Math.random().toString(36).substring(2) + Date.now().toString(36) + Math.random().toString(36).substring(2);
    }
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
  const [role, setRole] = useState(null); // 'owner' (Admin) | 'staff'
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Single Unified Login States (Only ID + PIN)
  const [loginId, setLoginId] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loginScannerOpen, setLoginScannerOpen] = useState(false);
  const [pendingScanToken, setPendingScanToken] = useState(null);

  // Admin Data States
  const [staff, setStaff] = useState([]);
  const [board, setBoard] = useState([]);
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [qr, setQr] = useState(null);
  const [tab, setTab] = useState('board');
  const [searchQuery, setSearchQuery] = useState('');

  // Calendar Date State for Attendance History
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'present' | 'absent' | 'lunch'

  // Security Audit Logs Filter
  const [logFilter, setLogFilter] = useState('all'); // 'all' | 'success' | 'failed' | 'devices'
  const [logSearchQuery, setLogSearchQuery] = useState('');

  // Add Staff form states
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffCode, setNewStaffCode] = useState('');
  const [newStaffPin, setNewStaffPin] = useState('');
  const [createdStaffCreds, setCreatedStaffCreds] = useState(null);

  // Staff Login QR Code Modal
  const [activeStaffQrModal, setActiveStaffQrModal] = useState(null);

  // Admin Unique PIN Management
  const [adminNewPin, setAdminNewPin] = useState('');
  const [pinChangeMsg, setPinChangeMsg] = useState('');

  // Portal QR Code for phone registration
  const [portalQrData, setPortalQrData] = useState('');

  // Staff Portal States
  const [me, setMe] = useState(null);
  const [action, setAction] = useState('in'); // 'in' | 'lunch' | 'out'
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMethod, setScanMethod] = useState('camera'); // 'camera' | 'upload' | 'passcode'
  const [manualPasscode, setManualPasscode] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [geoStatus, setGeoStatus] = useState({ state: 'checking', text: 'Checking Shop Geofence...' });
  const scanner = useRef(null);
  const loginScanner = useRef(null);
  const fileInputRef = useRef(null);

  // Staff PIN Change States
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [staffCurrentPin, setStaffCurrentPin] = useState('');
  const [staffNewPin, setStaffNewPin] = useState('');
  const [staffConfirmPin, setStaffConfirmPin] = useState('');
  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);

  // Local Network IP for smartphones on same Wi-Fi
  const networkIp = status?.localIp || '192.168.1.15';
  const phonePortalUrl =
    typeof window !== 'undefined'
      ? window.location.hostname === 'localhost'
        ? (status?.baseUrl || `http://${networkIp}:${window.location.port || '5173'}`)
        : window.location.origin
      : (status?.baseUrl || 'http://localhost:5173');

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

  // Generate Phone Portal QR Code once host is known
  useEffect(() => {
    if (phonePortalUrl) {
      QRCode.toDataURL(phonePortalUrl, { width: 200, margin: 1 })
        .then(setPortalQrData)
        .catch(() => {});
    }
  }, [phonePortalUrl]);

  // ----------------------------------------------------
  // AUTO-LOGIN VIA QR CODE URL PARAMS (?auth=... or ?login=...) & SCAN LINK (?scan=...)
  // ----------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authToken = params.get('auth');
    const loginCode = params.get('login') || params.get('code');
    const pinParam = params.get('pin');
    const scanParam = params.get('scan');

    if (scanParam) {
      setPendingScanToken(scanParam);
      flash('Shop attendance QR detected! Sign in below to verify your check-in.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (authToken) {
      setBusy(true);
      api('/login', {
        method: 'POST',
        body: JSON.stringify({ authToken, deviceKey: getDeviceKey() })
      })
        .then(d => {
          if (d.role === 'staff') {
            setRole('staff');
            setMe({ staff: d.staff, attendance: null });
            flash(`Signed in as ${d.staff.name} via QR Code!`);
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        })
        .catch(err => flash('', `QR Login failed: ${err.message}`))
        .finally(() => setBusy(false));
    } else if (loginCode && pinParam) {
      setBusy(true);
      api('/login', {
        method: 'POST',
        body: JSON.stringify({ id: loginCode, pin: pinParam, deviceKey: getDeviceKey() })
      })
        .then(d => {
          if (d.role === 'staff') {
            setRole('staff');
            setMe({ staff: d.staff, attendance: null });
            flash(`Signed in as ${d.staff.name}`);
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        })
        .catch(err => flash('', err.message))
        .finally(() => setBusy(false));
    }
  }, []);

  // Auto-submit attendance if user logged in with a pending scan token
  useEffect(() => {
    if (role === 'staff' && pendingScanToken) {
      const token = pendingScanToken;
      setPendingScanToken(null);
      flash('Shop attendance QR detected! Verifying check-in...');
      submitAttendance(token, action || 'in');
    }
  }, [role, pendingScanToken]);

  // Fetch Admin Data
  const refreshAdmin = async (targetDate = selectedDate) => {
    try {
      const [s, b, d, l] = await Promise.all([
        api('/owner/staff'),
        api(`/owner/board?date=${targetDate}`),
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
      refreshAdmin(selectedDate);
      const t = setInterval(() => refreshAdmin(selectedDate), 5000);
      return () => clearInterval(t);
    }
  }, [role, selectedDate]);

  // Shop QR Polling for Admin Kiosk
  useEffect(() => {
    if (role === 'owner' && tab === 'qr') {
      const loadQr = () => api('/owner/qr').then(setQr).catch(e => flash('', e.message));
      loadQr();
      const t = setInterval(loadQr, 20000);
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
  // UNIFIED LOGIN HANDLER (Only ID + PIN)
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
        flash('Welcome, Admin');
      } else if (d.role === 'staff') {
        setRole('staff');
        setMe({ staff: d.staff, attendance: null });
        setLoginId('');
        setLoginPin('');
        flash(`Welcome back, ${d.staff.name}`);
        if (pendingScanToken) {
          const t = pendingScanToken;
          setPendingScanToken(null);
          setTimeout(() => submitAttendance(t, 'in'), 300);
        }
      }
    } catch (e) {
      flash('', e.message);
    } finally {
      setBusy(false);
    }
  };

  // Login QR Scanner (Scanning a staff card / login QR code directly from login screen)
  const startLoginScanner = async () => {
    setLoginScannerOpen(true);
    setTimeout(async () => {
      try {
        const q = new Html5Qrcode('login-qr-reader');
        loginScanner.current = q;

        const qrConfig = { fps: 10, qrbox: { width: 250, height: 250 } };
        const onScanSuccess = async decoded => {
          try {
            await q.stop();
          } catch {}
          loginScanner.current = null;
          setLoginScannerOpen(false);

          // Check if user accidentally scanned the Attendance QR instead of Login QR
          if (decoded.includes('?scan=')) {
            let scanVal = decoded;
            try {
              scanVal = new URL(decoded).searchParams.get('scan') || decoded;
            } catch {
              const m = decoded.match(/[?&]scan=([^&#]+)/);
              if (m) scanVal = decodeURIComponent(m[1]);
            }
            setPendingScanToken(scanVal);
            setLoginId(loginId || 'RR001');
            flash('Shop Attendance QR scanned! Enter your PIN (1234) and click Sign In to clock in.');
            return;
          }

          // Check if scanned decoded is URL with ?auth= or direct token
          let token = decoded;
          if (decoded.includes('?auth=')) {
            try {
              token = new URL(decoded).searchParams.get('auth') || decoded;
            } catch {
              const m = decoded.match(/[?&]auth=([^&#]+)/);
              if (m) token = decodeURIComponent(m[1]);
            }
          }

          setBusy(true);
          try {
            const res = await api('/login', {
              method: 'POST',
              body: JSON.stringify({ authToken: token, deviceKey: getDeviceKey() })
            });
            if (res.role === 'staff') {
              setRole('staff');
              setMe({ staff: res.staff, attendance: null });
              flash(`Signed in as ${res.staff.name}!`);
            }
          } catch (err) {
            flash('', `QR Login failed: ${err.message}`);
          } finally {
            setBusy(false);
          }
        };

        // Try back environment camera first, then user front camera (never pass boolean)
        try {
          await q.start({ facingMode: 'environment' }, qrConfig, onScanSuccess, () => {});
        } catch (camErr) {
          console.warn('Environment camera failed, trying user camera:', camErr);
          await q.start({ facingMode: 'user' }, qrConfig, onScanSuccess, () => {});
        }
      } catch (err) {
        setLoginScannerOpen(false);
        flash('', `Camera error: ${err.message || err}. Please sign in using ID and PIN.`);
      }
    }, 180);
  };

  const stopLoginScanner = async () => {
    try {
      if (loginScanner.current) {
        await loginScanner.current.stop();
        loginScanner.current = null;
      }
    } catch {}
    setLoginScannerOpen(false);
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

  // Admin Management Handlers
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

      setCreatedStaffCreds({
        name: staffName,
        code: staffCode,
        pin: staffPin,
        portalUrl: phonePortalUrl
      });

      setNewStaffName('');
      setNewStaffCode('');
      setNewStaffPin('');
      flash('Staff member successfully created!');
      refreshAdmin(selectedDate);
    } catch (e) {
      flash('', e.message);
    }
  };

  const handleDeleteStaff = async (id, name, code) => {
    if (!window.confirm(`Permanently delete staff member ${name} (${code})?\nAll attendance records and device registrations for this staff member will be removed.`)) {
      return;
    }
    try {
      await api(`/owner/staff/${id}`, { method: 'DELETE' });
      flash(`Staff member ${name} deleted successfully.`);
      refreshAdmin(selectedDate);
    } catch (e) {
      flash('', e.message);
    }
  };

  const openStaffLoginQrModal = async staffId => {
    try {
      setBusy(true);
      const res = await api(`/owner/staff/${staffId}/login-qr`);
      setActiveStaffQrModal(res);
    } catch (err) {
      flash('', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleClearAuditLogs = async () => {
    if (!window.confirm('Are you sure you want to permanently clear all security audit logs?')) {
      return;
    }
    try {
      await api('/owner/logs', { method: 'DELETE' });
      flash('Security audit logs cleared.');
      refreshAdmin(selectedDate);
    } catch (err) {
      flash('', err.message);
    }
  };

  const handleUpdateAdminPin = async e => {
    e.preventDefault();
    try {
      await api('/owner/pin', {
        method: 'POST',
        body: JSON.stringify({ newPin: adminNewPin })
      });
      setPinChangeMsg('Admin PIN updated successfully.');
      setAdminNewPin('');
      setTimeout(() => setPinChangeMsg(''), 5000);
      flash('Admin unique PIN updated');
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
      refreshAdmin(selectedDate);
    } catch (e) {
      flash('', e.message);
    }
  };

  const handleToggleStaff = async id => {
    try {
      await api(`/owner/staff/${id}/toggle`, { method: 'POST' });
      refreshAdmin(selectedDate);
    } catch (e) {
      flash('', e.message);
    }
  };

  const handleStaffChangePin = async e => {
    e.preventDefault();
    if (staffNewPin !== staffConfirmPin) {
      flash('', 'New PIN and Confirmation PIN do not match.');
      return;
    }
    if (!/^\d{4,8}$/.test(staffNewPin)) {
      flash('', 'New PIN must be between 4 and 8 numeric digits.');
      return;
    }
    setBusy(true);
    try {
      const res = await api('/staff/pin', {
        method: 'POST',
        body: JSON.stringify({ currentPin: staffCurrentPin, newPin: staffNewPin })
      });
      flash(res.message || 'Your PIN has been updated successfully!');
      setStaffCurrentPin('');
      setStaffNewPin('');
      setStaffConfirmPin('');
      setPinChangeOpen(false);
    } catch (err) {
      flash('', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAdminResetStaffPin = async (staffId, staffName) => {
    const newPin = prompt(`Enter new 4–8 digit PIN for ${staffName}:`);
    if (!newPin) return;
    if (!/^\d{4,8}$/.test(newPin.trim())) {
      flash('', 'PIN must be between 4 and 8 numeric digits.');
      return;
    }
    setBusy(true);
    try {
      const res = await api(`/owner/staff/${staffId}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pin: newPin.trim() })
      });
      flash(res.message || `PIN updated for ${staffName}!`);
    } catch (err) {
      flash('', err.message);
    } finally {
      setBusy(false);
    }
  };

  const calibrateShopLocation = async () => {
    if (!navigator.geolocation) {
      flash('', 'Geolocation is not supported by your browser.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lng = Number(pos.coords.longitude.toFixed(6));
          await api('/owner/location', {
            method: 'POST',
            body: JSON.stringify({
              latitude: lat,
              longitude: lng,
              geofence: status?.geofenceMeters || 100
            })
          });
          flash(`Shop GPS successfully calibrated to ${lat}, ${lng} (100m geofence radius)!`);
          const st = await api('/status');
          setStatus(st);
        } catch (err) {
          flash('', `Failed to save shop location: ${err.message}`);
        } finally {
          setBusy(false);
        }
      },
      err => {
        setBusy(false);
        flash('', `Location error (${err.message}). Allow GPS permission to calibrate.`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ----------------------------------------------------
  // MULTI-METHOD ATTENDANCE SCANNER
  // ----------------------------------------------------
  const startScanner = async forcedAction => {
    const targetAction = forcedAction || action;
    setAction(targetAction);
    setScanOpen(true);
    setScanMethod('camera');

    setTimeout(async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScanMethod('passcode');
        flash('Direct camera preview restricted. Please enter shop passcode or upload photo.');
        return;
      }

      try {
        const q = new Html5Qrcode('qr-reader');
        scanner.current = q;

        const onScanSuccess = async decoded => {
          try {
            await q.stop();
          } catch {}
          scanner.current = null;
          setScanOpen(false);
          await submitAttendance(decoded, targetAction);
        };

        const qrConfig = { fps: 10, qrbox: { width: 250, height: 250 } };
        try {
          await q.start({ facingMode: 'environment' }, qrConfig, onScanSuccess, () => {});
        } catch (camErr) {
          console.warn('Environment camera fallback to user camera:', camErr);
          await q.start({ facingMode: 'user' }, qrConfig, onScanSuccess, () => {});
        }
      } catch (e) {
        console.warn('Camera start error:', e);
        setScanMethod('passcode');
        flash('', `Camera blocked (${e.message || e}). Use shop passcode or snap photo.`);
      }
    }, 200);
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

  const handleFileUpload = async e => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setBusy(true);
      const q = new Html5Qrcode('qr-reader-hidden');
      const decoded = await q.scanFile(file, true);
      await submitAttendance(decoded, action);
      stopScanner();
    } catch (err) {
      flash('', 'Could not detect QR code in that photo. Try entering the 6-character shop passcode.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleManualPasscodeSubmit = async e => {
    e.preventDefault();
    const val = manualPasscode.trim();
    if (!val) return;
    const tokenToSend = val.length <= 10 ? val.toUpperCase() : val;
    await submitAttendance(tokenToSend, action);
    setManualPasscode('');
    stopScanner();
  };

  const submitAttendance = async (tokenOrCode, actionType) => {
    let cleanToken = String(tokenOrCode || '').trim();
    if (cleanToken.includes('?scan=')) {
      try {
        const u = new URL(cleanToken);
        cleanToken = u.searchParams.get('scan') || cleanToken;
      } catch {
        const m = cleanToken.match(/[?&]scan=([^&#]+)/);
        if (m) cleanToken = decodeURIComponent(m[1]);
      }
    }

    setBusy(true);
    let coords = null;
    try {
      if (navigator.geolocation) {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 0
          })
        );
        coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      }
    } catch (gpsErr) {
      console.warn('Geolocation capture failed:', gpsErr);
    }

    try {
      const d = await api('/attendance/scan', {
        method: 'POST',
        body: JSON.stringify({
          token: cleanToken,
          action: actionType || action,
          latitude: coords ? coords.latitude : null,
          longitude: coords ? coords.longitude : null,
          deviceKey: getDeviceKey()
        })
      });
      setMe({ staff: d.staff, attendance: d.attendance });
      checkGeofence();
      flash('Attendance verified & saved successfully!');
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

  // Lunch duration color-coded badge & meta helper:
  // < 1 hour (< 60 mins): GREEN
  // 1 hour to 1 hour 30 min (60 to 90 mins): YELLOW
  // > 1 hour 30 min (> 90 mins): RED
  const getLunchDurationMeta = (mins = 0) => {
    const m = Number(mins) || 0;
    const hours = Math.floor(m / 60);
    const remMins = m % 60;
    const timeText = hours > 0 ? (remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`) : `${remMins}m`;
    if (m === 0) {
      return { tier: 'none', color: '#64748B', bg: '#F1F5F9', border: '#E2E8F0', label: 'None', text: '0m' };
    }
    if (m < 60) {
      return { tier: 'green', color: '#059669', bg: '#ECFDF5', border: '#A7F3D0', label: '< 1h (On Time)', text: timeText };
    } else if (m <= 90) {
      return { tier: 'yellow', color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: '1h–1.5h (Moderate)', text: timeText };
    } else {
      return { tier: 'red', color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: '> 1.5h (Overtime)', text: timeText };
    }
  };

  // Filtered Board Data with Date and Status
  const filteredBoard = useMemo(() => {
    let result = board;
    if (statusFilter === 'present' || statusFilter === 'in') {
      result = result.filter(item => item.status === 'in');
    } else if (statusFilter === 'lunch') {
      result = result.filter(item => item.status === 'lunch');
    } else if (statusFilter === 'completed' || statusFilter === 'out') {
      result = result.filter(item => item.status === 'out' && item.clock_in);
    } else if (statusFilter === 'absent') {
      result = result.filter(item => item.status === 'absent' || !item.clock_in);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        item => item.name?.toLowerCase().includes(q) || item.code?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [board, statusFilter, searchQuery]);

  // Counts for Dynamic Real-time KPIs for selected date
  const onDutyCount = useMemo(
    () => board.filter(b => b.status === 'in').length,
    [board]
  );
  const lunchCount = useMemo(
    () => board.filter(b => b.status === 'lunch').length,
    [board]
  );
  const completedCount = useMemo(
    () => board.filter(b => b.status === 'out' && b.clock_in).length,
    [board]
  );
  const absentCount = useMemo(
    () => board.filter(b => b.status === 'absent' || !b.clock_in).length,
    [board]
  );

  // Filtered Security Audit Logs
  const filteredLogs = useMemo(() => {
    let result = logs;
    if (logFilter === 'success') {
      result = result.filter(l => l.result === 'success' || l.result === 'device_approved');
    } else if (logFilter === 'failed') {
      result = result.filter(
        l =>
          l.result === 'failed_geofence' ||
          l.result === 'failed_gps' ||
          l.result === 'failed_login' ||
          l.result === 'failed_qr' ||
          l.result === 'invalid_passcode' ||
          l.result === 'blocked'
      );
    } else if (logFilter === 'devices') {
      result = result.filter(l => l.result?.includes('device'));
    }

    if (logSearchQuery) {
      const q = logSearchQuery.toLowerCase();
      result = result.filter(
        l =>
          l.name?.toLowerCase().includes(q) ||
          l.code?.toLowerCase().includes(q) ||
          l.detail?.toLowerCase().includes(q) ||
          l.result?.toLowerCase().includes(q) ||
          l.device_key?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [logs, logFilter, logSearchQuery]);

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
            <p>Enter your assigned ID and PIN or scan your QR to access</p>
          </div>

          <div className="login-role-selector">
            <button
              type="button"
              className={`role-select-btn ${(loginId === 'ADMIN' || loginId === 'OWNER') ? 'active' : ''}`}
              onClick={() => { setLoginId('ADMIN'); setLoginPin('1234'); }}
            >
              <ShieldCheck size={14} /> Admin Portal
            </button>
            <button
              type="button"
              className={`role-select-btn ${(loginId === 'RR001' || loginId === 'RAJ') ? 'active' : ''}`}
              onClick={() => { setLoginId('RR001'); setLoginPin('1234'); }}
            >
              <User size={14} /> Staff Portal
            </button>
          </div>

          <form onSubmit={handleUnifiedLogin}>
            <div className="form-group">
              <label className="form-label">
                <span>Account ID</span>
                <span className="section-label" style={{ fontSize: '0.68rem' }}>Staff ID or ADMIN</span>
              </label>
              <div className="input-wrapper">
                <span className="input-icon-left">
                  <User size={18} />
                </span>
                <input
                  value={loginId}
                  onChange={e => setLoginId(e.target.value.toUpperCase())}
                  placeholder="e.g. RR001 or ADMIN"
                  className="form-input font-mono"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
                  required
                  autoFocus
                />
              </div>
            </div>

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

            <div className="login-role-hint">
              <Info size={16} style={{ flexShrink: 0, marginTop: '2px', color: '#059669' }} />
              <div>
                <strong>Staff:</strong> Enter your Staff ID (<code>RR001</code>) or Name (<code>RAJ</code>) and PIN (<code>1234</code>).<br />
                <strong>Admin:</strong> Enter ID <code>ADMIN</code> and Admin PIN (<code>1234</code>).
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={busy}>
              <ChevronRight size={18} /> {busy ? 'Verifying Credentials…' : 'Sign In'}
            </button>
          </form>

          {/* Quick Scan to Login Action */}
          <button
            type="button"
            className="btn-qr-login-pill"
            onClick={startLoginScanner}
            disabled={busy}
          >
            <QrCode size={18} />
            <span>Scan QR Code to Sign In</span>
          </button>

          {loginScannerOpen && (
            <div className="scanner-container-card" style={{ marginTop: '16px' }}>
              <div id="login-qr-reader" className="scanner-view-box" style={{ minHeight: '250px' }} />
              <p style={{ fontSize: '0.8rem', color: '#64748B', textAlign: 'center', marginTop: '6px' }}>
                Scan your personalized Staff Login QR code to sign in automatically
              </p>
              <button type="button" className="scanner-cancel-btn" onClick={stopLoginScanner}>
                Cancel Camera
              </button>
            </div>
          )}

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 className="topbar-title">Rajarajeswari</h1>
              <span className="live-db-pill">
                <span className="pulse-dot green" /> MongoDB Cloud
              </span>
            </div>
            <p className="topbar-subtitle">Retail Workforce & Attendance Platform</p>
          </div>
        </div>

        <div className="topbar-user">
          {role === 'staff' ? (
            <div className="user-badge">
              <div className="user-avatar-circle">
                {(me?.staff?.name || 'S').slice(0, 1).toUpperCase()}
              </div>
              <div className="user-details">
                <span className="user-name">{me?.staff?.name || 'Staff'}</span>
                <span className="staff-code-pill font-mono">{me?.staff?.code || 'RR001'}</span>
              </div>
            </div>
          ) : (
            <div className="user-badge">
              <div className="user-avatar-circle admin">A</div>
              <div className="user-details">
                <span className="user-name">Store Admin</span>
                <span className="staff-code-pill font-mono admin-tag">ADMIN</span>
              </div>
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

            <div className={`geofence-pill ${geoStatus.state}`}>
              <span className="pulse-dot" />
              <span>{geoStatus.text}</span>
            </div>

            <div className="current-shift-badge">
              <StatusBadge status={currentStatus} />
            </div>
          </section>

          {/* Primary Action Grid */}
          <section className="action-card">
            <div className="action-card-header">
              <h3>Attendance Actions</h3>
              <p>Select action and scan the live QR code at the shop desk</p>
            </div>

            <div className="attendance-action-grid">
              {currentStatus === 'out' ? (
                me?.attendance?.clock_in && me?.attendance?.clock_out ? (
                  <div style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: '#F8FAFC',
                    border: '1.5px solid #E2E8F0',
                    textAlign: 'center',
                    width: '100%'
                  }}>
                    <CheckCircle2 size={32} color="#059669" style={{ margin: '0 auto 8px' }} />
                    <h4 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
                      Shift Completed for Today
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.84rem', color: '#64748B' }}>
                      Entry: {fmtTime(me.attendance.clock_in)} • Exit: {fmtTime(me.attendance.clock_out)} ({fmtDuration(me.attendance.net_work_minutes || 0)} worked)
                    </p>
                  </div>
                ) : (
                  <button
                    className="btn-action-primary"
                    onClick={() => startScanner('in')}
                    disabled={busy}
                  >
                    <Store size={22} />
                    <span>Check In for Shift</span>
                  </button>
                )
              ) : currentStatus === 'in' ? (
                (!me?.attendance?.break_started && (me?.attendance?.total_break_minutes || 0) > 0) ? (
                  <>
                    {(() => {
                      const meta = getLunchDurationMeta(me?.attendance?.total_break_minutes);
                      return (
                        <div style={{
                          padding: '14px 16px',
                          borderRadius: '12px',
                          background: meta.bg,
                          border: `1.5px solid ${meta.border}`,
                          color: meta.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          width: '100%'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Coffee size={22} color={meta.color} />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.94rem' }}>
                                Lunch Completed: {meta.text}
                              </div>
                              <div style={{ fontSize: '0.78rem', opacity: 0.9 }}>
                                Status: {meta.label} • Resumed Shift
                              </div>
                            </div>
                          </div>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: '#fff',
                            border: `1px solid ${meta.border}`,
                            color: meta.color
                          }}>
                            {meta.label}
                          </span>
                        </div>
                      );
                    })()}
                    <button
                      className="btn-checkout"
                      style={{ width: '100%', height: '52px', fontSize: '1rem', fontWeight: 600 }}
                      onClick={() => startScanner('out')}
                      disabled={busy}
                    >
                      <LogOut size={20} />
                      <span>Check Out</span>
                    </button>
                  </>
                ) : (
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
                )
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

              {(!me?.attendance?.clock_in || !me?.attendance?.clock_out) && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ justifyContent: 'center', height: '48px', fontSize: '0.92rem' }}
                  onClick={() => startScanner(action)}
                  disabled={busy}
                >
                  <ScanLine size={19} />
                  <span>Open Verification Scanner / Passcode</span>
                </button>
              )}
            </div>

            {/* Robust Multi-Method Scanner Box */}
            {scanOpen && (
              <div className="scanner-container-card">
                <div className="scanner-method-tabs">
                  <button
                    type="button"
                    className={`scanner-method-btn ${scanMethod === 'camera' ? 'active' : ''}`}
                    onClick={() => {
                      setScanMethod('camera');
                      startScanner(action);
                    }}
                  >
                    <Camera size={14} /> Live Camera
                  </button>

                  <button
                    type="button"
                    className={`scanner-method-btn ${scanMethod === 'upload' ? 'active' : ''}`}
                    onClick={() => setScanMethod('upload')}
                  >
                    <Upload size={14} /> Snap Photo
                  </button>

                  <button
                    type="button"
                    className={`scanner-method-btn ${scanMethod === 'passcode' ? 'active' : ''}`}
                    onClick={() => setScanMethod('passcode')}
                  >
                    <KeyRound size={14} /> Shop Code
                  </button>
                </div>

                {/* Method 1: Live Camera */}
                {scanMethod === 'camera' && (
                  <div>
                    <div id="qr-reader" className="scanner-view-box" style={{ minHeight: '260px' }} />
                    <p style={{ fontSize: '0.78rem', color: '#64748B', textAlign: 'center', marginTop: '6px' }}>
                      Point camera at the live rotating QR on the shop desk
                    </p>
                  </div>
                )}

                {/* Method 2: Snap Photo / File Upload */}
                {scanMethod === 'upload' && (
                  <div style={{ textAlign: 'center', padding: '20px 10px' }}>
                    <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '14px' }}>
                      Take a photo of the shop QR screen with your phone's camera:
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                      id="qr-file-input"
                    />
                    <label htmlFor="qr-file-input" className="btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', width: 'auto' }}>
                      <Camera size={18} /> Open Phone Camera / Gallery
                    </label>
                    <div id="qr-reader-hidden" style={{ display: 'none' }} />
                  </div>
                )}

                {/* Method 3: 6-Character Passcode */}
                {scanMethod === 'passcode' && (
                  <form onSubmit={handleManualPasscodeSubmit} className="passcode-input-form">
                    <p style={{ fontSize: '0.85rem', color: '#475569', textAlign: 'center' }}>
                      Enter the 6-character live code displayed right below the shop QR screen:
                    </p>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="e.g. 7A8B9C"
                      value={manualPasscode}
                      onChange={e => setManualPasscode(e.target.value.toUpperCase())}
                      className="passcode-large-input"
                      autoFocus
                      required
                    />
                    <button type="submit" className="btn-primary" disabled={busy || manualPasscode.length < 4}>
                      <Check size={18} /> Verify Passcode & Submit
                    </button>
                  </form>
                )}

                <button type="button" className="scanner-cancel-btn" onClick={stopScanner}>
                  Cancel Verification
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
                  {(me?.attendance?.total_break_minutes || 0) > 0 ? (
                    (() => {
                      const meta = getLunchDurationMeta(me?.attendance?.total_break_minutes);
                      return (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: meta.color,
                          fontWeight: 700
                        }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color }} />
                          {meta.text} ({meta.label})
                        </span>
                      );
                    })()
                  ) : (
                    '—'
                  )}
                </span>
              </div>

              <div className={`timeline-item ${me?.attendance?.clock_out ? 'active' : ''}`}>
                <span className="timeline-dot" />
                <span className="timeline-label">Exit (Clock Out)</span>
                <span className="timeline-time font-mono">{fmtTime(me?.attendance?.clock_out)}</span>
              </div>
            </div>
          </section>

          {/* Staff Change PIN Section */}
          <section className="staff-pin-card">
            <div className="staff-pin-header" onClick={() => setPinChangeOpen(!pinChangeOpen)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="pin-card-icon">
                  <KeyRound size={18} />
                </div>
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Security & PIN Settings</h4>
                  <p style={{ fontSize: '0.78rem', color: '#64748B' }}>Change your private staff sign-in PIN</p>
                </div>
              </div>
              <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                {pinChangeOpen ? 'Hide' : 'Change PIN'}
              </button>
            </div>

            {pinChangeOpen && (
              <form onSubmit={handleStaffChangePin} className="staff-pin-form">
                <div className="form-group">
                  <label className="form-label">
                    <span>Current Security PIN</span>
                    <span className="section-label" style={{ fontSize: '0.65rem' }}>Verify Identity</span>
                  </label>
                  <div className="input-wrapper">
                    <span className="input-icon-left"><Lock size={16} /></span>
                    <input
                      type={showCurrentPin ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={8}
                      value={staffCurrentPin}
                      onChange={e => setStaffCurrentPin(e.target.value)}
                      placeholder="Enter current PIN"
                      className="form-input font-mono"
                      required
                    />
                    <button
                      type="button"
                      className="toggle-password-btn"
                      onClick={() => setShowCurrentPin(!showCurrentPin)}
                    >
                      {showCurrentPin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <span>New Security PIN</span>
                    <span className="section-label" style={{ fontSize: '0.65rem' }}>4–8 Digits</span>
                  </label>
                  <div className="input-wrapper">
                    <span className="input-icon-left"><KeyRound size={16} /></span>
                    <input
                      type={showNewPin ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={8}
                      value={staffNewPin}
                      onChange={e => setStaffNewPin(e.target.value)}
                      placeholder="Enter new 4–8 digit PIN"
                      className="form-input font-mono"
                      required
                    />
                    <button
                      type="button"
                      className="toggle-password-btn"
                      onClick={() => setShowNewPin(!showNewPin)}
                    >
                      {showNewPin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <span>Confirm New PIN</span>
                    <span className="section-label" style={{ fontSize: '0.65rem' }}>Must Match</span>
                  </label>
                  <div className="input-wrapper">
                    <span className="input-icon-left"><Check size={16} /></span>
                    <input
                      type={showNewPin ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={8}
                      value={staffConfirmPin}
                      onChange={e => setStaffConfirmPin(e.target.value)}
                      placeholder="Re-enter new PIN"
                      className="form-input font-mono"
                      required
                    />
                  </div>
                </div>

                <button type="submit" className="btn-primary" disabled={busy || !staffNewPin || !staffCurrentPin}>
                  <ShieldCheck size={16} /> {busy ? 'Updating PIN…' : 'Update My Security PIN'}
                </button>
              </form>
            )}
          </section>
        </div>
      ) : (
        /* ----------------------------------------------------
            B. ADMIN DASHBOARD LAYOUT
            ---------------------------------------------------- */
        <div>
          <div className="owner-header-row">
            <div className="owner-title-block">
              <p className="section-label">Retail Operations</p>
              <h2>Admin Attendance & Staff Console</h2>
              <p>Attendance calendar, live shop QR kiosk, and staff administration</p>
            </div>
            <button className="btn-secondary" onClick={() => refreshAdmin(selectedDate)}>
              <RefreshCw size={15} /> Refresh Data
            </button>
          </div>

          {/* Top Summary Strip: Dynamic KPIs for Selected Date */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-icon staff">
                <Users size={22} />
              </div>
              <div className="kpi-info">
                <span className="kpi-label">Total Staff</span>
                <div className="kpi-value font-mono">{staff.length}</div>
                <span className="kpi-subtext">Registered workforce</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon present">
                <CheckCircle2 size={22} />
              </div>
              <div className="kpi-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="kpi-label">Active On Duty</span>
                  <span className="pulse-dot green" />
                </div>
                <div className="kpi-value font-mono" style={{ color: '#059669' }}>
                  {onDutyCount}
                </div>
                <span className="kpi-subtext">Working right now</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon break" style={{ background: '#FFFBEB', color: '#D97706' }}>
                <Coffee size={22} />
              </div>
              <div className="kpi-info">
                <span className="kpi-label">On Lunch</span>
                <div className="kpi-value font-mono" style={{ color: '#D97706' }}>
                  {lunchCount}
                </div>
                <span className="kpi-subtext">Taking break</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon shift-out" style={{ background: '#EFF6FF', color: '#2563EB' }}>
                <LogOut size={22} />
              </div>
              <div className="kpi-info">
                <span className="kpi-label">Shift Done</span>
                <div className="kpi-value font-mono" style={{ color: '#2563EB' }}>
                  {completedCount}
                </div>
                <span className="kpi-subtext">Duty completed</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon absent" style={{ background: '#FFF1F2', color: '#E11D48' }}>
                <XCircle size={22} />
              </div>
              <div className="kpi-info">
                <span className="kpi-label">Absent / Off</span>
                <div className="kpi-value font-mono" style={{ color: '#E11D48' }}>
                  {absentCount}
                </div>
                <span className="kpi-subtext">Not checked in</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="dashboard-tabs">
            {[
              ['board', 'Attendance Calendar & Board', Calendar],
              ['qr', 'Shop QR Screen', QrCode],
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

          {/* TAB 1: ATTENDANCE CALENDAR & LIVE BOARD */}
          {tab === 'board' && (
            <div>
              <div className="calendar-bar">
                <div className="calendar-input-group">
                  <Calendar size={18} color="#064E3B" />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>
                    Select Date:
                  </span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                    className="calendar-date-input"
                  />
                  <button
                    type="button"
                    className={`date-pill-btn ${selectedDate === new Date().toISOString().slice(0, 10) ? 'active' : ''}`}
                    onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className="date-pill-btn"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 1);
                      setSelectedDate(d.toISOString().slice(0, 10));
                    }}
                  >
                    Yesterday
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`date-pill-btn ${statusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('all')}
                  >
                    All ({board.length})
                  </button>
                  <button
                    type="button"
                    className={`date-pill-btn ${statusFilter === 'present' ? 'active' : ''}`}
                    style={statusFilter === 'present' ? { background: '#059669', borderColor: '#059669', color: '#fff' } : {}}
                    onClick={() => setStatusFilter('present')}
                  >
                    On Duty ({onDutyCount})
                  </button>
                  <button
                    type="button"
                    className={`date-pill-btn ${statusFilter === 'lunch' ? 'active' : ''}`}
                    style={statusFilter === 'lunch' ? { background: '#D97706', borderColor: '#D97706', color: '#fff' } : {}}
                    onClick={() => setStatusFilter('lunch')}
                  >
                    Lunch ({lunchCount})
                  </button>
                  <button
                    type="button"
                    className={`date-pill-btn ${statusFilter === 'completed' ? 'active' : ''}`}
                    style={statusFilter === 'completed' ? { background: '#2563EB', borderColor: '#2563EB', color: '#fff' } : {}}
                    onClick={() => setStatusFilter('completed')}
                  >
                    Done ({completedCount})
                  </button>
                  <button
                    type="button"
                    className={`date-pill-btn ${statusFilter === 'absent' ? 'active' : ''}`}
                    style={statusFilter === 'absent' ? { background: '#E11D48', borderColor: '#E11D48', color: '#fff' } : {}}
                    onClick={() => setStatusFilter('absent')}
                  >
                    Absent ({absentCount})
                  </button>
                </div>
              </div>

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

              <section className="content-card">
                <div className="card-header">
                  <div>
                    <h3 className="card-title">
                      Attendance for {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                    </h3>
                  </div>
                  <span className="geofence-pill inside">
                    <span className="pulse-dot" />
                    <span>{selectedDate === new Date().toISOString().slice(0, 10) ? 'LIVE TODAY' : 'HISTORICAL LOG'}</span>
                  </span>
                </div>

                <div className="table-responsive desktop-table-view">
                  <table className="saas-table">
                    <thead>
                      <tr>
                        <th>Staff Member</th>
                        <th>Staff ID</th>
                        <th>Attendance Status</th>
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
                          <td>
                            {(row.total_break_minutes || 0) > 0 ? (
                              (() => {
                                const meta = getLunchDurationMeta(row.total_break_minutes);
                                return (
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.8rem',
                                    fontWeight: 700,
                                    background: meta.bg,
                                    color: meta.color,
                                    border: `1px solid ${meta.border}`
                                  }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color }} />
                                    {meta.text}
                                  </span>
                                );
                              })()
                            ) : (
                              <span className="font-mono" style={{ color: '#94A3B8' }}>0 mins</span>
                            )}
                          </td>
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
                      No staff records found for {selectedDate}.
                    </div>
                  )}
                </div>

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
                          {(row.total_break_minutes || 0) > 0 ? (
                            (() => {
                              const meta = getLunchDurationMeta(row.total_break_minutes);
                              return (
                                <strong className="font-mono" style={{ color: meta.color }}>
                                  {meta.text}
                                </strong>
                              );
                            })()
                          ) : (
                            <strong className="font-mono" style={{ color: '#94A3B8' }}>0m</strong>
                          )}
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
            </div>
          )}

          {/* TAB 2: SHOP QR SCREEN */}
          {tab === 'qr' && (
            <section className="content-card qr-container-card">
              <div className="card-header" style={{ justifyContent: 'center' }}>
                <h3 className="card-title">Live Shop Screen Attendance Kiosk</h3>
              </div>
              <p style={{ color: '#64748B', fontSize: '0.9rem', marginTop: '12px' }}>
                Mount this display at the shop checkout. Staff scan the QR code with their phone camera, or type the 6-character live passcode below if their camera is unavailable.
              </p>

              {qr ? (
                <>
                  <div className="qr-code-frame">
                    <img src={qr.dataUrl} alt="Live rotating QR attendance code" />
                    <div className="qr-scanner-line" />
                  </div>

                  {qr.passcode && (
                    <div className="qr-passcode-display">
                      <span className="passcode-label">LIVE SHOP PASSCODE (FOR MANUAL ENTRY)</span>
                      <div className="passcode-boxes-row">
                        {qr.passcode.split('').map((char, idx) => (
                          <div key={idx} className="passcode-digit-box font-mono">
                            {char}
                          </div>
                        ))}
                      </div>
                      <p className="passcode-hint">Staff can type these 6 letters into their phone if camera scanning is unavailable</p>
                    </div>
                  )}

                  {qr.scanUrl && (
                    <div className="qr-direct-link-strip">
                      <Smartphone size={15} color="#059669" />
                      <span className="direct-link-text font-mono">{qr.scanUrl}</span>
                      <button
                        type="button"
                        className="btn-copy-link"
                        onClick={() => copyToClipboard(qr.scanUrl, 'Direct scan link copied!')}
                      >
                        <Copy size={13} /> Copy Link
                      </button>
                    </div>
                  )}

                  <div className="qr-countdown font-mono">
                    <Clock size={16} />
                    <span>Auto-rotates every 90s (Anti-Replay Security) · Valid until {new Date(qr.expiresAt * 1000).toLocaleTimeString()}</span>
                  </div>

                  <div className="shop-location-card" style={{
                    marginTop: '20px',
                    padding: '16px 20px',
                    borderRadius: '12px',
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    textAlign: 'left'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <MapPin size={16} color="#059669" />
                          <span>Shop Geofence Verification Zone</span>
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                          {status?.configured
                            ? `Center: ${status.shopLat?.toFixed(4)}, ${status.shopLng?.toFixed(4)} · Maximum Radius: ${status.geofenceMeters || 100}m`
                            : 'GPS coordinates not configured yet.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '8px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={calibrateShopLocation}
                        disabled={busy}
                      >
                        <Compass size={14} /> Calibrate Shop to My Location
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: '60px 20px', color: '#94A3B8' }}>
                  Generating cryptographically signed QR & passcode…
                </div>
              )}

              <p className="login-footer" style={{ marginTop: '20px' }}>
                <ShieldCheck size={16} /> HMAC-SHA256 Token Signature · 90-Second Rotation · Single-Use Anti-Replay
              </p>
            </section>
          )}

          {/* TAB 3: STAFF MANAGEMENT & LOGIN INFO */}
          {tab === 'staff' && (
            <div>
              {/* WHERE STAFF CAN LOGIN IT - Top Informational Banner + Instant QR */}
              <div className="portal-link-banner">
                <div className="portal-link-header">
                  <div style={{ flex: 1 }}>
                    <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#064E3B' }}>
                      Where Staff Can Log In (Network URL for Phones)
                    </h4>
                    <p style={{ fontSize: '0.85rem', color: '#475569', marginTop: '3px' }}>
                      Staff smartphones on the shop Wi-Fi can open this network address or scan the QR code to access the portal:
                    </p>
                    <div className="portal-url-badge" style={{ marginTop: '10px' }}>
                      <Smartphone size={16} />
                      <span>{phonePortalUrl}</span>
                    </div>
                  </div>

                  {portalQrData && (
                    <div style={{ textAlign: 'center', background: '#F8FAFC', padding: '10px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
                      <img src={portalQrData} alt="Scan to open login portal" style={{ width: 110, height: 110, display: 'block' }} />
                      <span style={{ fontSize: '0.7rem', color: '#64748B', fontWeight: 600 }}>Scan with Phone</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="btn-accent"
                    style={{ padding: '8px 14px', fontSize: '0.82rem' }}
                    onClick={() =>
                      copyToClipboard(
                        `Rajarajeswari Staff Attendance Portal:\nOpen this link: ${phonePortalUrl}\nEnter your assigned Staff ID and PIN to clock in.`,
                        'Portal link & instructions copied!'
                      )
                    }
                  >
                    <Copy size={15} /> Copy Staff Login Instructions
                  </button>
                  <a
                    className="btn-secondary"
                    style={{ padding: '8px 14px', fontSize: '0.82rem' }}
                    href={phonePortalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={15} /> Open Portal in New Tab
                  </a>
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

                  {/* Admin Unique PIN Configuration */}
                  <div style={{ marginTop: '32px', paddingTop: '20px', borderTop: '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <KeyRound size={17} color="#064E3B" />
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#064E3B' }}>
                        Admin Unique PIN
                      </h4>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '12px' }}>
                      Admin Login ID is <strong>ADMIN</strong>. You can change your private Admin PIN below.
                    </p>

                    <form onSubmit={handleUpdateAdminPin}>
                      <div className="form-group">
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={8}
                          value={adminNewPin}
                          onChange={e => setAdminNewPin(e.target.value)}
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
                        Update Admin PIN
                      </button>
                    </form>
                    {pinChangeMsg && (
                      <p style={{ fontSize: '0.8rem', color: '#059669', marginTop: '8px', fontWeight: 600 }}>
                        {pinChangeMsg}
                      </p>
                    )}
                  </div>
                </div>

                {/* Staff Directory List (with Login QR and Delete Button) */}
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

                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Instant QR Code Login Generator Button */}
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                          onClick={() => openStaffLoginQrModal(s.id)}
                          title="Show Staff Direct Login QR Code"
                        >
                          <QrCode size={13} /> QR Login
                        </button>

                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                          onClick={() =>
                            copyToClipboard(
                              `Staff Login: ID=${s.code} | URL=${phonePortalUrl}`,
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
                          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                          onClick={() => handleAdminResetStaffPin(s.id, s.name)}
                          title="Reset staff member's PIN"
                        >
                          <KeyRound size={13} /> PIN
                        </button>

                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                          onClick={() => handleToggleStaff(s.id)}
                        >
                          {s.active ? 'Deactivate' : 'Activate'}
                        </button>

                        <button
                          type="button"
                          className="btn-delete-staff"
                          onClick={() => handleDeleteStaff(s.id, s.name, s.code)}
                          title="Delete staff member"
                        >
                          <Trash2 size={13} />
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

          {/* TAB 4: REGISTERED PHONES */}
          {tab === 'devices' && (
            <section className="content-card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Registered Staff Smartphones</h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '2px' }}>
                    Staff phones are automatically registered and approved on their first valid login.
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

          {/* TAB 5: CONTINUED & ENHANCED SECURITY AUDIT LOGS */}
          {tab === 'logs' && (
            <section className="content-card">
              <div className="card-header" style={{ flexWrap: 'wrap' }}>
                <div>
                  <h3 className="card-title">Security & Scan Audit Trail</h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '2px' }}>
                    Tamper-proof real-time audit log of GPS verifications, device activations, and scan results
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => refreshAdmin(selectedDate)}
                  >
                    <RefreshCw size={15} /> Refresh Logs
                  </button>
                  <a
                    className="btn-secondary"
                    href="/api/owner/export-logs.csv"
                    download="rajarajeswari-security-audit-logs.csv"
                  >
                    <Download size={15} /> Export Audit Log (CSV)
                  </a>
                  <button
                    type="button"
                    className="btn-delete-staff"
                    style={{ padding: '8px 12px' }}
                    onClick={handleClearAuditLogs}
                  >
                    <Trash2 size={15} /> Clear Logs
                  </button>
                </div>
              </div>

              {/* Audit Search & Filter Controls */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                <div className="audit-filter-bar">
                  <div className="search-input-wrapper" style={{ maxWidth: '320px' }}>
                    <Search size={16} className="search-icon" />
                    <input
                      type="text"
                      placeholder="Search by staff, code, detail…"
                      value={logSearchQuery}
                      onChange={e => setLogSearchQuery(e.target.value)}
                      className="search-input"
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`date-pill-btn ${logFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setLogFilter('all')}
                    >
                      All ({logs.length})
                    </button>
                    <button
                      type="button"
                      className={`date-pill-btn ${logFilter === 'success' ? 'active' : ''}`}
                      style={logFilter === 'success' ? { background: '#059669', borderColor: '#059669', color: '#fff' } : {}}
                      onClick={() => setLogFilter('success')}
                    >
                      Success
                    </button>
                    <button
                      type="button"
                      className={`date-pill-btn ${logFilter === 'failed' ? 'active' : ''}`}
                      style={logFilter === 'failed' ? { background: '#E11D48', borderColor: '#E11D48', color: '#fff' } : {}}
                      onClick={() => setLogFilter('failed')}
                    >
                      Security Alerts
                    </button>
                    <button
                      type="button"
                      className={`date-pill-btn ${logFilter === 'devices' ? 'active' : ''}`}
                      onClick={() => setLogFilter('devices')}
                    >
                      Device Events
                    </button>
                  </div>
                </div>
              </div>

              <div className="table-responsive">
                <table className="saas-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Staff Member</th>
                      <th>Result</th>
                      <th>GPS Coordinates</th>
                      <th>Device Key</th>
                      <th>Event Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map(log => (
                      <tr key={log.id}>
                        <td className="font-mono" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
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
                          {log.latitude && log.longitude ? (
                            <a
                              href={`https://www.google.com/maps?q=${log.latitude},${log.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#047857', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <MapPin size={13} />
                              <span>{log.latitude.toFixed(4)}, {log.longitude.toFixed(4)}</span>
                            </a>
                          ) : (
                            <span style={{ color: '#94A3B8' }}>—</span>
                          )}
                        </td>
                        <td className="font-mono" style={{ fontSize: '0.78rem', color: '#64748B' }}>
                          {log.device_key ? `${log.device_key.slice(0, 14)}…` : '—'}
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{log.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredLogs.length && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
                    No security log entries match your filter.
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Staff Login QR Code Modal */}
      {activeStaffQrModal && (
        <div className="modal-overlay" onClick={() => setActiveStaffQrModal(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ textAlign: 'left' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#064E3B' }}>
                  Staff Login QR Code
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#64748B' }}>
                  {activeStaffQrModal.name} ({activeStaffQrModal.code})
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '6px' }}
                onClick={() => setActiveStaffQrModal(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-qr-frame">
              <img src={activeStaffQrModal.dataUrl} alt="Staff Direct Login QR" />
            </div>

            <p style={{ fontSize: '0.82rem', color: '#475569', marginBottom: '14px' }}>
              Staff member points their smartphone camera at this QR code to log in immediately without typing their PIN.
            </p>

            <button
              type="button"
              className="btn-accent"
              style={{ width: '100%', marginBottom: '8px' }}
              onClick={() =>
                copyToClipboard(
                  `Direct Login Link for ${activeStaffQrModal.name}:\n${activeStaffQrModal.loginUrl}`,
                  'Direct login link copied!'
                )
              }
            >
              <Copy size={16} /> Copy Direct Login Link
            </button>

            <button
              type="button"
              className="btn-secondary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setActiveStaffQrModal(null)}
            >
              Done
            </button>
          </div>
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

  if (s === 'in' || s === 'present') label = 'Active On Duty';
  else if (s === 'absent') label = 'Absent / Off';
  else if (s === 'lunch' || s === 'break') label = 'On Lunch';
  else if (s === 'out') label = 'Shift Completed';
  else if (s === 'device_approved') label = 'Approved';
  else if (s === 'device_pending') label = 'Pending';
  else if (s === 'failed_geofence') label = 'Out of Range';
  else if (s === 'failed_login') label = 'Bad Login';
  else if (s === 'failed_gps') label = 'GPS Error';

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
