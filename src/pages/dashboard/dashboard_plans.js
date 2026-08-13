import { S } from './state.js';
import { escHtml, parsePlanData } from './helpers.js';
import { addPlan, updatePlan, deletePlan } from '../../lib/plans.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal, bindModalCancel, modalFooter } from '../../components/modal.js';

let _nav;
export function setNavHandler(fn) { _nav = fn; }

function renderPlans(c) {
  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Plan Settings</div>
        <div class="page-sub">${S.plans.length} plan${S.plans.length!==1?'s':''} · Custom durations, pricing and add-ons</div>
      </div>
      <button class="btn btn-primary" id="btn-addplan">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Add Plan
      </button>
    </div>
    <div class="grid-3" id="plans-grid">
      ${S.plans.map(renderPlanCard).join('')}
      ${!S.plans.length ? `<div class="empty-state" style="grid-column:1/-1;padding:60px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">📋</div>
        <div style="font-weight:600;margin-bottom:8px;color:var(--text-primary);">No plans yet</div>
        <p>Create your first membership plan</p>
      </div>` : ''}
    </div>
  </div>`;
  document.getElementById('btn-addplan').addEventListener('click', openAddPlanModal);
  window._editPlan = id => openEditPlanModal(id);
  window._delPlan  = id => confirmDelPlan(id);
  window._dupPlan  = id => duplicatePlan(id);
}


// Parse add-ons stored on a member (member_addons JSON column)

// Total price = plan base price + member's own chosen add-ons


function renderPlanCard(p) {
  const pd    = parsePlanData(p);
  const feats = pd.featuresList ? pd.featuresList.split(',').map(f=>f.trim()).filter(Boolean) : [];
  const mc = S.members.filter(m =>
    m.plan_id ? String(m.plan_id) === String(p.id) : (m.plan_name||m.plan) === p.name
  ).length;
  return `<div class="plan-card">
    <div class="plan-card-name">${escHtml(p.name)}</div>
    <div class="plan-card-duration">${p.duration_months||p.duration} month${(p.duration_months||p.duration)>1?'s':''}</div>
    <div class="plan-card-price">₹${Number(p.price).toLocaleString('en-IN')}<span>/plan</span></div>
    ${feats.length?`<div class="plan-card-features">${feats.map(f=>`<div class="plan-feat-tag">✓ ${escHtml(f)}</div>`).join('')}</div>`:''}
    <div class="plan-card-footer">
      <span style="font-size:11px;color:var(--muted);">${mc} member${mc!==1?'s':''}</span>
      <div class="action-btns">
        <button class="btn btn-ghost btn-sm" onclick="window._editPlan('${p.id}')">Edit</button>
        <button class="btn btn-danger-soft btn-sm" onclick="window._delPlan('${p.id}')">Delete</button>
      </div>
    </div>
  </div>`;
}

function buildPlanModalBody(p) {
  const pd = p ? parsePlanData(p) : { featuresList:'' };
  const FEATURE_PRESETS = ['Unlimited access','Locker room','Personal trainer','Steam room','Cardio','Zumba','Swimming','Parking','WiFi','Towel service'];
  const existingFeats = pd.featuresList ? pd.featuresList.split(',').map(f=>f.trim()).filter(Boolean) : [];
  return `
    <div class="form-group"><label class="form-label">Plan Name *</label>
      <input class="form-input" id="p-name" placeholder="e.g. 3 Month Plan" value="${p?escHtml(p.name):''}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Duration (months) *</label>
        <input class="form-input" id="p-dur" type="number" min="1" max="60" placeholder="3" value="${p?(p.duration_months||p.duration):''}"></div>
      <div class="form-group"><label class="form-label">Base Price (₹) *</label>
        <input class="form-input" id="p-price" type="number" min="0" placeholder="2500" value="${p?p.price:''}"></div>
    </div>

    <div class="form-group">
      <label class="form-label">Included Features</label>
      <div id="feat-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        ${existingFeats.map(f=>`<span class="feat-tag selected" data-feat="${escHtml(f)}">${escHtml(f)} ✕</span>`).join('')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        ${FEATURE_PRESETS.map(f=>`<span class="feat-preset ${existingFeats.includes(f)?'used':''}" data-feat="${escHtml(f)}">${escHtml(f)}</span>`).join('')}
      </div>
      <div style="display:flex;gap:8px;">
        <input class="form-input" id="p-feat-custom" placeholder="Add custom feature…" style="flex:1;">
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-feat">+ Add</button>
      </div>
      <input type="hidden" id="p-feat">
    </div>
    <div id="p-error" style="display:none;color:var(--red);font-size:13px;
         background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);
         padding:10px;border-radius:2px;margin-top:4px;"></div>
  `;
}

function bindPlanModalFeatures() {
  function getTagEls() { return [...document.querySelectorAll('#feat-tags .feat-tag')]; }
  function syncHidden() {
    document.getElementById('p-feat').value = getTagEls().map(el=>el.dataset.feat).join(',');
  }
  function addFeat(name) {
    name = name.trim();
    if (!name) return;
    if (getTagEls().some(el=>el.dataset.feat.toLowerCase()===name.toLowerCase())) return;
    const tag = document.createElement('span');
    tag.className = 'feat-tag selected';
    tag.dataset.feat = name;
    tag.textContent = name + ' ✕';
    tag.addEventListener('click', () => { tag.remove(); syncHidden(); refreshPresets(); });
    document.getElementById('feat-tags').appendChild(tag);
    syncHidden();
    refreshPresets();
  }
  function refreshPresets() {
    const active = getTagEls().map(el=>el.dataset.feat.toLowerCase());
    document.querySelectorAll('.feat-preset').forEach(el => {
      el.classList.toggle('used', active.includes(el.dataset.feat.toLowerCase()));
    });
  }
  // Existing tags clickable to remove
  getTagEls().forEach(tag => tag.addEventListener('click', () => { tag.remove(); syncHidden(); refreshPresets(); }));
  // Preset chips
  document.querySelectorAll('.feat-preset').forEach(el => {
    el.addEventListener('click', () => { addFeat(el.dataset.feat); });
  });
  // Custom add
  document.getElementById('btn-add-feat').addEventListener('click', () => {
    const inp = document.getElementById('p-feat-custom');
    addFeat(inp.value); inp.value = '';
  });
  document.getElementById('p-feat-custom').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const inp=e.target; addFeat(inp.value); inp.value=''; }
  });
  syncHidden();
}

function collectPlanData() {
  const name  = document.getElementById('p-name')?.value.trim();
  const dur   = parseInt(document.getElementById('p-dur')?.value);
  const price = parseFloat(document.getElementById('p-price')?.value);
  const featuresList = document.getElementById('p-feat')?.value.trim() || '';
  const features = JSON.stringify({ featuresList });
  return { name, dur, price, featuresList, features };
}


function openAddPlanModal() {
  openModal({
    title: 'Add Membership Plan',
    size: 'lg',
    mobileCompact: true,
    body: buildPlanModalBody(null),
    footer: modalFooter('Cancel', 'Save Plan →', 'btn-saveplan'),
    onOpen: () => {
      bindModalCancel();
      bindPlanModalFeatures();
      document.getElementById('btn-saveplan').addEventListener('click', async () => {
        const { name, dur, price, features } = collectPlanData();
        const errEl = document.getElementById('p-error');
        errEl.style.display = 'none';
        if (!name) { errEl.textContent='Plan name is required.'; errEl.style.display='block'; return; }
        if (!dur)  { errEl.textContent='Duration is required.';  errEl.style.display='block'; return; }
        if (!price && price !== 0) { errEl.textContent='Base price is required.'; errEl.style.display='block'; return; }
        if (price <= 0) { errEl.textContent='Price must be greater than ₹0.'; errEl.style.display='block'; return; }
        try {
          const data = { name, durationMonths:dur, price:price, features };
          const saved = S.gym?.id ? await addPlan(S.gym.id, data)
            : { id:Date.now().toString(), name, duration_months:dur, price:price, features };
          S.plans.push(saved);
          closeModal(); _nav('plans'); showToast(`Plan "${name}" added!`,'green');
        } catch(err) { errEl.textContent=err.message; errEl.style.display='block'; }
      });
    }
  });
}

function openEditPlanModal(id) {
  const p = S.plans.find(x=>String(x.id)===String(id));
  if (!p) return;
  openModal({
    title: `Edit Plan — ${escHtml(p.name)}`,
    size: 'lg',
    mobileCompact: true,
    body: buildPlanModalBody(p),
    footer: modalFooter('Cancel', 'Save Changes →', 'btn-saveplan'),
    onOpen: () => {
      bindModalCancel();
      bindPlanModalFeatures();
      document.getElementById('btn-saveplan').addEventListener('click', async () => {
        const { name, dur, price, features } = collectPlanData();
        const errEl = document.getElementById('p-error');
        errEl.style.display = 'none';
        if (!name) { errEl.textContent='Plan name is required.'; errEl.style.display='block'; return; }
        if (!dur)  { errEl.textContent='Duration is required.';  errEl.style.display='block'; return; }
        if (!price || price <= 0) { errEl.textContent='Price must be greater than ₹0.'; errEl.style.display='block'; return; }
        try {
          const data={name,durationMonths:dur,price:price,features};
          const saved=S.gym?.id?await updatePlan(id,S.gym.id,data):{...p,name,duration_months:dur,price:price,features};
          const idx=S.plans.findIndex(x=>String(x.id)===String(id));
          if(idx>-1)S.plans[idx]=saved;
          closeModal();_nav('plans');showToast('Plan updated!','green');
        } catch(err){errEl.textContent=err.message;errEl.style.display='block';}
      });
    }
  });
}

function confirmDelPlan(id) {
  const p = S.plans.find(x => String(x.id) === String(id));
  if (!p) return;
  const memberCount = S.members.filter(m =>
    m.plan_id ? String(m.plan_id) === String(p.id) : (m.plan_name || m.plan) === p.name
  ).length;

  openModal({
    title: 'Delete Plan',
    size: 'sm',
    body: `
      <div style="text-align:center;padding:8px 0 4px;">
        <div style="font-size:36px;margin-bottom:14px;">${memberCount > 0 ? '🚫' : '⚠️'}</div>
        <div style="font-size:15px;font-weight:600;color:var(--white);margin-bottom:8px;">Delete "${escHtml(p.name)}"?</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">
          ${memberCount > 0
            ? `<strong style="color:var(--red);">${memberCount} active member${memberCount !== 1 ? 's' : ''}</strong> are still on this plan.<br><br>Please reassign or remove them before deleting this plan.`
            : 'This plan has no active members and can be safely deleted.'}
        </div>
      </div>`,
    footer: memberCount > 0
      ? `<button class="btn btn-ghost" id="modal-cancel" style="flex:1;">OK, Got it</button>`
      : `<button class="btn btn-ghost" id="modal-cancel" style="flex:1;">Cancel</button>
         <button class="btn btn-danger-soft" id="btn-confirm-del-plan" style="flex:1;">Delete Plan</button>`,
    onOpen: () => {
      bindModalCancel();
      document.getElementById('btn-confirm-del-plan')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-confirm-del-plan');
        btn.disabled = true; btn.textContent = 'Deleting…';
        try {
          if (S.gym?.id) await deletePlan(id, S.gym.id);
          S.plans = S.plans.filter(x => String(x.id) !== String(id));
          closeModal();
          _nav('plans');
          showToast('Plan deleted', 'red');
        } catch (err) {
          closeModal();
          showToast(err.message || 'Delete failed', 'red');
        }
      });
    }
  });
}

async function duplicatePlan(id) {
  const p = S.plans.find(x => String(x.id) === String(id));
  if (!p) return;
  const pd = parsePlanData(p);
  const data = {
    name: p.name + ' (Copy)',
    durationMonths: p.duration_months || p.duration,
    price: p.price,
    features: JSON.stringify({ featuresList: pd.featuresList }),
  };
  try {
    const saved = S.gym?.id ? await addPlan(S.gym.id, data)
      : { id: Date.now().toString(), name: data.name, duration_months: data.durationMonths, price: data.price, features: data.features };
    S.plans.push(saved);
    _nav('plans');
    showToast(`"${p.name}" duplicated!`, 'green');
  } catch(err) {
    showToast(err.message || 'Duplicate failed', 'red');
  }
}


function renderPlansShowcase(c) {
  const plans = S.plans || [];
  const addons = S.addonTemplates || [];
  const gymName = S.gym?.name || 'Our Gym';

  function perMonth(p) { const dur=p.duration_months||1; if(dur===1) return null; return Math.round(parseFloat(p.price)/dur); }

  c.innerHTML = `<div class="content-inner page-enter">
    <div style="text-align:center;padding:32px 20px 24px;">
      ${S.gym?.logo_url ? `<img src="${S.gym.logo_url}" style="width:56px;height:56px;border-radius:12px;object-fit:cover;margin-bottom:12px;">` : ''}
      <div style="font-size:var(--text-3xl);font-weight:700;color:var(--text-primary);letter-spacing:var(--tracking-tight);">${gymName}</div>
      <div style="font-size:var(--text-md);color:var(--text-tertiary);margin-top:6px;">Membership Plans</div>
    </div>
    <div class="grid-3" style="margin-bottom:32px;">
      ${plans.length===0
        ? `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">🏷️</div><div>No plans configured yet. Add plans in Gym Settings.</div></div>`
        : plans.map(p => {
          const price=parseFloat(p.price); const dur=p.duration_months||1; const pm=perMonth(p);
          const pd=parsePlanData(p); const feats=pd.featuresList?pd.featuresList.split(',').map(f=>f.trim()).filter(Boolean):[];
          const featured=p.is_featured;
          return `<div style="background:var(--surface-1);border:${featured?'2px solid var(--brand)':'1px solid var(--border-subtle)'};border-radius:var(--radius-lg);padding:28px 24px;text-align:center;position:relative;box-shadow:${featured?'var(--shadow-md)':'var(--shadow-sm)'};${featured?'transform:scale(1.03);':''}">
            ${featured?`<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--brand);color:#fff;padding:3px 14px;border-radius:var(--radius-pill);font-size:var(--text-xs);font-weight:600;">POPULAR</div>`:''}
            <div style="font-size:var(--text-lg);font-weight:600;color:var(--text-primary);margin-bottom:4px;">${escHtml(p.name)}</div>
            <div style="font-size:var(--text-sm);color:var(--text-tertiary);margin-bottom:16px;">${dur} month${dur>1?'s':''}</div>
            <div style="font-size:var(--text-4xl);font-weight:800;color:var(--text-primary);letter-spacing:var(--tracking-tight);font-variant-numeric:tabular-nums;">₹${price.toLocaleString('en-IN')}</div>
            ${pm?`<div style="font-size:var(--text-sm);color:var(--brand-text);margin-top:4px;">₹${pm.toLocaleString('en-IN')}/month</div>`:''}
            ${feats.length>0?`<div style="margin-top:20px;text-align:left;">${feats.map(f=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);"><span style="color:var(--green);font-size:14px;">✓</span><span style="font-size:var(--text-sm);color:var(--text-secondary);">${f}</span></div>`).join('')}</div>`:''}
          </div>`;
        }).join('')}
    </div>
    ${addons.length>0?`<div style="text-align:center;margin-bottom:16px;"><div style="font-size:var(--text-lg);font-weight:600;color:var(--text-primary);">Available Add-ons</div></div>
      <div style="max-width:480px;margin:0 auto;">${addons.map(a=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:var(--radius-md);margin-bottom:8px;">
        <span style="font-weight:500;color:var(--text-primary);">${a.name}</span>
        <div style="text-align:right;"><span style="font-weight:600;color:var(--brand-text);font-variant-numeric:tabular-nums;">+₹${parseFloat(a.default_price).toLocaleString('en-IN')}</span>
        ${a.is_one_time?'<div style="font-size:var(--text-xs);color:var(--text-quaternary);">one-time</div>':'<div style="font-size:var(--text-xs);color:var(--text-quaternary);">/month</div>'}</div>
      </div>`).join('')}</div>`:''}
    <div style="text-align:center;padding:32px 0;color:var(--text-quaternary);font-size:var(--text-xs);">Powered by Flym</div>
  </div>`;
}



export { renderPlans, renderPlansShowcase };
