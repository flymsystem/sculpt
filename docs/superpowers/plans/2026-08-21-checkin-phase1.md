# QR Check-in — Phase 1 Implementation Plan (Desk Display + Staff Check-in)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** A tablet at the front desk shows a QR code that rotates every 30
seconds; a staff or trainer account can open the app, scan it with the
in-app camera, and get checked in/out in `staff_attendance` — no member
accounts, no member login, nothing else changes.

**Architecture:** Two new Postgres functions (`sculpt_issue_checkin_token`,
`sculpt_staff_checkin`) plus one new table (`checkin_tokens`), both callable
only by an authenticated owner/staff session via existing
`get_my_gym_id_as_staff()` / `is_gym_owner()` helpers. Two new dashboard
pages: a full-screen kiosk display and a camera scan screen, both lazy
routes off `sidebar.js`/`index.js` under the existing `attendance`
permission key (already `'full'` for both roles). QR encode/decode are
dynamic imports in a new `vendor-qr` chunk, mirroring the `vendor-pdf`
pattern.

**Tech Stack:** Existing stack only, plus two new npm dependencies:
`qrcode` (encode, ~15 kB) and `jsqr` (decode fallback for iOS, ~45 kB).
`BarcodeDetector` (native, Android/Chrome) is tried first; `jsqr` is the
fallback. Both load only inside the two new pages, never in the initial
bundle.

**Spec:** `docs/superpowers/specs/2026-08-21-checkin-portal-design.md`
(delta spec) + `CHECKIN-PLAN.md` (base architecture, §§2, 3.103/105/106,
6, 7, 9) + the task brief in this conversation.

## Global Constraints

- Every migration idempotent, numbered from 103, never edit an applied one (`supabase/migrations/README.md`).
- The check-in function **returns** a status, never raises (`CHECKIN-PLAN.md` §3.106).
- All dates/times computed in the gym's timezone via `now() AT TIME ZONE g.timezone`, never client-side UTC.
- `escHtml()` on every user-typed string reaching the DOM.
- `.is-open` classes, never `hidden`, on anything styled with `display:`.
- No static import widening into `landing.js`, `login.js`, or the PDF engine — `qrcode`/`jsqr` are dynamic imports only, guarded by a test mirroring `tests/build-integrity.spec.js`'s PDF-engine check.
- `vite.config.js` keeps `base: '/'`.
- All colour from `src/styles/tokens.css`.
- Windows/PowerShell: no `&&`, no `$(...)` — use the Bash tool for POSIX chains.

---

### Task 1: Migration 103 — gym timezone

**Files:**
- Create: `supabase/migrations/103_gym_timezone.sql`

**Interfaces:**
- Produces: `gyms.timezone` (text, default `'Asia/Kolkata'`), read by
  Tasks 3 and 4's SQL functions as `g.timezone`.

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────
-- 103_gym_timezone.sql
--
-- The server runs UTC; the gym runs IST (UTC+5:30). Every check-in
-- timestamp this feature writes must be converted through this column,
-- never left as CURRENT_DATE / now()::date, or a 6am IST check-in
-- lands on the previous day's row. See CLAUDE.md "timezone rule".
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

COMMENT ON COLUMN gyms.timezone IS
  'IANA timezone name. All check-in dates/times are computed as '
  '(now() AT TIME ZONE gyms.timezone), never CURRENT_DATE or client UTC.';
```

- [ ] **Step 2: Apply it against the Supabase project and confirm**

Run in the Supabase SQL editor (or note it for the user to run — see
Task 12). Verify with:

```sql
SELECT gym_code, timezone FROM gyms;
```

Expected: existing row(s) show `Asia/Kolkata`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/103_gym_timezone.sql
git commit -m "feat(checkin): add gym timezone column"
```

---

### Task 2: Migration 105 — rotating check-in tokens

**Files:**
- Create: `supabase/migrations/105_checkin_tokens.sql`

**Interfaces:**
- Produces: table `checkin_tokens(id, gym_id, token, issued_at, expires_at, created_by)`;
  function `sculpt_issue_checkin_token()` returning
  `TABLE(token text, expires_at timestamptz)`. Consumed by
  `src/lib/checkin.js` (Task 4) via `supabase.rpc('sculpt_issue_checkin_token')`.

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────
-- 105_checkin_tokens.sql
--
-- The desk QR is not static: the display asks for a fresh token every
-- 30s and re-renders. Each token is valid 90s so the current and
-- previous codes overlap and a slow scan never fails. A photograph of
-- the screen is dead within 90 seconds — that's the whole
-- anti-spoofing mechanism (CHECKIN-PLAN.md §2).
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS checkin_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id     uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_checkin_tokens_token ON checkin_tokens (token);
CREATE INDEX IF NOT EXISTS idx_checkin_tokens_gym_expiry ON checkin_tokens (gym_id, expires_at DESC);

ALTER TABLE checkin_tokens ENABLE ROW LEVEL SECURITY;

-- No direct table access from the client at all — issuing and
-- validating tokens both go through SECURITY DEFINER functions. A
-- narrow owner/staff SELECT policy would still let a compromised
-- staff session enumerate every token including ones from the last
-- 90 seconds, which is the exact thing the rotation defends against.
DROP POLICY IF EXISTS "no_direct_access_checkin_tokens" ON checkin_tokens;
CREATE POLICY "no_direct_access_checkin_tokens" ON checkin_tokens
  FOR ALL USING (false);

-- ── Issue a fresh token ─────────────────────────────────────────
-- Owner or staff only (the desk tablet is signed in as a staff
-- account per CHECKIN-PLAN.md §1). Deletes this gym's tokens older
-- than 5 minutes on the way through, so the table self-cleans and
-- never needs a cron job.
CREATE OR REPLACE FUNCTION sculpt_issue_checkin_token()
RETURNS TABLE (token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gym_id uuid;
  v_token text;
  v_expires timestamptz;
BEGIN
  v_gym_id := COALESCE(get_my_gym_id_as_staff(), (
    SELECT gym_id FROM gym_users WHERE user_id = auth.uid() AND role = 'owner' LIMIT 1
  ));

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  DELETE FROM checkin_tokens
  WHERE gym_id = v_gym_id AND expires_at < now() - interval '5 minutes';

  v_token := encode(gen_random_bytes(16), 'hex');
  v_expires := now() + interval '90 seconds';

  INSERT INTO checkin_tokens (gym_id, token, expires_at, created_by)
  VALUES (v_gym_id, v_token, v_expires, auth.uid());

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;

COMMENT ON FUNCTION sculpt_issue_checkin_token() IS
  'Owner/staff only. Issues a 90s-lived rotating check-in token for the '
  'caller''s gym. Raising here (auth failure) is fine — nothing has been '
  'written yet, unlike sculpt_staff_checkin which must never raise.';

REVOKE ALL ON FUNCTION sculpt_issue_checkin_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_issue_checkin_token() TO authenticated;
```

- [ ] **Step 2: Apply and smoke-test in the SQL editor**

```sql
-- as an authenticated owner/staff session (via Supabase dashboard this
-- runs as postgres, so this just checks the function compiles/exists):
SELECT proname FROM pg_proc WHERE proname = 'sculpt_issue_checkin_token';
```

Expected: one row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/105_checkin_tokens.sql
git commit -m "feat(checkin): add rotating token table and issuer function"
```

---

### Task 3: Migration 106 — staff/trainer check-in function

**Files:**
- Create: `supabase/migrations/106_staff_checkin.sql`

**Interfaces:**
- Consumes: `checkin_tokens` (Task 2), `staff.user_id`/`staff.is_active`
  (existing, migration 030), `staff_attendance` (existing,
  `UNIQUE(staff_id, date)`).
- Produces: function `sculpt_staff_checkin(p_token text)` returning
  `TABLE(status text, message text)`. Consumed by `src/lib/checkin.js`
  (Task 4).

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────
-- 106_staff_checkin.sql
--
-- Staff/trainer scan of the desk QR upserts today's staff_attendance
-- row: first scan of the day sets check_in, a second scan at least
-- 10 minutes later sets check_out, anything in between is a no-op.
-- This turns staff attendance from manual entry into a side-effect of
-- walking in the door.
--
-- MUST RETURN, NEVER RAISE for an invalid/expired token or a
-- not-a-staff-member caller: a RAISE rolls back inside a transaction
-- and (for the member function landing in migration 107) would
-- destroy the denied-attempt record it was supposed to leave behind.
-- Kept consistent here even though staff check-in writes no "denied"
-- row today, so the two functions read the same way.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sculpt_staff_checkin(p_token text)
RETURNS TABLE (status text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id uuid;
  v_gym_id uuid;
  v_token_gym_id uuid;
  v_tz text;
  v_local_date date;
  v_local_time time;
  v_row staff_attendance%ROWTYPE;
BEGIN
  SELECT id, gym_id INTO v_staff_id, v_gym_id
  FROM staff
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_STAFF', 'This account is not an active staff member.';
    RETURN;
  END IF;

  SELECT gym_id INTO v_token_gym_id
  FROM checkin_tokens
  WHERE token = p_token AND expires_at > now();

  IF v_token_gym_id IS NULL THEN
    RETURN QUERY SELECT 'INVALID_TOKEN', 'This code has expired. Ask the desk to refresh it.';
    RETURN;
  END IF;

  IF v_token_gym_id <> v_gym_id THEN
    RETURN QUERY SELECT 'INVALID_TOKEN', 'This code belongs to a different gym.';
    RETURN;
  END IF;

  SELECT timezone INTO v_tz FROM gyms WHERE id = v_gym_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_local_date := (now() AT TIME ZONE v_tz)::date;
  v_local_time := (now() AT TIME ZONE v_tz)::time;

  SELECT * INTO v_row
  FROM staff_attendance
  WHERE staff_id = v_staff_id AND date = v_local_date
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO staff_attendance (gym_id, staff_id, date, status, check_in)
    VALUES (v_gym_id, v_staff_id, v_local_date, 'Present', v_local_time);
    RETURN QUERY SELECT 'CHECKED_IN', 'Checked in.';
    RETURN;
  END IF;

  IF v_row.check_out IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_DONE', 'Already checked in and out today.';
    RETURN;
  END IF;

  IF v_row.check_in IS NOT NULL
     AND (v_local_time - v_row.check_in) < interval '10 minutes' THEN
    RETURN QUERY SELECT 'TOO_SOON', 'Already checked in a moment ago.';
    RETURN;
  END IF;

  UPDATE staff_attendance
  SET check_out = v_local_time
  WHERE id = v_row.id;
  RETURN QUERY SELECT 'CHECKED_OUT', 'Checked out.';
END;
$$;

COMMENT ON FUNCTION sculpt_staff_checkin(text) IS
  'Staff/trainer scan of the desk QR. Resolves auth.uid() via staff.user_id, '
  'validates the token, and upserts today''s staff_attendance row by hand '
  '(FOR UPDATE, not ON CONFLICT) so the 10-minute too-soon check can read '
  'the existing row first. Always returns a status; never raises for a '
  'business-logic rejection.';

REVOKE ALL ON FUNCTION sculpt_staff_checkin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_staff_checkin(text) TO authenticated;
```

- [ ] **Step 2: Apply and smoke-test**

```sql
SELECT proname FROM pg_proc WHERE proname = 'sculpt_staff_checkin';
```

Expected: one row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/106_staff_checkin.sql
git commit -m "feat(checkin): add staff/trainer check-in function"
```

---

### Task 4: `src/lib/checkin.js` — RPC wrappers

**Files:**
- Create: `src/lib/checkin.js`

**Interfaces:**
- Consumes: `supabase` from `./supabase.js` (existing client, same
  pattern as every other `lib/*.js` file).
- Produces: `issueCheckinToken(): Promise<{token, expiresAt}>`,
  `staffCheckin(token): Promise<{status, message}>`, plus a
  `window.__sculptCheckin` side-effect (see code) consumed only by
  `tests/checkin.spec.js` (Task 11). Consumed by Task 7
  (`checkin-display.js`) and Task 8 (`checkin-scan.js`).

- [ ] **Step 1: Write the module**

```js
// src/lib/checkin.js — rotating QR tokens + check-in RPC wrappers
import { supabase } from './supabase.js';

export async function issueCheckinToken() {
  const { data, error } = await supabase.rpc('sculpt_issue_checkin_token');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No token returned.');
  return { token: row.token, expiresAt: row.expires_at };
}

export async function staffCheckin(token) {
  const { data, error } = await supabase.rpc('sculpt_staff_checkin', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No response from check-in.');
  return { status: row.status, message: row.message };
}

// Exposed on window so Playwright can drive these RPCs against the BUILT
// preview server (hashed filenames mean tests/*.spec.js can't `import()` a
// /src/... path there — see tests/checkin.spec.js). Same convention as the
// existing window._navTo / window.__sculptSession globals in app.js. Only
// populated once this module has actually been loaded (i.e. a check-in page
// was opened), not on every page.
if (typeof window !== 'undefined') {
  window.__sculptCheckin = { issueCheckinToken, staffCheckin };
}
```

- [ ] **Step 2: Manual verification**

No test file yet (covered end-to-end by Task 11's Playwright specs).
Confirm the module has no syntax errors:

```bash
node --check src/lib/checkin.js
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/lib/checkin.js
git commit -m "feat(checkin): add RPC wrapper module"
```

---

### Task 5: Add `qrcode` and `jsqr`, wire the `vendor-qr` chunk

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js:39-51`

**Interfaces:**
- Produces: `qrcode` and `jsqr` importable via dynamic `import()` only.
  Consumed by Task 7 (`src/lib/qr.js`).

- [ ] **Step 1: Install the dependencies**

```bash
npm install qrcode jsqr
```

- [ ] **Step 2: Add the `vendor-qr` manualChunk**

In `vite.config.js`, inside the existing `manualChunks(id)` function,
add a branch before the final `return 'vendor'`:

```js
          // QR encode (desk display) and decode (staff/member scan) are
          // both dynamic imports off lib/qr.js — see the guard test in
          // tests/build-integrity.spec.js. Kept out of 'vendor' so a
          // routine deploy doesn't force everyone to re-download them.
          if (id.includes('qrcode') || id.includes('jsqr')) {
            return 'vendor-qr';
          }
```

- [ ] **Step 3: Verify the build still succeeds**

```bash
npm run build
```

Expected: succeeds, and `dist/assets/` contains no `vendor-qr` chunk
yet (nothing imports the packages until Task 7).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json vite.config.js
git commit -m "build: add qrcode/jsqr as a dynamically-imported vendor-qr chunk"
```

---

### Task 6: `src/lib/qr.js` — lazy encode + decode

**Files:**
- Create: `src/lib/qr.js`

**Interfaces:**
- Consumes: `qrcode` (dynamic import), `jsqr` (dynamic import), native
  `BarcodeDetector` (feature-detected).
- Produces: `generateQR(text): Promise<string>` (data URL, for an
  `<img>`), `startScanner(videoEl, onDecode, onError): Promise<() => void>`
  (returns a stop function). Consumed by Task 7 (`checkin-display.js`)
  and Task 9 (`checkin-scan.js`).

- [ ] **Step 1: Write the module**

```js
// src/lib/qr.js — QR encode/decode, loaded on demand only.
//
// Never statically imported. `qrcode` and `jsqr` together are small
// (~60 kB) but every visitor to the landing page or login screen pays
// for whatever this file pulls in at module-load time if it's ever
// imported outside the two check-in pages that need it — see the
// guard test in tests/build-integrity.spec.js and the vendor-qr
// chunk in vite.config.js.

export async function generateQR(text) {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(text, { margin: 1, width: 480, errorCorrectionLevel: 'M' });
}

// Safari has no BarcodeDetector (as of this writing). Chrome/Android
// does, and it decodes off the GPU — much faster than jsQR's JS-only
// scan loop — so it's tried first and jsQR is the universal fallback.
async function hasNativeDetector() {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch (_) {
    return false;
  }
}

/**
 * Starts the camera on `videoEl` and calls `onDecode(text)` once per
 * successful frame decode. Returns a stop() function that must be
 * called on page teardown — it stops both the scan loop and the
 * camera stream.
 */
export async function startScanner(videoEl, onDecode, onError) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    onError?.(err);
    return () => {};
  }
  videoEl.srcObject = stream;
  await videoEl.play();

  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
  };

  const nativeOk = await hasNativeDetector();

  if (nativeOk) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const loop = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(videoEl);
        if (codes.length) onDecode(codes[0].rawValue);
      } catch (_) { /* transient decode failure — keep scanning */ }
      if (!stopped) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return stop;
  }

  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const loop = () => {
    if (stopped) return;
    if (videoEl.videoWidth) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(frame.data, frame.width, frame.height);
      if (result?.data) onDecode(result.data);
    }
    if (!stopped) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return stop;
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check src/lib/qr.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/qr.js
git commit -m "feat(checkin): add lazy QR encode/decode module"
```

---

### Task 7: `src/pages/dashboard/checkin-display.js` — desk kiosk screen

**Files:**
- Create: `src/pages/dashboard/checkin-display.js`

**Interfaces:**
- Consumes: `issueCheckinToken` (Task 4), `generateQR` (Task 6),
  `S` from `./state.js` (for `S.gym.gym_code`, `S.gym.name`,
  `S.gym.logo_url`).
- Produces: `renderCheckinDisplay(container)`. Wired into `index.js` /
  `sidebar.js` in Task 9.

- [ ] **Step 1: Write the page**

Full-screen, high-contrast, built to be read from two metres away.
Payload format is `SCULPT1:<gym_code>:<token>` per `CHECKIN-PLAN.md`
§2 — deliberately not a URL, so a phone's native camera app shows an
unhelpful string instead of an open-able link.

```js
// src/pages/dashboard/checkin-display.js — desk kiosk QR screen
import { S } from './state.js';
import { issueCheckinToken } from '../../lib/checkin.js';
import { generateQR } from '../../lib/qr.js';
import { escHtml } from './helpers.js';

let _rotateTimer = null;
let _wakeLock = null;

export function renderCheckinDisplay(container) {
  container.innerHTML = `
    <div id="checkin-kiosk" style="position:fixed;inset:0;z-index:500;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;">
      <button id="checkin-exit" aria-label="Exit display" style="position:absolute;top:18px;right:18px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:10px;padding:10px 16px;font-size:14px;cursor:pointer;">Exit</button>
      <img src="/logo-128.png" alt="" width="64" height="64" style="opacity:0.9;">
      <div id="checkin-gym-name" style="color:#fff;font-family:var(--font-head, sans-serif);font-size:22px;letter-spacing:0.04em;text-transform:uppercase;">${escHtml(S.gym?.name || '')}</div>
      <div id="checkin-qr-wrap" style="background:#fff;border-radius:24px;padding:28px;box-shadow:0 0 60px rgba(42,143,255,0.25);">
        <img id="checkin-qr-img" width="420" height="420" style="display:block;width:min(420px,70vw);height:auto;" alt="Scan to check in">
      </div>
      <div style="color:#8fa0b8;font-size:15px;">Scan with the app to check in</div>
      <div id="checkin-offline" style="display:none;color:#ff6b6b;font-size:15px;font-weight:600;">
        ⚠️ Offline — code has stopped refreshing. Ask staff to check in manually.
      </div>
    </div>`;

  document.getElementById('checkin-exit').addEventListener('click', () => {
    stopCheckinDisplay();
    window._navTo?.('overview');
  });

  startRotation();
  acquireWakeLock();
  document.addEventListener('visibilitychange', reacquireWakeLockOnVisible);
}

async function refreshCode() {
  const wrap = document.getElementById('checkin-qr-wrap');
  const offline = document.getElementById('checkin-offline');
  const img = document.getElementById('checkin-qr-img');
  if (!wrap || !img) return; // page navigated away mid-flight

  try {
    const { token } = await issueCheckinToken();
    const payload = `SCULPT1:${S.gym?.gym_code || ''}:${token}`;
    img.src = await generateQR(payload);
    if (offline) offline.style.display = 'none';
    wrap.style.opacity = '1';
  } catch (err) {
    console.error('[Sculpt] check-in token refresh failed:', err.message);
    if (offline) offline.style.display = 'block';
    wrap.style.opacity = '0.4';
  }
}

function startRotation() {
  refreshCode();
  _rotateTimer = setInterval(refreshCode, 30_000);
}

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) _wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) { /* not fatal — screen may just dim on some devices */ }
}

function reacquireWakeLockOnVisible() {
  if (document.visibilityState === 'visible' && document.getElementById('checkin-kiosk')) {
    acquireWakeLock();
  }
}

export function stopCheckinDisplay() {
  if (_rotateTimer) clearInterval(_rotateTimer);
  _rotateTimer = null;
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
  document.removeEventListener('visibilitychange', reacquireWakeLockOnVisible);
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check src/pages/dashboard/checkin-display.js
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/checkin-display.js
git commit -m "feat(checkin): add desk kiosk QR display page"
```

---

### Task 8: `src/pages/dashboard/checkin-scan.js` — staff scan screen

**Files:**
- Create: `src/pages/dashboard/checkin-scan.js`

**Interfaces:**
- Consumes: `staffCheckin` (Task 4), `startScanner` (Task 6).
- Produces: `renderCheckinScan(container)`, `stopCheckinScan()`. Wired
  into `index.js` / `sidebar.js` in Task 9.

- [ ] **Step 1: Write the page**

Payload validation happens client-side first (cheap, avoids a wasted
round trip for a QR code that obviously isn't ours) and again
server-side inside `sculpt_staff_checkin` (the only validation that
actually matters for security).

```js
// src/pages/dashboard/checkin-scan.js — staff/trainer camera scan
import { staffCheckin } from '../../lib/checkin.js';
import { startScanner } from '../../lib/qr.js';
import { showToast } from '../../components/toast.js';
import { escHtml } from './helpers.js';

let _stopScanner = null;
let _busy = false;

export function renderCheckinScan(container) {
  container.innerHTML = `
    <div class="content-inner page-enter" style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:16px;">
      <div style="font-size:15px;font-weight:600;color:var(--text-primary);">Scan the desk QR code</div>
      <div style="position:relative;width:100%;max-width:420px;aspect-ratio:1;border-radius:16px;overflow:hidden;background:#000;">
        <video id="checkin-scan-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
        <div id="checkin-scan-status" style="position:absolute;inset:auto 0 0 0;padding:12px;text-align:center;background:rgba(0,0,0,0.55);color:#fff;font-size:13px;"></div>
      </div>
      <div id="checkin-scan-result" style="min-height:24px;font-size:14px;font-weight:600;"></div>
    </div>`;

  const video = document.getElementById('checkin-scan-video');
  const status = document.getElementById('checkin-scan-status');

  startScanner(
    video,
    (raw) => handleDecode(raw, status),
    (err) => {
      status.textContent = 'Camera unavailable: ' + (err?.message || 'permission denied.');
    }
  ).then((stop) => { _stopScanner = stop; });

  status.textContent = 'Point the camera at the desk screen.';
}

async function handleDecode(raw, statusEl) {
  if (_busy) return;
  const m = /^SCULPT1:([^:]+):([0-9a-f]{32})$/.exec(String(raw || ''));
  if (!m) {
    statusEl.textContent = 'Not a check-in code.';
    return;
  }

  _busy = true;
  statusEl.textContent = 'Checking in…';
  try {
    const { status, message } = await staffCheckin(m[2]);
    const resultEl = document.getElementById('checkin-scan-result');
    const ok = status === 'CHECKED_IN' || status === 'CHECKED_OUT';
    if (resultEl) {
      resultEl.style.color = ok ? 'var(--green, #2ecc71)' : 'var(--red, #e74c3c)';
      resultEl.textContent = escHtml(message);
    }
    showToast(message, ok ? 'green' : 'amber');
    if (ok) { stopCheckinScan(); return; } // done — no point scanning again
  } catch (err) {
    showToast(err.message || 'Check-in failed', 'red');
  } finally {
    _busy = false;
  }
}

export function stopCheckinScan() {
  if (_stopScanner) { _stopScanner(); _stopScanner = null; }
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check src/pages/dashboard/checkin-scan.js
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/checkin-scan.js
git commit -m "feat(checkin): add staff camera scan page"
```

---

### Task 9: Wire both pages into the dashboard router + sidebar

**Files:**
- Modify: `src/pages/dashboard/index.js`
- Modify: `src/pages/dashboard/sidebar.js`

**Interfaces:**
- Consumes: `renderCheckinDisplay`/`stopCheckinDisplay` (Task 7),
  `renderCheckinScan`/`stopCheckinScan` (Task 8), `hasAccess` (existing,
  `permissions.js`, key `attendance`, already `'full'` for owner+staff
  — no permissions.js change needed).
- Produces: two new section ids, `'checkin-display'` and
  `'checkin-scan'`, reachable from the sidebar and `VALID_SECTIONS`.

- [ ] **Step 1: Add the two section ids to `VALID_SECTIONS` in `index.js`**

```js
const VALID_SECTIONS = new Set([
  'overview','members','enquiries','alerts','staff',
  'finance','expenses','plans','plans-showcase','gymconfig',
  'backup','analytics','checkin-display','checkin-scan'
]);
```

- [ ] **Step 2: Import the two pages and wire the render map in `index.js`**

Add to the top-of-file imports (near the other section-renderer
imports, line ~26):

```js
import { renderCheckinDisplay, stopCheckinDisplay } from './checkin-display.js';
import { renderCheckinScan, stopCheckinScan } from './checkin-scan.js';
```

Add `'checkin-display':'Desk Display', 'checkin-scan':'Check In'` to
the `titles` object in `nav()` (line ~264), add both to the render map
(line ~299):

```js
  ({ overview:renderOverview, members:renderMembers, enquiries:renderEnquiries, alerts:renderMemberAlerts,
     staff:renderStaff, finance:renderFinance, expenses:renderExpenses, plans:renderPlans,
     'plans-showcase':renderPlansShowcase, gymconfig:renderGymConfig,
     backup:renderBackup,
     analytics:renderAnalytics,
     'checkin-display':renderCheckinDisplay,
     'checkin-scan':renderCheckinScan }[id] || renderOverview)(c);
```

Both pages install timers/camera streams that must not survive a
section switch. Add teardown at the top of `nav()`, right after
`S.section = id;` (line ~254):

```js
  // Both check-in pages hold a resource (rotation timer / camera
  // stream) that must die the instant the user navigates away, or the
  // camera stays on / the token keeps rotating in the background.
  if (S.section !== 'checkin-display') stopCheckinDisplay();
  if (S.section !== 'checkin-scan') stopCheckinScan();
```

(Note: `S.section = id` has already run above this point, so the
comparison is against the *new* section — this stops whichever one is
NOT the page being navigated to, including the case where the user
navigates away from the dashboard entirely via `router.go()`. Also
call both stop functions from `window.__sculptRegisterCleanup` inside
each page's own render function for the router-level teardown path —
add this one line at the top of `renderCheckinDisplay` and
`renderCheckinScan` in Tasks 7/8 respectively:
`window.__sculptRegisterCleanup?.(stopCheckinDisplay);` and the scan
equivalent.)

- [ ] **Step 3: Add sidebar entries in `sidebar.js`**

Add both to `isNavVisible`'s `permMap` (line ~64):

```js
    'checkin-display': 'attendance',
    'checkin-scan':    'attendance',
```

Add a new nav section after "Operations" (after line ~153):

```js
  // Check-in section
  const checkinVisible = ['checkin-scan','checkin-display'].filter(isNavVisible);
  if (checkinVisible.length > 0) {
    navItems.push(`<div class="nav-section-label">Check-in</div>`);
    if (isNavVisible('checkin-scan'))    navItems.push(`<div class="nav-item" data-id="checkin-scan" role="button" tabindex="0">${navIco('check')}Check In</div>`);
    if (isNavVisible('checkin-display')) navItems.push(`<div class="nav-item" data-id="checkin-display" role="button" tabindex="0">${navIco('grid')}Desk Display</div>`);
  }
```

- [ ] **Step 4: Manual smoke test**

```bash
npm run build
npm run preview
```

Sign in as owner (or staff) in a browser, open Desk Display — a QR
should render and change every 30s. Open Check In on a second device
signed in as staff, grant camera permission, scan the first screen's
code, confirm a "Checked in." toast and that a new
`staff_attendance` row appeared for today.

- [ ] **Step 5: Commit**

```bash
git add src/pages/dashboard/index.js src/pages/dashboard/sidebar.js
git commit -m "feat(checkin): wire desk display and staff scan into dashboard nav"
```

---

### Task 10: Guard test — QR modules stay out of the initial bundle

**Files:**
- Modify: `tests/build-integrity.spec.js`

**Interfaces:**
- Consumes: nothing new — same Playwright pattern as the existing
  `vendor-pdf` test in this file (line ~85).

- [ ] **Step 1: Write the test**

Add to the end of `tests/build-integrity.spec.js`:

```js
test('the QR encode/decode chunk is NOT downloaded on a normal page load', async ({ page }) => {
  // vendor-qr holds qrcode + jsqr. It must only download on the desk
  // display or staff/member scan pages. If a future change statically
  // imports lib/qr.js from somewhere reached at boot, every visitor
  // pays for a camera-decoding library they'll likely never use.
  const loadedChunks = [];
  page.on('response', (res) => {
    if (res.url().endsWith('.js')) loadedChunks.push(res.url());
  });

  await page.goto('/login', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  const qrChunk = loadedChunks.find((u) => u.includes('vendor-qr'));
  expect(
    qrChunk,
    'vendor-qr loaded on a page with no QR encode/decode — something that ' +
    'should be a dynamic import() became a static import.'
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run it**

```bash
npx playwright test build-integrity
```

Expected: all tests pass, including the new one.

- [ ] **Step 3: Commit**

```bash
git add tests/build-integrity.spec.js
git commit -m "test: guard vendor-qr chunk against static import"
```

---

### Task 11: Playwright tests — token expiry, replay, and double check-in

These need `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` (staff or owner
credentials) per `HANDOVER.md` §4, and hit the live Supabase functions
directly via the already-initialised `supabase` client on the page —
the same approach `auth-flow.spec.js` uses for sign-in. Run with
`--workers=1` (rate-limit note in `HANDOVER.md` §4 applies here too).

**Files:**
- Create: `tests/checkin.spec.js`

**Interfaces:**
- Consumes: `sculpt_issue_checkin_token`, `sculpt_staff_checkin` (Tasks
  2, 3) via `page.evaluate` calling the app's own `supabase` client
  (exposed the same way `auth-flow.spec.js` accesses it — check that
  file's helper before writing this if the accessor name differs).

- [ ] **Step 1: Write the test file**

```js
// tests/checkin.spec.js — token lifecycle + staff check-in idempotency.
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (staff or owner login)
// and --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');

async function signIn(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  // lib/checkin.js is only imported by the two check-in pages, and it's
  // the module that exposes window.__sculptCheckin for tests to reach —
  // see the comment in lib/checkin.js. Navigate to one to load it.
  await page.evaluate(() => window._navTo('checkin-scan'));
  await page.waitForFunction(() => !!window.__sculptCheckin);
}

test('a token issued now is accepted by staff check-in', async ({ page }) => {
  await signIn(page);
  const result = await page.evaluate(async () => {
    const { token } = await window.__sculptCheckin.issueCheckinToken();
    return window.__sculptCheckin.staffCheckin(token);
  });
  expect(['CHECKED_IN', 'CHECKED_OUT', 'TOO_SOON', 'ALREADY_DONE']).toContain(result.status);
});

test('an expired (90s+ old) token is rejected', async ({ page }) => {
  await signIn(page);
  const result = await page.evaluate(async () => {
    // A random hex string that was never issued behaves identically to
    // an expired one from the function's point of view (NOT FOUND in
    // checkin_tokens WHERE expires_at > now()), and doesn't require
    // the test to sleep 90 seconds.
    const fakeOldToken = Array.from({ length: 32 }, () => '0').join('');
    return window.__sculptCheckin.staffCheckin(fakeOldToken);
  });
  expect(result.status).toBe('INVALID_TOKEN');
});

test('two scans inside 10 minutes do not double-write', async ({ page }) => {
  await signIn(page);
  const results = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 2; i++) {
      const { token } = await window.__sculptCheckin.issueCheckinToken();
      out.push(await window.__sculptCheckin.staffCheckin(token));
    }
    return out;
  });
  // First call check-in (or already-done from a prior test run today);
  // the second, seconds later, must NOT be a second CHECKED_IN — it's
  // either TOO_SOON or ALREADY_DONE, never a fresh insert.
  expect(results[1].status).not.toBe('CHECKED_IN');
});
```

- [ ] **Step 2: Run it**

```bash
SCULPT_TEST_EMAIL=sculptfit@gmail.com SCULPT_TEST_PASSWORD=<password> npx playwright test checkin --workers=1
```

Expected: 3 pass (or 3 skipped if credentials are absent — acceptable
per `HANDOVER.md` §4's existing convention).

- [ ] **Step 3: Commit**

```bash
git add tests/checkin.spec.js
git commit -m "test: add check-in token lifecycle and idempotency coverage"
```

---

### Task 12: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `HANDOVER.md`
- Modify: `supabase/migrations/README.md`

**Interfaces:** none — doc-only.

- [ ] **Step 1: `supabase/migrations/README.md`**

Add a line noting `103`, `105`, `106` are new and unapplied, next to
the existing "Anything numbered 033 and above" note, and list them by
name so whoever runs them by hand knows the order.

- [ ] **Step 2: `HANDOVER.md` §6**

Add one bullet: the desk tablet offline behaviour (code stops
refreshing, kiosk shows a visible "Offline" banner rather than a stale
code — see `checkin-display.js`), and that
`sculpt_staff_checkin`/(future member equivalent) must always RETURN,
never RAISE, for the same reason as the money functions.

- [ ] **Step 3: `HANDOVER.md` §9**

Add `src/lib/checkin.js`, `src/lib/qr.js`,
`src/pages/dashboard/checkin-display.js`,
`src/pages/dashboard/checkin-scan.js` to the file map.

- [ ] **Step 4: `CLAUDE.md`**

Add the timezone rule (`now() AT TIME ZONE g.timezone`, never
`CURRENT_DATE`) and the return-not-raise rule to the "Conventions"
section, referencing `sculpt_staff_checkin` as the example — these are
written now so the member-checkin function in Phase 2 has something to
match rather than re-deriving the rule.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md HANDOVER.md supabase/migrations/README.md
git commit -m "docs: document phase 1 check-in additions"
```

---

## Phase 1 exit checklist

Run after Task 12, before reporting Phase 1 done:

```bash
npm run build
npx playwright test
npm run lint
node scripts/verify-schema.mjs
node scripts/qa-responsive.mjs
node scripts/qa-nav.mjs
```

Then hard-refresh `/dashboard/finance` against `npm run preview` (the
silent base-path failure mode `HANDOVER.md` §6 warns about).

`npm run lint` must show the same 12 pre-existing errors and no more.
`verify-schema.mjs` will only pass once migrations 103/105/106 have
actually been run against the Supabase project by hand (see Task 12
Step 1) — note this clearly when reporting back, since it cannot be
automated from this environment.
