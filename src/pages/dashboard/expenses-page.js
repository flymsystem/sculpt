import { S } from './state.js';
import { escHtml, escAttr, showSectionLoading, todayLocalISO, setFieldError, clearFieldError } from './helpers.js';
import { getExpenses, addExpense, updateExpense, deleteExpense, carryForwardExpenses, EXPENSE_CATEGORIES, getCategoryIcon } from '../../lib/expenses.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal, bindModalCancel } from '../../components/modal.js';
import { hasAccess, can } from '../../lib/permissions.js';

function renderExpenses(c) {
  const gymId = S.gym?.id;
  const role = S.role || 'owner';
  const expPerm = can(role, 'expenses');
  const canEdit = expPerm === 'full' || expPerm === true;
  const canAdd = !!expPerm; // 'add' or 'full' or true

  const now = new Date();
  let currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  function monthLabel(m) { const [y,mo]=m.split('-'); return new Date(parseInt(y),parseInt(mo)-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'}); }
  function prevMo(m) { const [y,mo]=m.split('-'); const d=new Date(parseInt(y),parseInt(mo)-2,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  function nextMo(m) { const [y,mo]=m.split('-'); const d=new Date(parseInt(y),parseInt(mo),1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

  showSectionLoading(c, 'Expenses');

  let pageExpenses = [];

  async function render() {
    try { pageExpenses = await getExpenses(gymId, currentMonth); } catch(e) { pageExpenses = []; }
    const total = pageExpenses.reduce((s,e) => s + parseFloat(e.amount), 0);

    c.innerHTML = `<div class="content-inner page-enter">
      <div class="page-header"><div class="page-header-left"><div class="page-title">Expenses</div></div></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <button id="exp-prev" class="btn btn-ghost btn-sm">\u25C0</button>
          <span style="font-size:var(--text-lg);font-weight:600;color:var(--text-primary);min-width:160px;text-align:center;">${monthLabel(currentMonth)}</span>
          <button id="exp-next" class="btn btn-ghost btn-sm">\u25B6</button>
        </div>
        ${canAdd ? `<button id="exp-add-btn" class="btn btn-primary btn-sm">+ Add Expense</button>` : ''}
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:var(--text-md);color:var(--text-secondary);">Total this month</span>
        <span style="font-size:var(--text-2xl);font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums;">\u20B9${total.toLocaleString('en-IN')}</span>
      </div>
      ${pageExpenses.length === 0 && canEdit ? `<div id="exp-carry-banner" style="background:var(--brand-fade);border:1px solid var(--brand-fade-strong);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span style="font-size:var(--text-sm);color:var(--brand-text);">No expenses yet. Copy recurring items from ${monthLabel(prevMo(currentMonth))}?</span>
        <button id="exp-carry-btn" class="btn btn-sm btn-primary">Copy</button>
      </div>` : ''}
      <div style="background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);overflow:hidden;">
        <div style="overflow-x:auto;">
          <table class="members-table">
            <thead><tr><th style="width:40px;"></th><th>Category</th><th style="text-align:right;">Amount</th><th class="hide-mobile">Description</th><th>Date</th>${canEdit ? `<th style="width:90px;">Actions</th>` : ''}</tr></thead>
            <tbody>${pageExpenses.length===0
              ? `<tr><td colspan="${canEdit?6:5}" style="text-align:center;padding:40px;color:var(--text-tertiary);">No expenses this month</td></tr>`
              : pageExpenses.map(e => {
                const icon = getCategoryIcon(e.category);
                const d = new Date(e.expense_date+'T00:00:00');
                const fmtD = d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
                return `<tr>
                  <td style="font-size:18px;text-align:center;">${icon}</td>
                  <td style="font-weight:500;">${escHtml(e.category)}${e.is_recurring?' <span style="font-size:10px;color:var(--text-quaternary);">\u21BB</span>':''}</td>
                  <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">\u20B9${parseFloat(e.amount).toLocaleString('en-IN')}</td>
                  <td class="hide-mobile" style="color:var(--text-secondary);">${escHtml(e.description)||'\u2014'}</td>
                  <td style="color:var(--text-tertiary);">${fmtD}</td>
                  ${canEdit ? `<td><div style="display:flex;gap:6px;">
                    <button class="btn btn-ghost btn-sm" onclick="window._editExpense('${escAttr(e.id)}')" style="padding:4px 8px;">\u270F\uFE0F</button>
                    <button class="btn btn-ghost btn-sm" onclick="window._delExpense('${escAttr(e.id)}')" style="padding:4px 8px;color:var(--red);">\uD83D\uDDD1</button>
                  </div></td>` : ''}
                </tr>`;}).join('')}
            </tbody>
            ${pageExpenses.length>0?`<tfoot><tr style="border-top:2px solid var(--border-strong);"><td colspan="2" style="font-weight:600;text-align:right;padding-right:14px;">Total</td><td style="text-align:right;font-weight:700;font-size:var(--text-lg);font-variant-numeric:tabular-nums;">\u20B9${total.toLocaleString('en-IN')}</td><td class="hide-mobile"></td><td></td>${canEdit?'<td></td>':''}</tr></tfoot>`:''}
          </table>
        </div>
      </div>
    </div>`;

    document.getElementById('exp-prev')?.addEventListener('click', () => { currentMonth = prevMo(currentMonth); render(); });
    document.getElementById('exp-next')?.addEventListener('click', () => { currentMonth = nextMo(currentMonth); render(); });
    document.getElementById('exp-add-btn')?.addEventListener('click', () => openExpenseModal());
    document.getElementById('exp-carry-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('exp-carry-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Copying\u2026'; }
      try {
        const existing = await getExpenses(gymId, currentMonth);
        if (existing && existing.length > 0) {
          showToast('This month already has expenses', 'amber');
          if (btn) { btn.disabled = false; btn.textContent = 'Copy'; }
          return;
        }
        await carryForwardExpenses(gymId, prevMo(currentMonth), currentMonth);
        showToast('Recurring expenses copied!','green');
        render();
      } catch(e) { showToast(e.message||'Copy failed','red'); if (btn) { btn.disabled = false; btn.textContent = 'Copy'; } }
    });
  }

  function openExpenseModal(existing=null) {
    // Staff can only add, not edit
    if (existing && !canEdit) {
      showToast('You can only add expenses, not edit them', 'amber');
      return;
    }
    const isEdit = !!existing;
    const todayISO = todayLocalISO();
    const catOpts = EXPENSE_CATEGORIES.map(cat => `<option value="${cat.label}" ${existing?.category===cat.label?'selected':''}>${cat.icon} ${cat.label}</option>`).join('');
    openModal({
      title: isEdit?'Edit Expense':'Add Expense',
      body: `<div class="modal-form">
        <div class="form-group"><label class="form-label">Category</label><select class="form-input" id="exp-cat">${catOpts}</select></div>
        <div class="form-group"><label class="form-label">Description <span style="color:var(--text-quaternary);">(optional)</span></label><input class="form-input" id="exp-desc" value="${existing?.description||''}" placeholder="e.g. EB bill"></div>
        <div class="form-group"><label class="form-label">Amount (\u20B9)</label><input class="form-input" id="exp-amt" type="number" min="0" value="${existing?existing.amount:''}" placeholder="0"></div>
        <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="exp-date" type="date" value="${existing?.expense_date||todayISO}"></div>
        <div class="form-group" style="flex-direction:row;align-items:center;gap:10px;">
          <label class="sculpt-switch"><input type="checkbox" id="exp-recurring" ${existing?.is_recurring?'checked':''}><span class="sculpt-switch-slider"></span></label>
          <span style="font-size:var(--text-sm);color:var(--text-secondary);">Recurring (copied monthly)</span>
        </div>
      </div>`,
      footer: `<button class="btn btn-ghost" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="exp-save-btn">${isEdit?'Save':'Add Expense'}</button>`,
      onOpen() {
        bindModalCancel();
        // Clear a field's error the moment the user starts fixing it,
        // rather than leaving it up until the next save attempt.
        ['exp-cat', 'exp-amt', 'exp-date'].forEach((id) => {
          const el = document.getElementById(id);
          el?.addEventListener('input', () => clearFieldError(el));
          el?.addEventListener('change', () => clearFieldError(el));
        });
        document.getElementById('exp-save-btn')?.addEventListener('click', async () => {
          const btn = document.getElementById('exp-save-btn');
          const catEl = document.getElementById('exp-cat');
          const amtEl = document.getElementById('exp-amt');
          const dateEl = document.getElementById('exp-date');
          const catVal = catEl?.value;
          const amtVal = amtEl?.value;
          const dateVal = dateEl?.value;
          [catEl, amtEl, dateEl].forEach(clearFieldError);
          // A toast alone appears away from the field and auto-dismisses in
          // a few seconds — easy to miss if you're looking at the form, and
          // invisible to a screen reader once it's gone. setFieldError()
          // persists at the field until the user fixes it (AUDIT.md C8).
          if (!catVal) { setFieldError(catEl, 'Please select a category.'); catEl?.focus(); return; }
          const parsedAmt = parseFloat((amtVal||'').replace(/,/g,''));
          if (!amtVal || isNaN(parsedAmt) || parsedAmt < 0) { setFieldError(amtEl, 'Enter a valid amount.'); amtEl?.focus(); return; }
          if (!dateVal) { setFieldError(dateEl, 'Please select a date.'); dateEl?.focus(); return; }

          if (btn) { btn.disabled=true; btn.textContent='Saving\u2026'; }
          try {
            const data = { category:catVal, description:document.getElementById('exp-desc')?.value,
              amount:amtVal, expenseDate:dateVal,
              isRecurring:document.getElementById('exp-recurring')?.checked };
            if (isEdit) await updateExpense(existing.id,gymId,data); else await addExpense(gymId,data);
            closeModal(); showToast(isEdit?'Expense updated':'Expense added','green'); render();
          } catch(e) { showToast(e.message||'Save failed','red'); if(btn){btn.disabled=false;btn.textContent=isEdit?'Save':'Add Expense';} }
        });
      }
    });
  }

  // Only register edit/delete globals for owners
  if (canEdit) {
    window._editExpense = (id) => { const e=pageExpenses.find(x=>String(x.id)===String(id)); if(e) openExpenseModal(e); };
    window._delExpense = async (id) => {
      const e=pageExpenses.find(x=>String(x.id)===String(id)); if(!e) return;
      openModal({ title:'Confirm Delete',
        body:`<div class="modal-form"><p style="color:var(--text-secondary);">Delete "${escHtml(e.category)}${e.description?' \u2014 '+escHtml(e.description):''}" (\u20B9${parseFloat(e.amount).toLocaleString('en-IN')})?</p></div>`,
        footer:`<button class="btn btn-ghost" data-modal-cancel>Cancel</button><button class="btn btn-danger-soft" id="exp-del-confirm">Delete</button>`,
        onOpen() { bindModalCancel();
          document.getElementById('exp-del-confirm')?.addEventListener('click', async () => {
            try { await deleteExpense(id,gymId); closeModal(); showToast('Expense deleted','green'); render(); }
            catch(e2) { showToast(e2.message||'Delete failed','red'); }
          });
        }
      });
    };
  }
  render();
}

export { renderExpenses };
