// src/pages/dashboard/checkin-scan.js — staff/trainer camera scan
import { staffCheckin } from '../../lib/checkin.js';
import { startScanner } from '../../lib/qr.js';
import { showToast } from '../../components/toast.js';
import { escHtml } from './helpers.js';

let _stopScanner = null;
let _busy = false;

export function renderCheckinScan(container) {
  window.__sculptRegisterCleanup?.(stopCheckinScan);

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
