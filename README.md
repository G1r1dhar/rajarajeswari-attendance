# Rajarajeswari Attendance — React PWA

Mobile-first React application for owner and staff attendance, backed by the Express + SQLite API.

## Requirements
- Node.js 20+
- HTTPS hosting for camera and GPS access on Android phones (localhost works for local development)

## Install
```bash
npm install
cp .env.example .env
```

Edit `.env` before starting. Set a private 4–8 digit `OWNER_PIN`, a random `SESSION_SECRET` and `QR_SIGNING_SECRET` (each secret at least 32 characters), and the shop's exact `SHOP_LAT` / `SHOP_LNG`. Keep `.env` private and never commit it.

Generate strong secrets, for example:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Run the command twice and use separate values for the two secrets.

## Development
Terminal 1 — API:
```bash
npm start
```
Terminal 2 — React:
```bash
npm run dev
```
Open the Vite URL shown in the terminal. The Vite dev server proxies `/api` requests to `http://localhost:3000`.

## Production
```bash
npm run build
npm start
```
The Express server serves the compiled React app from `dist`. Put it behind HTTPS (for example, a properly configured reverse proxy or secure hosting provider) before using camera/GPS on mobile phones.

## First-time setup
1. Sign in using the owner PIN configured in `.env`.
2. Add each staff member with a unique Staff ID and temporary PIN.
3. The staff member signs in on their own phone. The first login registers the phone as pending approval.
4. Owner opens **Devices** and approves that phone.
5. Owner opens **Shop QR** on the shop tablet. It refreshes with a short-lived signed QR challenge.
6. Staff selects an attendance action and scans the live QR from the shop, allowing camera and precise location access.

## Included
- React + Vite mobile-first PWA interface
- Owner dashboard, live status board, staff directory, device approvals and audit logs
- Server-generated rotating signed QR challenges
- Staff login with per-browser device key registration
- GPS geofence enforcement on the server
- Clock in, lunch start/return toggle, clock out and CSV export

## Security and operational limitations
- Browser device keys are a practical device-registration control, not hardware-backed device attestation. Clearing browser data or changing browsers may require owner re-approval.
- GPS can be spoofed on compromised devices; geofencing is a deterrent, not proof of physical presence. For higher assurance, use managed-device controls or a staffed kiosk as a second factor.
- The shop's coordinates must be configured before attendance works. Do not deploy with placeholder coordinates or default secrets.
- The owner PIN is configured through the server environment. Keep the app behind HTTPS, use a strong unique session secret, back up the SQLite database, and restrict server access.
- This is an MVP foundation, not a security certification. Test attendance rules, backups, clock/time-zone handling, and recovery procedures before relying on it for payroll.
