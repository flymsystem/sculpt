// src/components/toast.js — v2 with icons + progress bar
let toastTimeout = null;
const ICONS = {
  green: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  red:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  amber: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  blue:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};
const COLORS = { green:'var(--green)', red:'var(--red)', blue:'var(--brand)', amber:'var(--amber)' };

export function showToast(message, type = 'blue', duration) {
  let toast = document.getElementById('flym-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'flym-toast';
    toast.className = 'toast';
    toast.innerHTML = '<div class="toast-icon" id="toast-icon"></div><span class="toast-msg" id="toast-msg"></span><div class="toast-progress" id="toast-progress"></div>';
    document.body.appendChild(toast);
  }
  const color = COLORS[type] || COLORS.blue;
  const icon = ICONS[type] || ICONS.blue;
  const iconEl = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  const progressEl = document.getElementById('toast-progress');
  if (iconEl) { iconEl.innerHTML = icon; iconEl.style.color = color; }
  if (msgEl) msgEl.textContent = message;
  const ms = duration || (type === 'red' ? 5500 : type === 'amber' ? 4500 : 3200);
  if (progressEl) {
    progressEl.style.background = color;
    progressEl.style.animation = 'none';
    void progressEl.offsetHeight;
    progressEl.style.animation = `progressBar ${ms}ms linear forwards`;
  }
  toast.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), ms);
}
