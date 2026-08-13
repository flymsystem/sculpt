import { S } from './state.js';
import { expiryDate, memberStatus, escHtml, av2 } from './helpers.js';
import { scard } from './overview.js';
import { openRenewModal, openInvoiceModal, openWAModal } from './member-modals.js';
import { openPhotoLightbox } from '../../components/photo-lightbox.js';

function renderMemberAlerts(c) {
  const reminderDays = S.gym?.reminder_days || 7;
  let alertFilter = 'all';

  function getAlertMembers() {
    return S.members.filter(m => {
      const st = memberStatus(m);
      return st === 'Expired' || st === 'Expiring' || st === 'Due';
    }).sort((a, b) => {
      const ea = expiryDate(a), eb = expiryDate(b);
      if (ea && eb) return ea - eb;
      if (ea) return -1;
      return 1;
    });
  }

  function filteredAlerts() {
    const all = getAlertMembers();
    if (alertFilter === 'all') return all;
    if (alertFilter === 'expired') return all.filter(m => memberStatus(m) === 'Expired');
    if (alertFilter === 'expiring') return all.filter(m => memberStatus(m) === 'Expiring');
    if (alertFilter === 'due') return all.filter(m => memberStatus(m) === 'Due');
    return all;
  }

  function render() {
    const allAlerts = getAlertMembers();
    const expired = allAlerts.filter(m => memberStatus(m) === 'Expired').length;
    const expiring = allAlerts.filter(m => memberStatus(m) === 'Expiring').length;
    const due = allAlerts.filter(m => memberStatus(m) === 'Due').length;
    const list = filteredAlerts();

    c.innerHTML = `<div class="content-inner page-enter">
      <div class="page-header"><div class="page-header-left">
        <div class="page-title">Member Alerts</div>
        <div class="page-sub">${allAlerts.length} member${allAlerts.length !== 1 ? 's' : ''} need attention</div>
      </div></div>

      <div class="grid-4" style="margin-bottom:24px;">
        ${scard('All Alerts', allAlerts.length, 'var(--brand)', '')}
        ${scard('Expired', expired, 'var(--red)', 'past expiry', 'txt-red')}
        ${scard('Expiring', expiring, 'var(--amber)', 'within ' + reminderDays + 'd', 'txt-amber')}
        ${scard('Payment Due', due, 'var(--purple)', 'unpaid')}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
        ${['all','expired','expiring','due'].map(f =>
          `<button class="alert-filter-pill" data-filter="${f}" style="padding:6px 14px;border-radius:var(--radius-pill);font-size:var(--text-sm);font-weight:500;border:1px solid ${alertFilter===f?'var(--brand)':'var(--border-default)'};background:${alertFilter===f?'var(--brand-fade)':'transparent'};color:${alertFilter===f?'var(--brand-text)':'var(--text-secondary)'};cursor:pointer;">${f==='all'?'All Alerts':f==='expired'?'Expired':f==='expiring'?'Expiring Soon':'Payment Due'}</button>`
        ).join('')}
      </div>

      <div id="alert-cards-container">
        ${list.length === 0
          ? `<div class="empty-state" style="padding:80px;text-align:center;"><div style="font-size:40px;margin-bottom:16px;">✅</div><div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">All clear!</div><div style="font-size:14px;color:var(--text-tertiary);">No alerts right now.</div></div>`
          : list.map(m => renderAlertCard(m)).join('')}
      </div>
    </div>`;

    document.querySelectorAll('.alert-filter-pill').forEach(pill => {
      pill.addEventListener('click', () => { alertFilter = pill.dataset.filter; render(); });
    });
    document.querySelectorAll('[data-photo]').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); openPhotoLightbox(el.dataset.photo); });
    });
  }

  function renderAlertCard(m) {
    const st = memberStatus(m);
    const exp = expiryDate(m);
    const mType = m.member_type || m.memberType || 'Paid';
    const isTrialMember = mType === 'Trial';

    let accentColor = 'var(--brand)', statusText = '', statusColor = '';
    if (st === 'Expired') {
      const daysAgo = exp ? Math.abs(Math.ceil((exp - new Date()) / 86400000)) : 0;
      accentColor = daysAgo > 14 ? 'var(--red)' : 'var(--amber)';
      statusText = `Expired ${daysAgo}d ago`; statusColor = accentColor;
    } else if (st === 'Expiring') {
      const dl = exp ? Math.ceil((exp - new Date()) / 86400000) : 0;
      accentColor = dl <= 3 ? 'var(--amber)' : 'var(--brand)';
      statusText = `Expiring in ${dl}d`; statusColor = accentColor;
    } else if (st === 'Due') {
      accentColor = 'var(--purple)'; statusText = 'Payment Due'; statusColor = 'var(--purple)';
    }
    const fmtExp = exp ? exp.toLocaleDateString('en-IN',{day:'numeric',month:'numeric',year:'numeric'}) : '—';
    const renewBtn = !isTrialMember ? `<button class="btn btn-sm" onclick="window._renew('${m.id}')" style="background:var(--brand-fade);color:var(--brand-text);border:1px solid var(--brand-fade-strong);padding:6px 10px;font-size:12px;white-space:nowrap;">Renew</button>` : '';
    const invoiceBtn = `<button class="btn btn-sm" onclick="window._inv('${m.id}')" style="background:var(--amber-fade);color:var(--amber);border:1px solid var(--amber-strong);padding:6px 10px;font-size:12px;white-space:nowrap;">Invoice</button>`;
    const remindBtn = `<button class="btn btn-sm" onclick="window._wa('${m.id}')" style="background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);padding:6px 10px;font-size:12px;white-space:nowrap;">Remind</button>`;

    return `<div style="background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);margin-bottom:10px;overflow:hidden;display:flex;border-left:3px solid ${accentColor};flex-wrap:wrap;">
      <div style="flex:1;padding:14px 18px;display:flex;align-items:center;gap:14px;min-width:200px;">
        ${m.photo_url
          ? `<div class="member-avatar" data-photo="${m.photo_url}" style="overflow:hidden;padding:0;cursor:zoom-in;"><img src="${m.photo_url}" style="width:100%;height:100%;object-fit:cover;"></div>`
          : `<div class="member-avatar">${av2(m.full_name||m.name)}</div>`}
        <div style="min-width:0;flex:1;">
          <div style="font-weight:600;font-size:14px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(m.full_name||m.name)}</div>
          <div style="font-size:12px;color:var(--text-tertiary);display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;">
            <span>${m.plan_name||m.plan||'—'}</span><span>·</span>
            <span style="color:${statusColor};font-weight:500;">${statusText}</span><span>·</span><span>${fmtExp}</span>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:14px 18px;flex-shrink:0;">${renewBtn} ${invoiceBtn} ${remindBtn}</div>
    </div>`;
  }

  window._renew = id => openRenewModal(id);
  window._inv   = id => openInvoiceModal(id);
  window._wa    = id => openWAModal(id);
  render();
}


export { renderMemberAlerts };
