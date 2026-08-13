// src/pages/admin-dashboard.js  — v3  FULLY FIXED
// ─────────────────────────────────────────────────────────────────
// BUGS FIXED:
//  1. adminState not reset between logins — stale data
//  2. window.__adminDeact leaked between renders
//  3. Demo mode silently failed on onboard, lost the catch branch
//  4. gym_summary view columns mismatched what admin expected
//
// NEW FEATURES:
//  A. "Create Gym + Owner" wizard — single form that does
//     everything: creates gym record, generates credentials,
//     shows a ready-to-copy WhatsApp/email invite message.
//     No more jumping between 4 steps.
//  B. Credentials tab now shows a full shareable invite card
//     with a "Send via WhatsApp" button.
// ─────────────────────────────────────────────────────────────────

import { getAllGymsDetail, getGymStats, onboardGym, deactivateGym, reactivateGym, getGlobalActivity, getDueReminders, markReminderSent } from '../lib/admin.js';
import { showToast }   from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { showConfirm } from '../components/confirm.js';
import { signOut }     from '../lib/auth.js';
import { supabase }    from '../lib/supabase.js';

// Reset state fresh on every admin dashboard load
let A = { gyms:[], activity:[], reminders:[], section:'a-overview' };

// ── Bulk Entry persistent state (survives page refresh) ──
const BE_KEY = '__flymBulkEntry';
let B = { gymId:'', gymName:'', plans:[], entries:[], lastDate:'', lastPlanIdx:0, lastMode:'Cash' };
function todayStr() { return new Date().toISOString().split('T')[0]; }
function escH(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escSQL(s) { return s ? s.replace(/'/g, "''") : ''; }
function addMonthsBE(ds, m) { const d = new Date(ds+'T00:00:00'); d.setMonth(d.getMonth()+m); return d.toISOString().split('T')[0]; }
function fmtDateShort(ds) { if(!ds)return'—'; const[y,mo,d]=ds.split('-'); return `${d}/${mo}/${y}`; }
function loadBE() {
  try { const s=localStorage.getItem(BE_KEY); if(s){const d=JSON.parse(s); B={...B,...d};} } catch(e){}
  if(!B.lastDate) B.lastDate=todayStr();
}
function saveBE() {
  try { localStorage.setItem(BE_KEY,JSON.stringify(B)); } catch(e){}
}

export async function renderAdminDashboard(router) {
  const session = window.__flymSession;
  if (!session || session.role !== 'admin') { router.go('login'); return; }

  A = { gyms:[], activity:[], reminders:[], section:'a-overview' };

  document.getElementById('root').innerHTML = `
    <div id="page-admin" class="app-layout">
      <div id="admin-sidebar"></div>
      <div class="app-main">
        <div class="topbar">
          <button class="hamburger-btn" id="a-hamburger-btn" aria-label="Menu">
            <span></span><span></span><span></span>
          </button>
          <div class="topbar-title" id="a-topbar-title">Admin Overview</div>
          <div class="topbar-right">
            <div class="topbar-date" id="a-topbar-date"></div>
            <div class="topbar-avatar" style="background:var(--amber);color:#000;" title="Flym Admin">FA</div>
          </div>
        </div>
        <div class="sidebar-overlay" id="a-sidebar-overlay"></div>
        <div class="app-content" id="admin-content">
          <div class="loading-inline"><div class="spinner"></div></div>
        </div>
      </div>
    </div>`;

  ensureStyles();
  document.getElementById('admin-sidebar').innerHTML = buildSidebar();
  bindSidebar(router);
  document.getElementById('a-topbar-date').textContent = new Date().toLocaleDateString('en-IN',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  await loadData();
  aNAv('a-overview');
}

async function loadData() {
  try {
    const [gyms, activity] = await Promise.all([getAllGymsDetail(), getGlobalActivity(50)]);
    A.gyms     = gyms     || [];
    A.activity = activity || [];

    // Merge live member counts from gym_summary into gym objects
    try {
      const stats = await getGymStats();
      A.gyms = A.gyms.map(g => ({
        ...g,
        total_members: stats[g.id]?.total_members ?? g.total_members ?? 0,
        payment_due:   stats[g.id]?.payment_due   ?? g.payment_due   ?? 0,
      }));
    } catch (_) { /* stats merge is best-effort */ }

  } catch (e) {
    console.warn('[Flym Admin] Using demo data:', e.message);
    A.gyms     = demoGyms();
    A.activity = demoActivity();
  }
}

function aNAv(id) {
  A.section = id;
  const titles = {
    'a-overview':    'Admin Overview',
    'a-gyms':        'Gym Management',
    'a-credentials': 'Add Gym & Owner',
    'a-bulkentry':   'Bulk Member Entry',
    'a-reminders':   'WhatsApp Reminders',
    'a-activity':    'Activity Log',
    'a-gymdetail':   'Gym Details',
    'a-subscriptions': 'Subscriptions',
  };
  const el = document.getElementById('a-topbar-title');
  if (el) el.textContent = titles[id]||id;
  document.querySelectorAll('#admin-sidebar .nav-item').forEach(n=>n.classList.remove('active'));
  const active=document.querySelector(`#admin-sidebar .nav-item[data-id="${id}"]`);
  if(active)active.classList.add('active');
  const c=document.getElementById('admin-content');
  if(!c)return;
  ({ 'a-overview':renderOverview, 'a-gyms':renderGyms,
     'a-credentials':renderAddGymWizard, 'a-bulkentry':renderBulkEntry,
     'a-reminders':renderReminders, 'a-activity':renderActivity,
     'a-gymdetail':renderGymDetail, 'a-subscriptions':renderSubscriptions }[id]||renderOverview)(c);
}

// ════════════════════════════════════════════════════════════════
// OVERVIEW
// ════════════════════════════════════════════════════════════════
function renderOverview(c) {
  const total   = A.gyms.length;
  const active  = A.gyms.filter(g=>g.is_active!==false).length;
  const members = A.gyms.reduce((s,g)=>s+(g.total_members||0),0);
  const due     = A.gyms.reduce((s,g)=>s+(g.payment_due||0),0);

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="grid-4" style="margin-bottom:28px;">
      <div class="stat-card"><div class="stat-card-accent" style="background:var(--blue);"></div>
        <div class="stat-card-label">Total Gyms</div>
        <div class="stat-card-value">${total}</div>
        <div class="stat-card-sub">Onboarded clients</div></div>
      <div class="stat-card"><div class="stat-card-accent" style="background:var(--green);"></div>
        <div class="stat-card-label">Active Gyms</div>
        <div class="stat-card-value">${active}</div>
        <div class="stat-card-sub">${active===total?'All active':`${total-active} inactive`}</div></div>
      <div class="stat-card"><div class="stat-card-accent" style="background:var(--amber);"></div>
        <div class="stat-card-label">Total Members</div>
        <div class="stat-card-value">${members}</div>
        <div class="stat-card-sub">Across all gyms</div></div>
      <div class="stat-card"><div class="stat-card-accent" style="background:var(--red);"></div>
        <div class="stat-card-label">Payments Due</div>
        <div class="stat-card-value" style="color:${due>0?'var(--red)':'var(--white)'};">${due}</div>
        <div class="stat-card-sub">Across all gyms</div></div>
    </div>
    <div class="section-header">
      <div class="section-title">All Gyms</div>
      <button class="btn btn-primary btn-sm" id="btn-addgym-ov">+ Add Gym & Owner</button>
    </div>
    <div class="grid-3" id="admin-gym-grid">
      ${A.gyms.map(gymCard).join('')}
      ${!A.gyms.length?`<div class="empty-state" style="grid-column:1/-1;padding:60px;text-align:center;">
        <p>No gyms yet. Click "+ Add Gym &amp; Owner" to get started.</p></div>`:''}
    </div>
  </div>`;

  document.getElementById('btn-addgym-ov')?.addEventListener('click', ()=>aNAv('a-credentials'));
  window.__aDeact = deactGym;
}

function gymCard(g) {
  const on=g.is_active!==false;
  const autoRem = g.auto_reminders_enabled === true;
  return `<div class="card" style="border-left:3px solid ${on?'var(--blue)':'var(--border2)'};">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;">
      <div>
        <div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--white);">${escH(g.name)}</div>
        <div style="font-size:11px;color:var(--muted2);letter-spacing:0.08em;margin-top:2px;">${escH(g.gym_code||'')}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
        ${autoRem ? '<span class="badge badge-green" style="font-size:10px;" title="Auto-reminders enabled">📱 Reminders</span>' : ''}
        <span class="badge ${on?'badge-green':'badge-muted'}">${on?'Active':'Inactive'}</span>
      </div>
    </div>
    <div class="grid-2" style="gap:8px;margin-bottom:14px;">
      <div style="background:var(--bg2);border-radius:2px;padding:10px 12px;">
        <div style="font-family:var(--font-head);font-size:20px;font-weight:800;">${g.total_members||0}</div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-top:2px;">Members</div>
      </div>
      <div style="background:var(--bg2);border-radius:2px;padding:10px 12px;">
        <div style="font-family:var(--font-head);font-size:20px;font-weight:800;
          color:${(g.payment_due||0)>0?'var(--red)':'var(--white)'};">${g.payment_due||0}</div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-top:2px;">Dues</div>
      </div>
    </div>
    <div style="font-size:12px;color:var(--muted);padding-top:12px;border-top:1px solid var(--border);">
      Owner: <span style="color:var(--white);">${escH(g.owner_name)}</span> · ${escH(g.city||'—')}
    </div>
    <div class="action-btns" style="margin-top:12px;">
      <button class="btn btn-ghost btn-sm" onclick="window.__aDeact('${g.id}','${escAttr(g.name)}',${on})">
        ${on?'Deactivate':'Reactivate'}
      </button>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// GYMS TABLE
// ════════════════════════════════════════════════════════════════
function renderGyms(c) {
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="section-header">
      <div><div class="section-title">Gym Management</div>
           <div class="section-sub">All onboarded gym clients</div></div>
      <button class="btn btn-primary btn-sm" id="btn-addgym-tb">+ Add Gym & Owner</button>
    </div>
    <div style="margin-bottom:14px;">
      <input type="text" class="search-input" id="gym-search"
        placeholder="Search gym name, owner or city..."
        style="width:100%;max-width:400px;">
    </div>
    <div class="table-wrap" id="gym-table-wrap">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Gym</th><th>Code</th><th>Owner</th><th>City</th>
            <th>Members</th><th>Dues</th><th>Status</th><th>Onboarded</th><th>Actions</th></tr></thead>
          <tbody>
            ${A.gyms.map(g=>{
              const on=g.is_active!==false;
              return `<tr>
                <td style="font-weight:500;"><span style="color:var(--blue-light);cursor:pointer;text-decoration:underline;text-underline-offset:3px;" onclick="window.__aViewGym('${g.id}')">${escH(g.name)}</span></td>
                <td><code style="font-size:11px;color:var(--blue-light);">${escH(g.gym_code||'—')}</code></td>
                <td>${escH(g.owner_name)}</td>
                <td style="color:var(--muted);">${escH(g.city||'—')}</td>
                <td><strong>${g.total_members||0}</strong></td>
                <td style="color:${(g.payment_due||0)>0?'var(--red)':'var(--muted)'};">${g.payment_due||0}</td>
                <td><span class="badge ${on?'badge-green':'badge-muted'}">${on?'Active':'Inactive'}</span></td>
                <td style="font-size:12px;color:var(--muted);">${g.created_at?new Date(g.created_at).toLocaleDateString('en-IN'):'—'}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="window.__aDeact('${g.id}','${escAttr(g.name)}',${on})">
                  ${on?'Deactivate':'Reactivate'}</button></td>
              </tr>`;
            }).join('')}
            ${!A.gyms.length?`<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--muted);">
              No gyms yet.</td></tr>`:''}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;

  document.getElementById('btn-addgym-tb')?.addEventListener('click',()=>aNAv('a-credentials'));
  window.__aDeact   = deactGym;
  window.__aViewGym = (id) => { A.selectedGymId = id; aNAv('a-gymdetail'); };

  // Gym search filter
  document.getElementById('gym-search')?.addEventListener('input', function() {
    const q = this.value.toLowerCase().trim();
    document.querySelectorAll('#gym-table-wrap tbody tr').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = !q || text.includes(q) ? '' : 'none';
    });
  });
}

async function deactGym(id,name,isActive) {
  const ok = await showConfirm({
    title: `${isActive ? 'Deactivate' : 'Reactivate'} gym?`,
    message: isActive
      ? `${name} will lose access. Members and data stay intact.`
      : `${name} will regain full access.`,
    confirmLabel: isActive ? 'Deactivate' : 'Reactivate',
    confirmVariant: isActive ? 'danger' : 'primary',
  });
  if (!ok) return;
  try {
    if(isActive)await deactivateGym(id); else await reactivateGym(id);
    const g=A.gyms.find(x=>x.id===id); if(g)g.is_active=!isActive;
    aNAv(A.section); showToast(`${name} ${isActive?'deactivated':'reactivated'}`,isActive?'red':'green');
  } catch(err){showToast(err.message,'red');}
}

// ════════════════════════════════════════════════════════════════
// ADD GYM + OWNER WIZARD  — the BIG new feature
// ════════════════════════════════════════════════════════════════
function renderAddGymWizard(c) {
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="section-header">
      <div><div class="section-title">Add Gym & Owner</div>
           <div class="section-sub">Fill in details below — credentials are generated automatically</div></div>
    </div>

    <div class="grid-2" style="align-items:start;">

      <!-- FORM SIDE -->
      <div class="card">
        <div class="card-title" style="margin-bottom:20px;">Gym & Owner Details</div>

        <div class="form-row">
          <div class="form-group"><label class="form-label">Gym Name *</label>
            <input class="form-input" id="wz-gym" placeholder="e.g. PowerHouse Gym"></div>
          <div class="form-group"><label class="form-label">City *</label>
            <input class="form-input" id="wz-city" placeholder="e.g. Bengaluru"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Owner Name *</label>
            <input class="form-input" id="wz-owner" placeholder="e.g. Rajesh Kumar"></div>
          <div class="form-group"><label class="form-label">Owner Phone</label>
            <input class="form-input" id="wz-phone" placeholder="+91 98765 43210"></div>
        </div>
        <div class="form-group"><label class="form-label">Owner Email *</label>
          <input class="form-input" id="wz-email" type="email" placeholder="owner@gym.com">
          <div style="font-size:11px;color:var(--muted);margin-top:5px;">
            This will be their login email on Flym.
          </div>
        </div>
        <div class="form-group"><label class="form-label">Address</label>
          <input class="form-input" id="wz-addr" placeholder="Full gym address"></div>

        <div id="wz-error" style="display:none;color:var(--red);font-size:13px;
          background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);
          padding:10px;border-radius:2px;margin-bottom:14px;"></div>

        <button class="btn btn-primary btn-full" id="wz-submit" style="height:46px;">
          <span id="wz-btn-text">Generate Credentials & Add Gym →</span>
          <span id="wz-spinner" class="spinner" style="display:none;width:16px;height:16px;border-width:2px;"></span>
        </button>
      </div>

      <!-- RESULT SIDE -->
      <div>
        <!-- Result card — hidden until generated -->
        <div id="wz-result" style="display:none;">
          <div class="card" style="border:1px solid rgba(0,230,118,0.25);border-left:3px solid var(--green);margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
              <div style="width:36px;height:36px;border-radius:50%;background:rgba(0,230,118,0.15);
                display:flex;align-items:center;justify-content:center;font-size:18px;">✅</div>
              <div>
                <div style="font-family:var(--font-head);font-size:15px;font-weight:700;">Gym Added!</div>
                <div style="font-size:12px;color:var(--muted);">Credentials generated below</div>
              </div>
            </div>

            <div class="cred-row-item">
              <span class="cred-key">Login Email</span>
              <code class="cred-val" id="r-email">—</code>
              <button class="btn btn-ghost btn-sm" onclick="cpVal('r-email')">Copy</button>
            </div>
            <div class="cred-row-item">
              <span class="cred-key">Password</span>
              <code class="cred-val" id="r-pass">—</code>
              <button class="btn btn-ghost btn-sm" onclick="cpVal('r-pass')">Copy</button>
            </div>
            <div class="cred-row-item">
              <span class="cred-key">Gym Code</span>
              <code class="cred-val" id="r-code">—</code>
              <button class="btn btn-ghost btn-sm" onclick="cpVal('r-code')">Copy</button>
            </div>

            <div style="margin-top:16px;display:flex;gap:8px;">
              <button class="btn btn-ghost btn-sm" id="btn-copy-all">📋 Copy All</button>
              <button class="btn btn-sm" id="btn-wa-invite"
                style="background:rgba(0,230,118,0.15);color:var(--green);border:1px solid rgba(0,230,118,0.3);">
                📱 Send via WhatsApp
              </button>
            </div>
          </div>

          <!-- Next step instruction -->
          <div class="card" style="background:rgba(42,143,255,0.05);">
            <div class="card-title" style="margin-bottom:14px;">⚡ One Manual Step Required</div>
            <div style="font-size:13px;color:var(--muted);line-height:1.9;">
              The credentials above are generated but the Supabase user account must be
              created manually (security requirement — passwords are never sent to our server):
              <ol style="margin:12px 0 0 18px;color:var(--white);">
                <li>Go to your <strong>Supabase Dashboard</strong> → Authentication → Users → Add User</li>
                <li>Enter email: <code id="step-email" style="color:var(--blue-light);"></code></li>
                <li>Enter password: <code id="step-pass"  style="color:var(--blue-light);"></code></li>
                <li>Check "Auto Confirm User" → Create</li>
                <li>Copy the new User UID, then run this SQL:</li>
              </ol>
              <div style="margin-top:10px;background:var(--bg2);padding:10px 12px;border-radius:2px;
                font-family:monospace;font-size:11px;color:var(--green);overflow-x:auto;">
                <span id="step-sql">-- SQL will appear here after generating credentials</span>
              </div>
              <button class="btn btn-ghost btn-sm" style="margin-top:8px;" id="btn-copy-sql">Copy SQL</button>
            </div>
          </div>
        </div>

        <!-- Before generation — instructions -->
        <div id="wz-guide" class="card">
          <div class="card-title" style="margin-bottom:16px;">How This Works</div>
          <div style="font-size:13px;color:var(--muted);line-height:2.1;">
            <div style="padding:10px 14px;background:var(--bg2);border-radius:var(--radius-sm);
              border-left:3px solid var(--blue);margin-bottom:10px;">
              <strong style="color:var(--white);">1. Fill the form</strong><br>
              Enter the gym name, city, owner name and email.
            </div>
            <div style="padding:10px 14px;background:var(--bg2);border-radius:var(--radius-sm);
              border-left:3px solid var(--blue);margin-bottom:10px;">
              <strong style="color:var(--white);">2. Generate</strong><br>
              Flym creates the gym record and auto-generates a secure password.
            </div>
            <div style="padding:10px 14px;background:var(--bg2);border-radius:var(--radius-sm);
              border-left:3px solid var(--amber);margin-bottom:10px;">
              <strong style="color:var(--white);">3. One manual step</strong><br>
              Add the user in Supabase Auth Dashboard and run the provided SQL.
            </div>
            <div style="padding:10px 14px;background:var(--bg2);border-radius:var(--radius-sm);
              border-left:3px solid var(--green);">
              <strong style="color:var(--white);">4. Share</strong><br>
              Send the WhatsApp invite — the owner is ready to log in.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  window.cpVal = (id) => {
    navigator.clipboard.writeText(document.getElementById(id)?.textContent||'');
    showToast('Copied!','green');
  };

  document.getElementById('wz-submit').addEventListener('click', runWizard);
}

async function runWizard() {
  const gym   = document.getElementById('wz-gym')?.value.trim();
  const city  = document.getElementById('wz-city')?.value.trim();
  const owner = document.getElementById('wz-owner')?.value.trim();
  const email = document.getElementById('wz-email')?.value.trim();
  const phone = document.getElementById('wz-phone')?.value.trim();
  const addr  = document.getElementById('wz-addr')?.value.trim();
  const errEl = document.getElementById('wz-error');

  errEl.style.display='none';
  if (!gym)  { errEl.textContent='Gym name is required.';   errEl.style.display='block'; return; }
  if (!owner){ errEl.textContent='Owner name is required.'; errEl.style.display='block'; return; }
  if (!email){ errEl.textContent='Owner email is required.';errEl.style.display='block'; return; }

  // Loading state
  document.getElementById('wz-submit').disabled=true;
  document.getElementById('wz-btn-text').style.display='none';
  document.getElementById('wz-spinner').style.display='inline-block';

  let gymCode, gymId;
  try {
    const result = await onboardGym({ name:gym, ownerName:owner, phone:phone||null, city:city||null, address:addr||null });
    gymCode = result.gymCode;
    gymId   = result.gym.id;
    A.gyms.unshift({ ...result.gym, total_members:0, payment_due:0 });
  } catch(e) {
    // Demo / offline fallback — still show the credentials
    gymCode = 'FLY' + String(A.gyms.length+1).padStart(3,'0');
    gymId   = 'demo-' + Date.now();
    A.gyms.unshift({ id:gymId, gym_code:gymCode, name:gym, owner_name:owner, city, total_members:0, payment_due:0, is_active:true, created_at:new Date().toISOString() });
  }

  const pass = genPassword();
  const loginUrl = window.location.origin;

  // Fill result card
  document.getElementById('r-email').textContent = email;
  document.getElementById('r-pass').textContent  = pass;
  document.getElementById('r-code').textContent  = gymCode;
  document.getElementById('step-email').textContent = email;
  document.getElementById('step-pass').textContent  = pass;
  const sql = `INSERT INTO gym_users (user_id, gym_id, role)\nVALUES ('[PASTE-USER-UID-HERE]', '${gymId}', 'owner');`;
  document.getElementById('step-sql').textContent = sql;

  // WhatsApp invite
  const waMsg = `Hi ${owner}! 👋\n\nWelcome to *Flym* — your gym management system is ready!\n\n` +
    `🌐 Login URL: ${loginUrl}\n📧 Email: ${email}\n🔑 Password: ${pass}\n🏷️ Gym Code: ${gymCode}\n\n` +
    `Please log in and change your password after first login.\n\nWelcome aboard! — Flym Team 🚀`;

  document.getElementById('btn-copy-all').addEventListener('click', () => {
    navigator.clipboard.writeText(`Email: ${email}\nPassword: ${pass}\nGym Code: ${gymCode}\nLogin: ${loginUrl}`);
    showToast('All credentials copied!','green');
  });

  document.getElementById('btn-wa-invite').addEventListener('click', () => {
    if (!phone) { showToast('No phone number entered — add it in the form','amber'); return; }
    const ph = phone.replace(/\D/g,'');
    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(waMsg)}`, '_blank');
    showToast('WhatsApp invite opened!','green');
  });

  document.getElementById('btn-copy-sql').addEventListener('click', () => {
    navigator.clipboard.writeText(sql);
    showToast('SQL copied!','green');
  });

  // Show result, hide guide
  document.getElementById('wz-result').style.display='block';
  document.getElementById('wz-guide').style.display='none';
  document.getElementById('wz-submit').disabled=false;
  document.getElementById('wz-btn-text').style.display='inline';
  document.getElementById('wz-spinner').style.display='none';
  document.getElementById('wz-btn-text').textContent='Add Another Gym →';
  // Clear form for next entry
  ['wz-gym','wz-city','wz-owner','wz-phone','wz-email','wz-addr'].forEach(id=>{
    const el=document.getElementById(id); if(el)el.value='';
  });

  showToast(`${gym} added! Credentials generated.`,'green');
}

function genPassword() {
  const alpha='ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p='';
  for(let i=0;i<9;i++) p+=alpha[Math.floor(Math.random()*alpha.length)];
  return p+'#'+Math.floor(Math.random()*90+10);
}

// ════════════════════════════════════════════════════════════════
// WHATSAPP REMINDERS — Admin Manual Send Queue
// ════════════════════════════════════════════════════════════════
async function renderReminders(c) {
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="section-header">
      <div><div class="section-title">WhatsApp Reminders</div>
           <div class="section-sub">Members with expiring plans from gyms that have auto-reminders enabled</div></div>
      <button class="btn btn-primary btn-sm" id="btn-refresh-reminders">↻ Refresh</button>
    </div>
    <div id="reminders-content"><div class="loading-inline"><div class="spinner"></div></div></div>
  </div>`;

  document.getElementById('btn-refresh-reminders')?.addEventListener('click', () => renderReminders(c));

  // Fetch due reminders
  try {
    A.reminders = await getDueReminders();
  } catch (err) {
    console.warn('[Flym Admin] Could not fetch reminders:', err.message);
    A.reminders = [];
  }

  const rc = document.getElementById('reminders-content');
  if (!rc) return;

  if (!A.reminders.length) {
    rc.innerHTML = `<div class="card" style="text-align:center;padding:60px 20px;">
      <div style="font-size:32px;opacity:0.3;margin-bottom:12px;">✅</div>
      <div style="font-size:15px;font-weight:600;color:var(--white);margin-bottom:6px;">All clear!</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;">
        No reminders due right now. Members expiring within 7 days or 1 day<br>
        from gyms with auto-reminders enabled will appear here.
      </div>
    </div>`;
    return;
  }

  // Group by gym for clean display
  const byGym = {};
  A.reminders.forEach(r => {
    if (!byGym[r.gym_id]) byGym[r.gym_id] = { gym_name: r.gym_name, members: [] };
    byGym[r.gym_id].members.push(r);
  });

  // Summary cards
  const total7 = A.reminders.filter(r => r.window_days === 7).length;
  const total1 = A.reminders.filter(r => r.window_days === 1).length;

  let html = `
    <div class="grid-3" style="margin-bottom:24px;">
      <div class="stat-card"><div class="stat-card-accent" style="background:var(--amber);"></div>
        <div class="stat-card-label">Total Pending</div>
        <div class="stat-card-value">${A.reminders.length}</div>
        <div class="stat-card-sub">Reminders to send</div></div>
      <div class="stat-card"><div class="stat-card-accent" style="background:var(--blue);"></div>
        <div class="stat-card-label">7-Day Warnings</div>
        <div class="stat-card-value">${total7}</div>
        <div class="stat-card-sub">Expiring in 1 week</div></div>
      <div class="stat-card"><div class="stat-card-accent" style="background:var(--red);"></div>
        <div class="stat-card-label">1-Day Warnings</div>
        <div class="stat-card-value">${total1}</div>
        <div class="stat-card-sub">Expiring tomorrow</div></div>
    </div>`;

  // Render each gym group
  Object.entries(byGym).forEach(([_gymId, group]) => {
    html += `
    <div class="card" style="margin-bottom:16px;border-left:3px solid var(--blue);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--white);">${escH(group.gym_name)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">${group.members.length} reminder${group.members.length>1?'s':''} due</div>
        </div>
        <span class="badge badge-green" style="font-size:11px;">Auto-reminders ON</span>
      </div>
      <div class="table-wrap">
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr>
              <th style="text-align:left;padding:10px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg2);">Member</th>
              <th style="text-align:left;padding:10px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg2);">Phone</th>
              <th style="text-align:left;padding:10px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg2);">Plan</th>
              <th style="text-align:left;padding:10px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg2);">Expiry</th>
              <th style="text-align:center;padding:10px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg2);">Window</th>
              <th style="text-align:center;padding:10px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg2);">Actions</th>
            </tr></thead>
            <tbody>
              ${group.members.map(m => {
                const expStr = fmtDate(m.expiry_date);
                const windowBadge = m.window_days === 1
                  ? '<span class="badge badge-red">1 day</span>'
                  : '<span class="badge badge-amber">7 days</span>';
                const rowId = `rem-${m.member_id}-${m.window_days}`;
                return `<tr id="${rowId}">
                  <td style="padding:12px 14px;font-size:13px;font-weight:500;border-bottom:1px solid var(--border);">${escH(m.member_name)}</td>
                  <td style="padding:12px 14px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--border);">${escH(m.phone)}</td>
                  <td style="padding:12px 14px;font-size:13px;border-bottom:1px solid var(--border);">${escH(m.plan_name)}</td>
                  <td style="padding:12px 14px;font-size:13px;color:var(--amber);border-bottom:1px solid var(--border);">${expStr}</td>
                  <td style="padding:12px 14px;text-align:center;border-bottom:1px solid var(--border);">${windowBadge}</td>
                  <td style="padding:12px 14px;text-align:center;border-bottom:1px solid var(--border);">
                    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
                      <button class="btn btn-sm" style="background:rgba(0,215,98,0.12);color:var(--green);border:1px solid rgba(0,215,98,0.25);"
                        onclick="window.__aSendWA('${m.member_id}','${m.gym_id}',${m.window_days},'${escAttr(m.member_name)}','${escAttr(m.phone)}','${escAttr(m.plan_name)}','${escAttr(m.gym_name)}','${escAttr(m.expiry_date)}','${escAttr(m.wa_template)}')">
                        📱 Send
                      </button>
                      <button class="btn btn-ghost btn-sm"
                        onclick="window.__aMarkSent('${m.member_id}','${m.gym_id}',${m.window_days},'${escAttr(m.member_name)}','${escAttr(m.gym_name)}')">
                        ✓ Mark Sent
                      </button>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  });

  rc.innerHTML = html;

  // ── Send via WhatsApp handler ──
  window.__aSendWA = (memberId, gymId, windowDays, name, phone, plan, gymName, expiry, template) => {
    // Build message from the gym's wa_template
    const tpl = template || 'Hi {name}! Your {plan} membership at {gym} expires on {date}. Please renew to continue your fitness journey.';
    const expStr = fmtDate(expiry);
    const msg = tpl
      .replace(/{name}/gi, name)
      .replace(/{plan}/gi, plan)
      .replace(/{gym}/gi, gymName)
      .replace(/{date}/gi, expStr);

    // Normalise phone for wa.me (digits only, ensure 91 prefix for Indian numbers)
    let ph = phone.replace(/\D/g, '');
    if (ph.length === 10) ph = '91' + ph;

    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(msg)}`, '_blank');
    showToast(`WhatsApp opened for ${name}`, 'green');
  };

  // ── Mark as Sent handler ──
  window.__aMarkSent = async (memberId, gymId, windowDays, name, gymName) => {
    const msg = `Manual reminder sent (${windowDays}-day window) for ${name} at ${gymName}`;
    try {
      await markReminderSent(memberId, gymId, windowDays, msg);

      // Remove the row from UI
      const rowEl = document.getElementById(`rem-${memberId}-${windowDays}`);
      if (rowEl) {
        rowEl.style.transition = 'opacity 0.3s, transform 0.3s';
        rowEl.style.opacity = '0';
        rowEl.style.transform = 'translateX(20px)';
        setTimeout(() => {
          // Grab parent reference BEFORE removing the row
          const gymCard = rowEl.closest('.card');
          rowEl.remove();
          // Update reminder count in A.reminders
          A.reminders = A.reminders.filter(r => !(r.member_id === memberId && r.window_days === windowDays));
          // If gym group is now empty, re-render the whole section
          if (gymCard && !gymCard.querySelector('tbody tr')) {
            renderReminders(document.getElementById('admin-content'));
          }
        }, 300);
      }
      showToast(`✓ Marked sent for ${name}`, 'green');
    } catch (err) {
      showToast('Failed to mark sent: ' + err.message, 'red');
    }
  };
}

// Escape for safe embedding inside onclick='...' attribute strings
function esc(s) {
  return (s || '')
    .replace(/\\/g, '\\\\')   // backslashes first
    .replace(/'/g, "\\'")     // then single quotes
    .replace(/\n/g, '\\n')    // then newlines (wa_template has these)
    .replace(/\r/g, '');       // strip carriage returns
}

// esc() alone only protects the JS string literal inside onclick="...('...')" —
// it doesn't touch double quotes, so a gym name containing a `"` could still
// break out of the outer HTML attribute itself. This chains esc() (JS-string-safe)
// through escH() (HTML-attribute-safe) so it's safe for BOTH layers at once.
// Use this — not esc() alone — for any value interpolated inside onclick="...".
function escAttr(s) { return escH(esc(s)); }

// Format YYYY-MM-DD to readable date
function fmtDate(ds) {
  if (!ds) return '—';
  const [y, m, d] = ds.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d).padStart(2,'0')} ${months[m-1]} ${y}`;
}

// ════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ════════════════════════════════════════════════════════════════
function renderActivity(c) {
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="section-header"><div class="section-title">Activity Log</div>
      <div class="section-sub">Platform-wide events across all gyms</div></div>
    <div class="activity-feed">
      ${A.activity.map(a=>`
        <div class="activity-item">
          <div class="activity-dot" style="background:${actColor(a.action)};"></div>
          <div class="activity-text">
            <strong>${escH(a.gyms?.name||(a.gym_id?'Gym':'Admin'))}</strong> — ${escH(a.description||a.action)}
          </div>
          <div class="activity-time">${tAgo(a.created_at)}</div>
        </div>`).join('')}
      ${!A.activity.length?`<div class="empty-state" style="padding:44px;text-align:center;">
        <p>No activity yet</p></div>`:''}
    </div>
  </div>`;
}

function actColor(a) {
  if (!a) return 'var(--blue)';
  if (a.includes('added')||a.includes('created')||a.includes('onboard')) return 'var(--green)';
  if (a.includes('deleted')||a.includes('deactivat')) return 'var(--red)';
  if (a.includes('reminder')||a.includes('payment')) return 'var(--amber)';
  return 'var(--blue)';
}

// ════════════════════════════════════════════════════════════════
// BULK MEMBER ENTRY — rapid onboarding → SQL output
// ════════════════════════════════════════════════════════════════
async function renderBulkEntry(c) {
  loadBE();
  const gymOpts = A.gyms.map(g =>
    `<option value="${g.id}" ${g.id===B.gymId?'selected':''}>${escH(g.name)} (${g.gym_code||''})</option>`
  ).join('');
  const hasPlan = B.plans.length > 0;
  const ready = B.gymId && hasPlan;

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="section-header">
      <div><div class="section-title">Bulk Member Entry</div>
           <div class="section-sub">Rapid data entry for gym onboarding — generates SQL for Supabase</div></div>
      <div style="display:flex;align-items:baseline;gap:8px;">
        <div style="font-family:var(--font-head);font-size:28px;font-weight:800;transition:all 0.2s;" id="be-count">${B.entries.length}</div>
        <div style="font-size:11px;color:var(--muted);">members</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:250px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted2);font-family:var(--font-head);margin-bottom:4px;">Select Gym</div>
          <select class="form-input" id="be-gym" style="width:100%;">
            <option value="">— Choose a gym —</option>
            ${gymOpts}
          </select>
        </div>
        <div id="be-plan-status" style="font-size:12px;color:var(--muted);padding-top:14px;">
          ${B.gymId ? (hasPlan ? '✅ '+B.plans.length+' plan'+(B.plans.length>1?'s':'')+' loaded' : '') : 'Select a gym to start'}
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;transition:opacity 0.2s;${ready?'':'opacity:0.4;pointer-events:none;'}" id="be-form-card">
      <div class="be-form">
        <div class="be-field" style="flex:2;min-width:150px;">
          <label>Name *</label>
          <input class="form-input" id="be-name" placeholder="Full name" autocomplete="off">
        </div>
        <div class="be-field" style="flex:1;min-width:110px;">
          <label>Phone</label>
          <input class="form-input" id="be-phone" placeholder="Optional" autocomplete="off">
        </div>
        <div class="be-field" style="min-width:140px;">
          <label>Join Date</label>
          <input class="form-input" id="be-date" type="date" value="${B.lastDate||todayStr()}">
        </div>
        <div class="be-field" style="flex:1;min-width:150px;">
          <label>Plan</label>
          <select class="form-input" id="be-plan">
            ${B.plans.map((p,i) => `<option value="${i}" ${i===B.lastPlanIdx?'selected':''}>${escH(p.name)} — ₹${p.price}</option>`).join('')}
          </select>
        </div>
        <div class="be-field" style="min-width:85px;">
          <label>Mode</label>
          <select class="form-input" id="be-mode">
            ${['Cash','Card','Online'].map(m => `<option ${m===B.lastMode?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="be-field" style="min-width:80px;">
          <label>Discount ₹</label>
          <input class="form-input" id="be-disc" type="number" placeholder="0" autocomplete="off">
        </div>
        <div class="be-field" style="min-width:80px;">
          <label>Balance ₹</label>
          <input class="form-input" id="be-bal" type="number" placeholder="0" autocomplete="off">
        </div>
        <button class="btn btn-primary" id="be-add-btn" style="height:38px;padding:0 20px;margin-top:auto;">+ Add</button>
      </div>
      <div style="margin-top:8px;font-size:10px;color:var(--muted2);">
        Enter ↵ advances fields · Enter on Balance = Add member · All data stays local in your browser
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;padding:0;">
      <div style="overflow-x:auto;max-height:420px;overflow-y:auto;">
        <table style="width:100%;">
          <thead style="position:sticky;top:0;background:var(--panel);z-index:1;">
            <tr>
              <th style="padding:10px 12px;text-align:left;font-size:11px;border-bottom:1px solid var(--border);">#</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;border-bottom:1px solid var(--border);">Name</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;border-bottom:1px solid var(--border);">Phone</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;border-bottom:1px solid var(--border);">Joined</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;border-bottom:1px solid var(--border);">Plan</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;border-bottom:1px solid var(--border);">Net ₹</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;border-bottom:1px solid var(--border);">Disc</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;border-bottom:1px solid var(--border);">Bal</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;border-bottom:1px solid var(--border);">Mode</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;border-bottom:1px solid var(--border);">Status</th>
              <th style="padding:10px 12px;width:36px;border-bottom:1px solid var(--border);"></th>
            </tr>
          </thead>
          <tbody id="be-tbody"></tbody>
        </table>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" id="be-clear" style="color:var(--red);">🗑️ Clear All Entries</button>
      <button class="btn btn-primary" id="be-gen-sql" style="padding:12px 28px;" disabled>📋 Generate SQL (0 members)</button>
    </div>
  </div>`;

  renderBulkTable();

  document.getElementById('be-gym')?.addEventListener('change', async function() {
    const gymId = this.value;
    const gym = A.gyms.find(g => g.id === gymId);
    if (B.entries.length && B.gymId && gymId !== B.gymId) {
      const ok = await showConfirm({
        title: 'Switch gym?',
        message: `You have ${B.entries.length} unsaved entr${B.entries.length===1?'y':'ies'}. Switching will clear them.`,
        confirmLabel: 'Switch anyway',
        confirmVariant: 'amber',
      });
      if (!ok) { this.value = B.gymId; return; }
      B.entries = [];
    }
    B.gymId = gymId; B.gymName = gym?.name||''; B.plans = []; B.lastPlanIdx = 0;
    saveBE();
    const statusEl = document.getElementById('be-plan-status');
    const formCard = document.getElementById('be-form-card');
    if (!gymId) {
      statusEl.textContent = 'Select a gym to start';
      formCard.style.opacity = '0.4'; formCard.style.pointerEvents = 'none';
      renderBulkTable(); return;
    }
    statusEl.innerHTML = '⏳ Loading plans...';
    try {
      const { data, error } = await supabase
        .from('plans').select('id, name, price, duration_months')
        .eq('gym_id', gymId).eq('is_active', true).order('price');
      if (error) throw error;
      B.plans = data || [];
      saveBE();
      if (!B.plans.length) {
        statusEl.innerHTML = '⚠️ No plans — create plans in this gym\'s dashboard first';
        formCard.style.opacity = '0.4'; formCard.style.pointerEvents = 'none'; return;
      }
      statusEl.textContent = '✅ ' + B.plans.length + ' plan' + (B.plans.length>1?'s':'') + ' loaded';
      formCard.style.opacity = '1'; formCard.style.pointerEvents = '';
      const planSel = document.getElementById('be-plan');
      if (planSel) planSel.innerHTML = B.plans.map((p,i) =>
        `<option value="${i}">${escH(p.name)} — ₹${p.price}</option>`).join('');
      renderBulkTable();
      setTimeout(() => document.getElementById('be-name')?.focus(), 50);
    } catch(e) {
      statusEl.innerHTML = '❌ Failed: ' + escH(e.message);
    }
  });

  if (B.gymId && !B.plans.length) {
    document.getElementById('be-gym').dispatchEvent(new Event('change'));
  } else if (ready) {
    setTimeout(() => document.getElementById('be-name')?.focus(), 50);
  }

  const fields = ['be-name','be-phone','be-date','be-plan','be-mode','be-disc','be-bal'];
  fields.forEach((id, i) => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (i === fields.length - 1) { addBulkEntry(); return; }
      const next = document.getElementById(fields[i+1]);
      if (next) { next.focus(); if (next.select) next.select(); }
    });
  });

  document.getElementById('be-add-btn')?.addEventListener('click', addBulkEntry);
  document.getElementById('be-clear')?.addEventListener('click', async () => {
    if (!B.entries.length) return;
    const ok = await showConfirm({
      title: 'Clear all entries?',
      message: `This will remove all ${B.entries.length} entr${B.entries.length===1?'y':'ies'} from your bulk list.`,
      confirmLabel: 'Clear all',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    B.entries = []; saveBE(); renderBulkTable();
    showToast('All entries cleared','amber');
  });
  document.getElementById('be-gen-sql')?.addEventListener('click', showBulkSQL);
  window.__beDelEntry = (idx) => { B.entries.splice(idx,1); saveBE(); renderBulkTable(); };
}

function addBulkEntry() {
  const nameEl = document.getElementById('be-name');
  const name = nameEl?.value.trim();
  if (!name) { nameEl?.focus(); return; }
  if (!B.plans.length) return;
  const phone    = document.getElementById('be-phone')?.value.trim() || null;
  const joinDate = document.getElementById('be-date')?.value || todayStr();
  const planIdx  = parseInt(document.getElementById('be-plan')?.value) || 0;
  const mode     = document.getElementById('be-mode')?.value || 'Cash';
  const disc     = parseFloat(document.getElementById('be-disc')?.value) || 0;
  const bal      = parseFloat(document.getElementById('be-bal')?.value) || 0;
  const plan = B.plans[planIdx] || B.plans[0];
  const net  = Math.max(0, plan.price - disc);
  const status = bal <= 0 ? 'Paid' : (bal >= net ? 'Due' : 'Partial');
  const mType  = (bal >= net && net > 0) ? 'Unpaid' : 'Paid';
  B.entries.unshift({
    name, phone, joinDate,
    expiryDate: addMonthsBE(joinDate, plan.duration_months),
    planName: plan.name, planId: plan.id,
    planPrice: net, planDuration: plan.duration_months,
    discountAmount: disc, balanceDue: bal,
    paymentStatus: status, paymentMode: mode,
    memberType: mType, amountPaid: Math.max(0, net - bal)
  });
  B.lastDate = joinDate; B.lastPlanIdx = planIdx; B.lastMode = mode;
  saveBE();
  document.getElementById('be-name').value = '';
  document.getElementById('be-phone').value = '';
  document.getElementById('be-disc').value = '';
  document.getElementById('be-bal').value = '';
  const countEl = document.getElementById('be-count');
  if (countEl) {
    countEl.style.color = 'var(--green)'; countEl.style.transform = 'scale(1.15)';
    setTimeout(() => { countEl.style.color=''; countEl.style.transform=''; }, 250);
  }
  renderBulkTable();
  document.getElementById('be-name')?.focus();
}

function renderBulkTable() {
  const tbody = document.getElementById('be-tbody');
  if (!tbody) return;
  const len = B.entries.length;
  if (!len) {
    tbody.innerHTML = '<tr><td colspan="11" style="padding:40px;text-align:center;color:var(--muted);font-size:13px;">No entries yet — select a gym and start typing above</td></tr>';
  } else {
    tbody.innerHTML = B.entries.map((e,i) => {
      const mb = e.paymentMode==='Cash'?'badge-amber':(e.paymentMode==='Card'?'badge-purple':'badge-blue');
      const sb = e.paymentStatus==='Paid'?'badge-green':(e.paymentStatus==='Due'?'badge-red':'badge-amber');
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px 12px;font-size:11px;color:var(--muted2);">${len-i}</td>
        <td style="padding:8px 12px;font-weight:500;font-size:13px;">${escH(e.name)}</td>
        <td style="padding:8px 12px;font-size:12px;color:var(--muted);">${escH(e.phone||'—')}</td>
        <td style="padding:8px 12px;font-size:12px;color:var(--muted);">${fmtDateShort(e.joinDate)}</td>
        <td style="padding:8px 12px;font-size:12px;">${escH(e.planName)}</td>
        <td style="padding:8px 12px;font-size:12px;text-align:right;">₹${e.planPrice}</td>
        <td style="padding:8px 12px;font-size:12px;text-align:right;color:var(--muted);">${e.discountAmount>0?'₹'+e.discountAmount:'—'}</td>
        <td style="padding:8px 12px;font-size:12px;text-align:right;${e.balanceDue>0?'color:var(--amber);':''}">${e.balanceDue>0?'₹'+e.balanceDue:'—'}</td>
        <td style="padding:8px 12px;"><span class="badge ${mb}" style="font-size:10px;">${e.paymentMode}</span></td>
        <td style="padding:8px 12px;"><span class="badge ${sb}" style="font-size:10px;">${e.paymentStatus}</span></td>
        <td style="padding:8px 12px;"><button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:11px;color:var(--muted);" onclick="window.__beDelEntry(${i})">✕</button></td>
      </tr>`;
    }).join('');
  }
  const countEl = document.getElementById('be-count');
  if (countEl) countEl.textContent = len;
  const sqlBtn = document.getElementById('be-gen-sql');
  if (sqlBtn) {
    sqlBtn.textContent = '📋 Generate SQL (' + len + ' members)';
    sqlBtn.disabled = len === 0 || !B.gymId;
  }
}

function generateBulkSQL() {
  if (!B.entries.length || !B.gymId) return '';
  const gid = escSQL(B.gymId);
  const rows = [...B.entries].reverse();

  // Compute join date range for the payment-history query
  const dates = rows.map(e => e.joinDate).filter(Boolean).sort();
  const minDate = dates[0] || '2020-01-01';
  const maxDate = dates[dates.length - 1] || '2099-12-31';

  let s = '-- =============================================\n'
    + '-- Bulk Migration: ' + escSQL(B.gymName) + '\n'
    + '-- Gym ID: ' + gid + '\n'
    + '-- Members: ' + rows.length + '\n'
    + '-- Generated: ' + new Date().toLocaleString('en-IN') + '\n'
    + '-- =============================================\n'
    + '-- NOTE: Two-step approach (no CTE RETURNING) so RLS\n'
    + '-- cannot silently block payment_history creation.\n'
    + '-- =============================================\n\n'
    + 'BEGIN;\n\n'
    + '-- ── Step 1: Insert members ──────────────────────\n'
    + 'INSERT INTO members (\n'
    + '    gym_id, full_name, phone, join_date, expiry_date,\n'
    + '    plan_name, plan_price, plan_id, plan_duration_months,\n'
    + '    discount_amount, balance_due, payment_status, payment_mode,\n'
    + '    member_type, is_active\n) VALUES\n';
  rows.forEach((e,i) => {
    const ph = e.phone ? "'" + escSQL(e.phone) + "'" : 'null';
    s += '    -- ' + (i+1) + '. ' + e.name + '\n'
      +  "    ('" + gid + "', '" + escSQL(e.name) + "', " + ph + ", '" + e.joinDate + "', '" + e.expiryDate + "',\n"
      +  "     '" + escSQL(e.planName) + "', " + e.planPrice + ", '" + e.planId + "',\n"
      +  '     ' + e.planDuration + ', ' + e.discountAmount + ', ' + e.balanceDue + ", '" + e.paymentStatus + "', '" + e.paymentMode + "',\n"
      +  "     '" + e.memberType + "', true)" + (i<rows.length-1?',':'') + '\n';
  });
  s += ';\n\n'
    + '-- ── Step 2: Create payment records ─────────────\n'
    + '-- Queries members table directly (immune to RLS\n'
    + '-- blocking RETURNING). NOT EXISTS prevents duplicates\n'
    + '-- if this SQL is run more than once.\n'
    + 'INSERT INTO payment_history (gym_id, member_id, amount, payment_mode, plan_name, paid_at, notes)\n'
    + "SELECT m.gym_id, m.id,\n"
    + "       (m.plan_price - COALESCE(m.balance_due, 0)),\n"
    + "       m.payment_mode,\n"
    + "       m.plan_name,\n"
    + "       (m.join_date + TIME '12:00:00') AT TIME ZONE 'Asia/Kolkata',\n"
    + "       'Bulk entry'\n"
    + "FROM members m\n"
    + "WHERE m.gym_id = '" + gid + "'\n"
    + "  AND m.is_active = true\n"
    + "  AND m.join_date >= '" + minDate + "'\n"
    + "  AND m.join_date <= '" + maxDate + "'\n"
    + "  AND (m.plan_price - COALESCE(m.balance_due, 0)) > 0\n"
    + "  AND NOT EXISTS (\n"
    + "    SELECT 1 FROM payment_history ph WHERE ph.member_id = m.id\n"
    + "  );\n\n"
    + 'COMMIT;\n\n'
    + '-- ── Step 3: Verify (run after commit) ──────────\n'
    + "-- Check that member count and payment count match:\n"
    + "SELECT 'Members in range' AS check,\n"
    + "       COUNT(*) AS count\n"
    + "FROM members\n"
    + "WHERE gym_id = '" + gid + "'\n"
    + "  AND is_active = true\n"
    + "  AND join_date >= '" + minDate + "'\n"
    + "  AND join_date <= '" + maxDate + "'\n"
    + "UNION ALL\n"
    + "SELECT 'Payment records',\n"
    + "       COUNT(*)\n"
    + "FROM payment_history\n"
    + "WHERE gym_id = '" + gid + "'\n"
    + "  AND paid_at >= '" + minDate + "T00:00:00'\n"
    + "  AND paid_at <= '" + maxDate + "T23:59:59';\n"
    + "-- Both counts should be similar (payments may be fewer\n"
    + "-- if some members had balance_due >= plan_price).\n";
  return s;
}

function showBulkSQL() {
  const sql = generateBulkSQL();
  if (!sql) return;
  openModal({
    title: 'SQL Output — ' + B.entries.length + ' Members',
    body: '<div style="margin-bottom:12px;">'
      + '<button class="btn btn-primary btn-sm" id="be-copy-sql">📋 Copy SQL</button></div>'
      + '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;max-height:55vh;overflow:auto;">'
      + '<pre style="font-family:monospace;font-size:11px;color:var(--green);white-space:pre-wrap;word-break:break-all;margin:0;line-height:1.6;">'
      + escH(sql) + '</pre></div>'
      + '<div style="margin-top:10px;font-size:11px;color:var(--muted);">Paste into <strong>Supabase SQL Editor</strong> and run.</div>',
    size: 'lg',
    onOpen: () => {
      document.getElementById('be-copy-sql')?.addEventListener('click', () => {
        navigator.clipboard.writeText(sql).then(() => showToast('SQL copied!','green'));
      });
    }
  });
}

// ════════════════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════════════════
function buildSidebar() {
  return `<div class="sidebar">
    <div class="sidebar-logo">
      <svg viewBox="90 128 410 162" width="82" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Flym">
                <path opacity="0.4" d="M124 188C221.333 134.667 340 122.667 480 152" stroke="#2A8FFF" stroke-width="3.5" stroke-linecap="round"/>
                <path d="M124 188C221.333 134.667 340 122.667 480 152" stroke="#2A8FFF" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M480 161C484.971 161 489 156.971 489 152C489 147.029 484.971 143 480 143C475.029 143 471 147.029 471 152C471 156.971 475.029 161 480 161Z" stroke="#2A8FFF" stroke-width="1.8"/>
                <path d="M480 155.5C481.933 155.5 483.5 153.933 483.5 152C483.5 150.067 481.933 148.5 480 148.5C478.067 148.5 476.5 150.067 476.5 152C476.5 153.933 478.067 155.5 480 155.5Z" fill="#2A8FFF"/>
                <path d="M141.144 254H138.184V148.328H141.144V254ZM100 180.888V177.928H112.876V161.056C112.876 158.096 113.32 155.728 114.208 153.952C115.096 152.324 116.428 151.14 117.908 150.252C119.388 149.364 121.016 148.92 122.792 148.624C124.568 148.476 126.196 148.328 127.824 148.328C129.156 148.328 130.34 148.476 131.376 148.624C132.412 148.772 133.3 148.92 134.188 148.92V151.88C132.708 151.732 131.524 151.584 130.488 151.436C129.304 151.436 128.268 151.288 127.232 151.288C122.496 151.288 119.388 152.176 117.908 153.952C116.428 155.728 115.836 158.392 115.836 162.092V177.928H132.264V180.888H115.836V254H112.876V180.888H100Z" fill="#fff"/>
                <path d="M210.557 178.224L176.961 266.58C174.889 271.76 172.669 275.312 170.005 277.236C167.341 279.012 163.197 280.048 157.425 280.048H155.205V277.236C155.797 277.236 156.389 277.384 156.981 277.384C161.273 277.384 164.677 276.792 167.193 275.608C169.561 274.424 171.485 272.056 172.965 268.356C174.741 264.36 176.517 259.328 178.589 253.26L146.769 178.224H150.025L180.217 250.004L207.597 178.224H210.557Z" fill="#fff"/>
                <path d="M220.803 178.224V196.132C224.799 183.108 233.087 176.596 245.815 176.596C251.735 176.596 256.767 178.076 260.615 181.184C264.463 184.292 266.979 188.584 268.459 194.208C272.603 182.368 280.743 176.448 292.879 176.448C300.871 176.448 306.939 178.668 310.935 183.404C314.783 187.992 316.855 194.356 316.855 202.496V254.148H313.747V201.46C313.747 194.652 311.971 189.176 308.419 185.328C304.867 181.332 299.687 179.408 292.731 179.408C285.627 179.408 279.855 181.628 275.563 186.364C271.271 190.952 269.199 197.02 269.199 204.568V254H266.239V202.644C266.239 195.54 264.463 189.916 261.207 185.624C257.803 181.48 252.475 179.26 245.371 179.26C237.971 179.26 232.051 182.072 227.611 187.696C223.023 193.32 220.803 200.572 220.803 209.748V254H217.843V178.224H220.803Z" fill="#fff"/>
              </svg>
    </div>
    <div class="sidebar-identity">
      <div class="sidebar-identity-label">Logged in as</div>
      <div class="sidebar-identity-name">Flym Admin</div>
      <span class="sidebar-badge sidebar-badge-admin">SUPERADMIN</span>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-label">Admin</div>
      <div class="nav-item active" data-id="a-overview">
        <svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>Overview</div>
      <div class="nav-item" data-id="a-gyms">
        <svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Gyms</div>
      <div class="nav-item" data-id="a-credentials">
        <svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Add Gym & Owner</div>
      <div class="nav-item" data-id="a-bulkentry">
        <svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Bulk Entry</div>
      <div class="nav-item" data-id="a-reminders">
        <svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>Reminders</div>
      <div class="nav-item" data-id="a-activity">
        <svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Activity Log</div>
      <div class="nav-section-label">Billing</div>
      <div class="nav-item" data-id="a-subscriptions">
        <svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>Subscriptions</div>
    </nav>
    <div class="sidebar-footer">
      <button class="sidebar-logout" id="admin-logout">
        <svg class="nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sign Out
      </button>
    </div>
  </div>`;
}

function bindSidebar(router) {
  document.querySelectorAll('#admin-sidebar .nav-item').forEach(item =>
    item.addEventListener('click', () => {
      aNAv(item.dataset.id);
      closeAdminMobileSidebar();
    }));
  document.getElementById('admin-logout')?.addEventListener('click', async ()=>{
    await signOut().catch(()=>{});
    window.__flymSession=null;
    router.go('landing');
  });

  const hamburger = document.getElementById('a-hamburger-btn');
  const overlay   = document.getElementById('a-sidebar-overlay');
  const sidebar   = document.querySelector('#admin-sidebar .sidebar');

  hamburger?.addEventListener('click', () => {
    const open = sidebar?.classList.toggle('sidebar-open');
    overlay?.classList.toggle('active', open);
    hamburger.classList.toggle('open', open);
  });
  overlay?.addEventListener('click', closeAdminMobileSidebar);
}

function closeAdminMobileSidebar() {
  document.querySelector('#admin-sidebar .sidebar')?.classList.remove('sidebar-open');
  document.getElementById('a-sidebar-overlay')?.classList.remove('active');
  document.getElementById('a-hamburger-btn')?.classList.remove('open');
}


// ════════════════════════════════════════════════════════════════
// GYM DETAIL VIEW
// ════════════════════════════════════════════════════════════════
function renderGymDetail(c) {
  const g = A.gyms.find(x => x.id === A.selectedGymId);
  if (!g) { aNAv('a-gyms'); return; }

  const on        = g.is_active !== false;
  const onboarded = g.created_at
    ? new Date(g.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
    : '—';

  const statusBadge = on
    ? '<span class="badge badge-green" style="font-size:13px;padding:6px 14px;">Active</span>'
    : '<span class="badge badge-muted"  style="font-size:13px;padding:6px 14px;">Inactive</span>';

  const toggleBtn = on
    ? '<button class="btn" id="btn-gym-toggle" style="width:100%;background:rgba(255,77,77,0.1);color:var(--red);border:1px solid rgba(255,77,77,0.3);">Deactivate Gym</button>'
    : '<button class="btn btn-primary" id="btn-gym-toggle" style="width:100%;">Reactivate Gym</button>';

  const toggleHint = on
    ? 'Deactivating will prevent the gym owner from logging in. All data is retained and can be restored.'
    : 'Reactivating will restore the gym owner access immediately.';

  const duesColor = (g.payment_due || 0) > 0 ? 'var(--red)' : 'var(--green)';

  // Start rendering the base layout immediately
  const renderBase = (branchCardHTML) => {
    c.innerHTML = '<div class="content-inner page-enter">'
    + '<div class="section-header" style="margin-bottom:28px;">'
    +   '<div>'
    +     '<button class="btn btn-ghost btn-sm" id="btn-back-gyms" style="margin-bottom:10px;">← Back to Gyms</button>'
    +     '<div class="section-title">' + escH(g.name) + '</div>'
    +     '<div class="section-sub">Gym code: <code style="color:var(--blue-light);">' + escH(g.gym_code || '—') + '</code></div>'
    +   '</div>'
    +   statusBadge
    + '</div>'

    + '<div class="grid-2" style="align-items:start;gap:20px;">'

    // ── Left column ──
    + '<div style="display:flex;flex-direction:column;gap:20px;">'

    +   '<div class="card">'
    +     '<div class="card-title" style="margin-bottom:18px;">Gym Information</div>'
    +     detailRow('Gym Name',    escH(g.name))
    +     detailRow('Gym Code',    escH(g.gym_code    || '—'), true)
    +     detailRow('Owner Name',  escH(g.owner_name  || '—'))
    +     detailRow('City',        escH(g.city        || '—'))
    +     detailRow('Phone',       escH(g.phone       || '—'))
    +     detailRow('Address',     escH(g.address     || '—'))
    +     detailRow('Onboarded',   onboarded)
    +   '</div>'

    +   '<div class="card">'
    +     '<div class="card-title" style="margin-bottom:18px;">Membership Stats</div>'
    +     '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">'
    +       '<div style="background:var(--panel2);border-radius:var(--radius-sm);padding:16px;text-align:center;">'
    +         '<div style="font-size:26px;font-weight:700;color:var(--blue-light);">' + (g.total_members || 0) + '</div>'
    +         '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">Total Members</div>'
    +       '</div>'
    +       '<div style="background:var(--panel2);border-radius:var(--radius-sm);padding:16px;text-align:center;">'
    +         '<div style="font-size:26px;font-weight:700;color:' + duesColor + ';">' + (g.payment_due || 0) + '</div>'
    +         '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">Payment Dues</div>'
    +       '</div>'
    +     '</div>'
    +   '</div>'

    + '</div>'

    // ── Right column ──
    + '<div style="display:flex;flex-direction:column;gap:20px;">'

    +   '<div class="card">'
    +     '<div class="card-title" style="margin-bottom:18px;">Account Actions</div>'
    +     toggleBtn
    +     '<div style="margin-top:12px;font-size:12px;color:var(--muted);line-height:1.6;">' + toggleHint + '</div>'
    +   '</div>'

    +   '<div class="card">'
    +     '<div class="card-title" style="margin-bottom:18px;">Data & Backup Policy</div>'
    +     '<div style="font-size:13px;color:var(--muted);line-height:1.8;">'
    +       '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">'
    +         '<span style="color:var(--green);flex-shrink:0;">&#10003;</span>'
    +         '<span>Data stored <strong>indefinitely</strong> while subscription is active.</span>'
    +       '</div>'
    +       '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">'
    +         '<span style="color:var(--blue-light);flex-shrink:0;">&#128274;</span>'
    +         '<span>Daily backups with <strong>30-day rollback</strong> window.</span>'
    +       '</div>'
    +       '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">'
    +         '<span style="color:var(--amber);flex-shrink:0;">&#9888;</span>'
    +         '<span>After deactivation, data retained for <strong>90 days</strong> before permanent deletion.</span>'
    +       '</div>'
    +       '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;">'
    +         '<span style="color:var(--muted);flex-shrink:0;">&#128203;</span>'
    +         '<span>Gym owners can export member data as CSV from their dashboard anytime.</span>'
    +       '</div>'
    +     '</div>'
    +   '</div>'

    +   '<div class="card">'
    +     '<div class="card-title" style="margin-bottom:14px;">Quick Contact</div>'
    +     '<div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Email this gym owner directly</div>'
    +     '<a href="mailto:' + escH(g.email || '') + '" class="btn btn-ghost" style="display:block;text-align:center;text-decoration:none;">&#9993; Send Email</a>'
    +   '</div>'

    + branchCardHTML

    + '</div>'
    + '</div>'
    + '</div>';

    document.getElementById('btn-back-gyms')?.addEventListener('click', () => aNAv('a-gyms'));
    document.getElementById('btn-gym-toggle')?.addEventListener('click', () => deactGym(g.id, g.name, on));
    bindBranchLinking(g.id);
  };

  // Load branch linking data async, render base immediately with placeholder
  renderBase('<div class="card" style="opacity:0.5;"><div class="card-title">🔗 Branch Linking</div><div style="color:var(--muted);font-size:13px;">Loading...</div></div>');
  renderBranchLinkingCard(g.id, g.name).then(html => {
    renderBase(html);
  }).catch(() => {
    // Already rendered with placeholder, that's fine
  });
}

function detailRow(label, value, isCode) {
  const val = isCode
    ? '<code style="color:var(--blue-light);background:var(--blue-glow2);padding:2px 8px;border-radius:3px;">' + value + '</code>'
    : '<span style="font-weight:500;">' + value + '</span>';
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px;">'
    + '<span style="color:var(--muted);">' + label + '</span>'
    + val
    + '</div>';
}

// ════════════════════════════════════════════════════════════════
// HELPERS & DEMO DATA
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS (Flym billing for gym clients)
// ════════════════════════════════════════════════════════════════
async function renderSubscriptions(c) {
  // Load all subscriptions across all gyms
  let subs = [];
  try {
    const { data, error } = await supabase
      .from('gym_subscriptions')
      .select('*, gyms(name), gym_subscription_items(*)')
      .order('end_date', { ascending: false });
    if (error) throw error;
    subs = data || [];
  } catch (e) {
    console.warn('[Flym Admin] Subscriptions load:', e.message);
  }

  const now = new Date();

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="section-header">
      <div><div class="section-title">Subscription Management</div>
           <div class="section-sub">Manage Flym subscriptions for gym clients</div></div>
      <button class="btn btn-primary btn-sm" id="btn-add-sub">+ Add Subscription</button>
    </div>
    <div class="table-wrap">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Gym</th><th>Plan</th><th>Amount</th><th>Period</th><th>Status</th><th>Days Left</th><th>Actions</th></tr></thead>
          <tbody>
            ${subs.map(s => {
              const endD = new Date(s.end_date + 'T23:59:59');
              const dl = Math.ceil((endD - now) / (1000*60*60*24));
              const isExp = dl < 0;
              const statusBadge = isExp ? 'badge-red' : dl <= 15 ? 'badge-amber' : 'badge-green';
              const statusText = isExp ? 'Expired' : s.status === 'cancelled' ? 'Cancelled' : 'Active';
              return `<tr>
                <td style="font-weight:500;">${escH(s.gyms?.name || '—')}</td>
                <td>${escH(s.plan_name)}</td>
                <td>₹${Number(s.amount).toLocaleString('en-IN')}</td>
                <td style="font-size:12px;color:var(--muted);">${new Date(s.start_date).toLocaleDateString('en-IN',{day:'numeric',month:'short'})} — ${new Date(s.end_date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</td>
                <td><span class="badge ${statusBadge}">${statusText}</span></td>
                <td style="font-weight:600;color:${isExp?'var(--red)':dl<=7?'var(--red)':dl<=15?'var(--amber)':'var(--green)'};">${isExp?'Expired':`${dl}d`}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="window.__aEditSub('${s.id}')">Edit</button></td>
              </tr>`;
            }).join('')}
            ${!subs.length?`<tr><td colspan="7" style="padding:44px;text-align:center;color:var(--muted);">No subscriptions yet.</td></tr>`:''}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;

  document.getElementById('btn-add-sub')?.addEventListener('click', () => openSubModal());
  window.__aEditSub = (id) => {
    const sub = subs.find(s => s.id === id);
    if (sub) openSubModal(sub);
  };
}

function openSubModal(existing) {
  const isEdit = !!existing;
  const gymOpts = A.gyms.map(g => `<option value="${g.id}" ${existing?.gym_id === g.id ? 'selected' : ''}>${escH(g.name)} (${escH(g.gym_code||'')})</option>`).join('');

  const existingItems = existing?.gym_subscription_items || [];
  let itemIdx = existingItems.length;

  openModal({
    title: isEdit ? 'Edit Subscription' : 'New Subscription',
    size: 'lg',
    body: `<div class="modal-form">
      <div class="form-group"><label class="form-label">Gym *</label>
        <select class="form-input" id="sub-gym" style="width:100%;color:var(--white);" ${isEdit?'disabled':''}>
          <option value="">-- Select Gym --</option>${gymOpts}
        </select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Plan Name *</label>
          <input class="form-input" id="sub-plan" value="${escH(existing?.plan_name||'')}" placeholder="e.g. Monthly, 6 Months, Yearly"></div>
        <div class="form-group"><label class="form-label">Total Amount (₹) *</label>
          <input class="form-input" id="sub-amount" type="number" min="0" value="${existing?.amount||''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Start Date *</label>
          <input class="form-input" id="sub-start" type="date" value="${existing?.start_date||new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group"><label class="form-label">End Date *</label>
          <input class="form-input" id="sub-end" type="date" value="${existing?.end_date||''}"></div>
      </div>
      <div class="form-group"><label class="form-label">Notes</label>
        <input class="form-input" id="sub-notes" placeholder="Any notes..." value="${escH(existing?.notes||'')}"></div>

      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <label class="form-label" style="margin-bottom:0;">Invoice Line Items</label>
          <button type="button" class="btn btn-ghost btn-sm" id="sub-add-item">+ Add Item</button>
        </div>
        <div id="sub-items-list">
          ${existingItems.map((item, i) => `
            <div class="sub-item-row" data-idx="${i}" style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
              <input class="form-input" placeholder="Description" value="${escH(item.description)}" style="flex:2;" data-field="desc">
              <input class="form-input" type="number" min="0" placeholder="Amount" value="${item.amount}" style="flex:1;" data-field="amt">
              <button type="button" class="sub-item-del" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:4px;">✕</button>
            </div>
          `).join('')}
        </div>
      </div>

      <div id="sub-error" style="display:none;color:var(--red);font-size:13px;margin-top:12px;
        padding:10px 13px;background:rgba(255,77,77,0.08);border-radius:2px;"></div>
    </div>`,
    footer: `<button class="btn btn-ghost" data-modal-cancel>Cancel</button>
             <button class="btn btn-primary" id="sub-save">${isEdit?'Save Changes':'Create Subscription'}</button>`,
    onOpen() {
      // Bind modal cancel (data-modal-cancel attribute)
      document.querySelector('[data-modal-cancel]')?.addEventListener('click', () => { closeModal(); });

      // Add item row
      document.getElementById('sub-add-item')?.addEventListener('click', () => {
        const list = document.getElementById('sub-items-list');
        const row = document.createElement('div');
        row.className = 'sub-item-row';
        row.dataset.idx = itemIdx++;
        row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;';
        row.innerHTML = `<input class="form-input" placeholder="Description" style="flex:2;" data-field="desc">
          <input class="form-input" type="number" min="0" placeholder="Amount" style="flex:1;" data-field="amt">
          <button type="button" class="sub-item-del" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:4px;">✕</button>`;
        row.querySelector('.sub-item-del').addEventListener('click', () => row.remove());
        list.appendChild(row);
      });

      // Bind existing delete buttons
      document.querySelectorAll('.sub-item-del').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.sub-item-row').remove());
      });

      // Save
      document.getElementById('sub-save')?.addEventListener('click', async () => {
        const errEl = document.getElementById('sub-error');
        errEl.style.display = 'none';
        const show = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

        const gymId = isEdit ? existing.gym_id : document.getElementById('sub-gym')?.value;
        const planName = document.getElementById('sub-plan')?.value.trim();
        const amount = parseFloat(document.getElementById('sub-amount')?.value) || 0;
        const startDate = document.getElementById('sub-start')?.value;
        const endDate = document.getElementById('sub-end')?.value;
        const notes = document.getElementById('sub-notes')?.value.trim() || null;

        if (!gymId) { show('Please select a gym.'); return; }
        if (!planName) { show('Plan name is required.'); return; }
        if (!startDate || !endDate) { show('Start and end dates are required.'); return; }
        if (startDate > endDate) { show('End date must be after start date.'); return; }

        // Collect line items
        const items = [...document.querySelectorAll('#sub-items-list .sub-item-row')].map(row => ({
          description: row.querySelector('[data-field="desc"]')?.value.trim() || '',
          amount: parseFloat(row.querySelector('[data-field="amt"]')?.value) || 0,
        })).filter(item => item.description);

        const btn2 = document.getElementById('sub-save');
        btn2.disabled = true; btn2.textContent = 'Saving...';

        try {
          if (isEdit) {
            // Update subscription
            const { error } = await supabase
              .from('gym_subscriptions')
              .update({ plan_name: planName, amount, start_date: startDate, end_date: endDate, notes, status: new Date(endDate+'T23:59:59') < new Date() ? 'expired' : 'active', updated_at: new Date().toISOString() })
              .eq('id', existing.id);
            if (error) throw error;

            // Delete old items and re-insert
            await supabase.from('gym_subscription_items').delete().eq('subscription_id', existing.id);
            if (items.length > 0) {
              const { error: itemErr } = await supabase.from('gym_subscription_items').insert(
                items.map(item => ({ subscription_id: existing.id, description: item.description, amount: item.amount }))
              );
              if (itemErr) throw itemErr;
            }
          } else {
            // Create new subscription
            const { data: newSub, error } = await supabase
              .from('gym_subscriptions')
              .insert({ gym_id: gymId, plan_name: planName, amount, start_date: startDate, end_date: endDate, notes })
              .select()
              .single();
            if (error) throw error;

            if (items.length > 0) {
              const { error: itemErr } = await supabase.from('gym_subscription_items').insert(
                items.map(item => ({ subscription_id: newSub.id, description: item.description, amount: item.amount }))
              );
              if (itemErr) throw itemErr;
            }
          }

          closeModal();
          showToast(isEdit ? 'Subscription updated!' : 'Subscription created!', 'green');
          aNAv('a-subscriptions');
        } catch (err) {
          show(err.message || 'Save failed.');
          btn2.disabled = false; btn2.textContent = isEdit ? 'Save Changes' : 'Create Subscription';
        }
      });
    }
  });
}

// ════════════════════════════════════════════════════════════════
// BRANCH LINKING (inside Gym Detail view)
// ════════════════════════════════════════════════════════════════
async function renderBranchLinkingCard(gymId, gymName) {
  // Find all gym_users for this gym
  const { data: gymUsers, error } = await supabase
    .from('gym_users')
    .select('id, user_id, role, is_selected')
    .eq('gym_id', gymId);

  if (error) return `<div class="card"><div class="card-title">🔗 Branch Linking</div><div style="color:var(--red);font-size:13px;">Could not load gym users: ${escH(error.message)}</div></div>`;

  const owners = (gymUsers || []).filter(u => u.role === 'owner');
  if (owners.length === 0) return `<div class="card"><div class="card-title">🔗 Branch Linking</div><div style="font-size:13px;color:var(--muted);">No owner account linked to this gym yet. Create credentials first.</div></div>`;

  // For each owner, get all their linked gyms
  let branchInfo = '';
  let allLinkedGymIds = [gymId]; // track which gyms are already linked

  for (const owner of owners) {
    const { data: allLinks } = await supabase
      .from('gym_users')
      .select('id, gym_id, is_selected, gyms(name, gym_code)')
      .eq('user_id', owner.user_id)
      .eq('role', 'owner');

    const links = (allLinks || []).filter(l => l.gyms);
    links.forEach(l => { if (!allLinkedGymIds.includes(l.gym_id)) allLinkedGymIds.push(l.gym_id); });

    const otherLinks = links.filter(l => l.gym_id !== gymId);

    branchInfo += `<div style="margin-bottom:12px;padding:12px;background:var(--bg2);border-radius:var(--radius-sm);">
      <div style="font-size:11px;color:var(--muted2);margin-bottom:8px;">Owner account: <code style="font-size:10px;">${owner.user_id.substring(0,8)}…</code></div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:${otherLinks.length > 0 ? '10' : '0'}px;">
        <span class="badge badge-blue" style="font-size:11px;">${escH(gymName)} (this gym)</span>
        ${links.length === 1 ? '<span style="font-size:12px;color:var(--muted);margin-left:4px;">No other branches linked</span>' : ''}
      </div>
      ${otherLinks.map(l => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--surface-2);border-radius:var(--radius-sm);margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="badge badge-green" style="font-size:11px;">${escH(l.gyms.name)}</span>
            <span style="font-size:10px;color:var(--muted2);">${escH(l.gyms.gym_code || '')}</span>
          </div>
          <button class="btn btn-sm" data-unlink-id="${l.id}" data-unlink-name="${escH(l.gyms.name)}"
            style="background:var(--red-fade);color:var(--red);border:1px solid var(--red-strong);padding:3px 10px;font-size:11px;">
            Unlink
          </button>
        </div>
      `).join('')}
    </div>`;
  }

  // Build dropdown — exclude already-linked gyms
  const otherGyms = A.gyms.filter(g => !allLinkedGymIds.includes(g.id) && g.is_active !== false);
  const otherOpts = otherGyms.map(g => `<option value="${g.id}">${escH(g.name)} (${escH(g.gym_code||'')})</option>`).join('');

  return `<div class="card">
    <div class="card-title" style="margin-bottom:14px;">🔗 Branch Linking</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.6;">
      Link multiple gyms to the same owner account so they can switch between branches with a single login.
      The owner must <strong style="color:var(--white);">log out and log back in</strong> after linking for the switcher to appear.
    </div>
    ${branchInfo}
    ${otherGyms.length > 0 ? `
      <div style="display:flex;gap:8px;margin-top:12px;">
        <select class="form-input" id="branch-link-gym" style="flex:1;color:var(--white);">
          <option value="">-- Select gym to link --</option>
          ${otherOpts}
        </select>
        <button class="btn btn-primary btn-sm" id="btn-link-branch">Link</button>
      </div>
    ` : '<div style="font-size:12px;color:var(--muted);margin-top:8px;">All active gyms are already linked to this owner.</div>'}
    <div id="branch-link-err" style="display:none;color:var(--red);font-size:12px;margin-top:8px;"></div>
  </div>`;
}

function bindBranchLinking(gymId) {
  // Link button
  document.getElementById('btn-link-branch')?.addEventListener('click', async () => {
    const targetGymId = document.getElementById('branch-link-gym')?.value;
    const errEl = document.getElementById('branch-link-err');
    if (errEl) errEl.style.display = 'none';

    if (!targetGymId) {
      if (errEl) { errEl.textContent = 'Select a gym to link.'; errEl.style.display = 'block'; }
      return;
    }

    const btn = document.getElementById('btn-link-branch');
    if (btn) { btn.disabled = true; btn.textContent = 'Linking...'; }

    // Get the owner user_id from the current gym
    const { data: currentOwners } = await supabase
      .from('gym_users')
      .select('user_id')
      .eq('gym_id', gymId)
      .eq('role', 'owner');

    if (!currentOwners || currentOwners.length === 0) {
      if (errEl) { errEl.textContent = 'No owner found for this gym.'; errEl.style.display = 'block'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Link'; }
      return;
    }

    const ownerId = currentOwners[0].user_id;

    // Check if already linked
    const { data: existingLink } = await supabase
      .from('gym_users')
      .select('id')
      .eq('user_id', ownerId)
      .eq('gym_id', targetGymId)
      .maybeSingle();

    if (existingLink) {
      if (errEl) { errEl.textContent = 'This gym is already linked to this owner.'; errEl.style.display = 'block'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Link'; }
      return;
    }

    // Insert new gym_users row
    const { error } = await supabase
      .from('gym_users')
      .insert({ user_id: ownerId, gym_id: targetGymId, role: 'owner', is_selected: false });

    if (error) {
      if (errEl) { errEl.textContent = error.message || 'Link failed.'; errEl.style.display = 'block'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Link'; }
      return;
    }

    showToast('Branch linked! Owner must re-login to see the switcher.', 'green');
    aNAv('a-gymdetail');
  });

  // Unlink buttons
  document.querySelectorAll('[data-unlink-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const linkId = btn.dataset.unlinkId;
      const linkName = btn.dataset.unlinkName || 'this gym';

      const ok = await showConfirm({
        title: 'Unlink branch?',
        message: `"${linkName}" will be removed from this owner. They will lose access to that branch.`,
        confirmLabel: 'Unlink',
        confirmVariant: 'danger',
      });
      if (!ok) return;

      btn.disabled = true; btn.textContent = 'Removing...';

      const { error } = await supabase
        .from('gym_users')
        .delete()
        .eq('id', linkId);

      if (error) {
        showToast(error.message || 'Unlink failed.', 'red');
        btn.disabled = false; btn.textContent = 'Unlink';
        return;
      }

      showToast(`"${linkName}" unlinked.`, 'green');
      aNAv('a-gymdetail');
    });
  });
}

function tAgo(ds) {
  if(!ds)return'—';
  const h=Math.floor((Date.now()-new Date(ds))/3600000);
  if(h<1)return'just now'; if(h<24)return`${h}h ago`;
  return`${Math.floor(h/24)}d ago`;
}

function demoGyms() {
  return [
    {id:'g1',gym_code:'FLY001',name:'Iron Peak Gym',      owner_name:'Vikram Singh',  city:'Bengaluru',total_members:42,payment_due:7, is_active:true, created_at:'2024-08-15'},
    {id:'g2',gym_code:'FLY002',name:'FitZone Gym',        owner_name:'Pradeep Iyer',  city:'Chennai',  total_members:67,payment_due:4, is_active:true, created_at:'2024-09-01'},
    {id:'g3',gym_code:'FLY003',name:'PowerHouse Fitness', owner_name:'Anita Sharma',  city:'Mumbai',   total_members:89,payment_due:12,is_active:true, created_at:'2024-10-20'},
    {id:'g4',gym_code:'FLY004',name:'BodyBuilders Gym',   owner_name:'Ravi Teja',     city:'Hyderabad',total_members:55,payment_due:3, is_active:true, created_at:'2024-11-05'},
    {id:'g5',gym_code:'FLY005',name:'GainZone',           owner_name:'Sunitha Menon', city:'Kochi',    total_members:38,payment_due:8, is_active:true, created_at:'2025-01-10'},
    {id:'g6',gym_code:'FLY006',name:'Muscle Factory',     owner_name:'Arjun Patel',   city:'Pune',     total_members:27,payment_due:2, is_active:false,created_at:'2025-03-01'},
  ];
}

function demoActivity() {
  const n=Date.now();
  return [
    {id:1,action:'member_added',   description:'Iron Peak Gym — New member added: Rahul Sharma',   gyms:{name:'Iron Peak Gym'},     created_at:new Date(n-7200000).toISOString()},
    {id:2,action:'plan_renewed',   description:'FitZone Gym — Priya Nair renewed Yearly plan',      gyms:{name:'FitZone Gym'},       created_at:new Date(n-18000000).toISOString()},
    {id:3,action:'reminder_sent',  description:'PowerHouse Fitness — 3 payment reminders sent',     gyms:{name:'PowerHouse Fitness'},created_at:new Date(n-28800000).toISOString()},
    {id:4,action:'gym_onboarded',  description:'Admin — New gym onboarded: Muscle Factory, Pune',   gyms:null,                       created_at:new Date(n-86400000).toISOString()},
    {id:5,action:'member_deleted', description:'BodyBuilders Gym — Member Suresh Kumar deleted',    gyms:{name:'BodyBuilders Gym'},  created_at:new Date(n-172800000).toISOString()},
    {id:6,action:'credentials_gen',description:'Admin — Credentials generated for GainZone',        gyms:null,                       created_at:new Date(n-259200000).toISOString()},
  ];
}

function ensureStyles() {
  if (document.getElementById('dash-styles')) return;
  const s=document.createElement('style'); s.id='dash-styles';
  s.textContent=`
    .app-layout{display:flex;min-height:100vh;}
    .sidebar{width:var(--sidebar-w);background:var(--panel);border-right:1px solid var(--border);
      display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh;z-index:100;overflow-y:auto;}
    .sidebar-logo{padding:22px 18px;border-bottom:1px solid var(--border);}
    .sidebar-identity{padding:14px 18px;border-bottom:1px solid var(--border);}
    .sidebar-identity-label{font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted2);margin-bottom:3px;}
    .sidebar-identity-name{font-family:var(--font-head);font-size:14px;font-weight:700;color:var(--white);}
    .sidebar-identity-code{font-size:10px;color:var(--muted2);letter-spacing:0.08em;margin-top:1px;}
    .sidebar-badge{display:inline-block;margin-top:6px;font-size:9px;padding:2px 8px;
      background:var(--blue-glow2);color:var(--blue-light);border-radius:20px;
      letter-spacing:0.07em;font-family:var(--font-head);font-weight:700;}
    .sidebar-badge-admin{background:rgba(255,176,32,0.1);color:var(--amber);}
    .sidebar-nav{flex:1;padding:10px 0;}
    .nav-section-label{padding:14px 18px 5px;font-size:10px;letter-spacing:0.14em;
      text-transform:uppercase;color:var(--muted2);font-family:var(--font-head);}
    .nav-item{display:flex;align-items:center;gap:11px;padding:10px 18px;cursor:pointer;
      font-size:13px;color:var(--muted);border-left:2px solid transparent;transition:all 0.15s;margin:1px 0;}
    .nav-item:hover{color:var(--white);background:rgba(42,143,255,0.04);}
    .nav-item.active{color:var(--white);background:rgba(42,143,255,0.07);border-left-color:var(--blue);}
    .nav-item.active .nav-icon{color:var(--blue);}
    .nav-icon{display:flex;align-items:center;flex-shrink:0;opacity:0.8;}
    .sidebar-footer{padding:14px 18px;border-top:1px solid var(--border);}
    .sidebar-logout{display:flex;align-items:center;gap:10px;color:var(--muted);
      background:none;border:none;cursor:pointer;font-size:13px;font-family:var(--font-body);transition:color 0.2s;}
    .sidebar-logout:hover{color:var(--red);}
    .app-main{margin-left:var(--sidebar-w);flex:1;display:flex;flex-direction:column;min-height:100vh;}
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:0 32px;
      height:var(--topbar-h);border-bottom:1px solid var(--border);background:var(--bg);
      position:sticky;top:0;z-index:50;}
    .topbar-title{font-family:var(--font-head);font-size:17px;font-weight:700;}
    .topbar-right{display:flex;align-items:center;gap:14px;}
    .topbar-date{font-size:12px;color:var(--muted);font-family:var(--font-head);}
    .topbar-avatar{width:34px;height:34px;border-radius:50%;background:var(--blue);
      display:flex;align-items:center;justify-content:center;
      font-family:var(--font-head);font-weight:700;font-size:12px;color:#fff;}
    .app-content{flex:1;overflow-y:auto;}
    .content-inner{padding:28px 32px;max-width:1400px;}
    .loading-inline{padding:80px;display:flex;align-items:center;justify-content:center;}
    .cred-row-item{display:flex;align-items:center;justify-content:space-between;
      padding:8px 0;border-bottom:1px solid rgba(30,45,69,0.4);}
    .cred-row-item:last-of-type{border-bottom:none;}
    .cred-key{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted2);font-family:var(--font-head);}
    .cred-val{font-family:monospace;color:var(--green);font-size:13px;margin:0 8px;flex:1;}

    /* Bulk Entry */
    .be-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}
    .be-field{display:flex;flex-direction:column;}
    .be-field label{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted2);margin-bottom:4px;font-family:var(--font-head);}
    .be-field input,.be-field select{height:38px;}

    /* ── Mobile sidebar ── */
    .hamburger-btn{
      display:none;flex-direction:column;justify-content:center;gap:5px;
      background:none;border:none;cursor:pointer;padding:6px;margin-right:8px;
      width:36px;height:36px;flex-shrink:0;
    }
    .hamburger-btn span{
      display:block;width:22px;height:2px;background:var(--white);
      border-radius:2px;transition:all 0.25s;transform-origin:center;
    }
    .hamburger-btn.open span:nth-child(1){transform:translateY(7px) rotate(45deg);}
    .hamburger-btn.open span:nth-child(2){opacity:0;transform:scaleX(0);}
    .hamburger-btn.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg);}
    .sidebar-overlay{
      display:none;position:fixed;inset:0;background:rgba(5,8,14,0.75);
      z-index:99; /* NO backdrop-filter — Android Chrome touch freeze bug */
    }
    .sidebar-overlay.active{display:block;touch-action:none;}
    @media (max-width:768px) {
      .hamburger-btn{display:flex;}
      .topbar{padding:0 16px;}
      .topbar-date{display:none;}
      .content-inner{padding:18px 14px;}
      .grid-2,.grid-3,.grid-4{grid-template-columns:1fr;}
      .app-main{margin-left:0;}
      .sidebar{
        transform:translateX(-100%);
        transition:transform 0.28s cubic-bezier(0.4,0,0.2,1);
        z-index:100;
      }
      .sidebar.sidebar-open{transform:translateX(0);}
      .section-header{flex-direction:column;gap:10px;}
      table{font-size:12px;}
      th,td{padding:8px 10px;}
    }
  `;
  document.head.appendChild(s);
}
