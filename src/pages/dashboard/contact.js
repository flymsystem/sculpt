import { S } from './state.js';
import { escHtml } from './helpers.js';
import { supabase } from '../../lib/supabase.js';

function renderContact(c) {
  const gymName   = S.gym?.name       || '';
  const ownerName = S.gym?.owner_name || '';

  c.innerHTML = `<div class="content-inner page-enter">
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Contact Us</div>
        <div class="page-sub">We're here to help — reach us anytime</div>
      </div>
    </div>

    <div class="settings-grid" style="align-items:start;">

      <!-- Message form -->
      <div class="settings-card">
        <div class="settings-card-title">Send a Message</div>
        <div class="form-group">
          <label class="form-label">Your Name</label>
          <input class="form-input" id="ct-name" value="${escHtml(ownerName)}" placeholder="Your name">
        </div>
        <div class="form-group">
          <label class="form-label">Subject</label>
          <select class="form-input" id="ct-subject">
            <option>General Enquiry</option>
            <option>Technical Issue / Bug Report</option>
            <option>Billing &amp; Subscription</option>
            <option>Data Recovery Request</option>
            <option>Feature Request</option>
            <option>Account Help</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Message</label>
          <textarea class="form-input" id="ct-message" rows="5" style="resize:vertical;" placeholder="Describe your issue or question…"></textarea>
        </div>
        <div id="ct-error" style="display:none;color:var(--red);font-size:13px;margin-bottom:12px;
          padding:10px 14px;background:var(--red-fade);border-radius:var(--radius-md);
          border:1px solid var(--red-strong);"></div>
        <button class="btn btn-primary btn-full" id="btn-ct-send">Send Message →</button>
        <div id="ct-success" style="display:none;margin-top:14px;padding:12px 14px;
          background:var(--green-fade);border:1px solid var(--green-strong);
          border-radius:var(--radius-md);font-size:13px;color:var(--green);line-height:1.6;">
          ✓ Message sent! We'll reply within 24 hours.
        </div>
      </div>

      <!-- Info + quick actions -->
      <div style="display:flex;flex-direction:column;gap:var(--space-4);">
        <div class="settings-card">
          <div class="settings-card-title">Get in Touch</div>
          <div style="display:flex;flex-direction:column;gap:18px;">
            ${[
              ['WhatsApp Support', '+91 99457 91450', 'https://wa.me/919945791450', 'var(--green)'],
              ['Response Time',   'Within 24 hours on business days', null, null],
              ['Support Hours',   'Mon–Sat, 9 AM – 6 PM IST', null, null],
            ].map(([label, value, href, color]) => `
              <div style="display:flex;align-items:flex-start;gap:14px;">
                <div style="width:36px;height:36px;border-radius:var(--radius-md);
                  background:var(--surface-2);border:1px solid var(--border-subtle);
                  display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <div>
                  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;
                    color:var(--text-quaternary);margin-bottom:3px;">${label}</div>
                  ${href
                    ? `<a href="${href}" target="_blank" style="color:${color};font-size:14px;font-weight:500;text-decoration:none;">${value}</a>`
                    : `<div style="font-size:13px;color:var(--text-secondary);">${value}</div>`}
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">Quick Actions</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <a href="https://wa.me/919945791450" target="_blank" class="btn"
              style="text-decoration:none;justify-content:center;background:var(--green-fade);
                color:var(--green);border:1px solid var(--green-strong);">
              Chat on WhatsApp
            </a>
            <button class="btn btn-ghost" id="wa-bug-btn">Report a Bug</button>
            <button class="btn btn-ghost" id="wa-feat-btn">Request a Feature</button>
            <button class="btn btn-ghost" id="wa-data-btn">Data Recovery</button>
          </div>
        </div>

        <div class="settings-card" style="border-color:var(--brand-fade-strong);background:var(--brand-fade);">
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;">
            For urgent issues, WhatsApp us at
            <a href="https://wa.me/919945791450" target="_blank"
              style="color:var(--green);text-decoration:none;font-weight:500;">+91 99457 91450</a>
            with <strong>[URGENT]</strong> at the start of your message.
          </div>
        </div>
      </div>

    </div>
  </div>`;

  // Quick action buttons → WhatsApp with prefilled message
  const waBase = 'https://wa.me/919945791450?text=';
  document.getElementById('wa-bug-btn')?.addEventListener('click', () => {
    const msg = encodeURIComponent(`[Flym Bug Report]\nGym: ${gymName} (${S.gym?.gym_code||'—'})\n\nDescribe the bug:\n`);
    window.open(waBase + msg, '_blank');
  });
  document.getElementById('wa-feat-btn')?.addEventListener('click', () => {
    const msg = encodeURIComponent(`[Flym Feature Request]\nGym: ${gymName}\n\nFeature I'd like:\n`);
    window.open(waBase + msg, '_blank');
  });
  document.getElementById('wa-data-btn')?.addEventListener('click', () => {
    const msg = encodeURIComponent(`[Flym Data Recovery]\nGym: ${gymName} (${S.gym?.gym_code||'—'})\n\nPlease help me recover my data.`);
    window.open(waBase + msg, '_blank');
  });

  document.getElementById('btn-ct-send')?.addEventListener('click', async () => {
    const name    = document.getElementById('ct-name')?.value.trim();
    const subject = document.getElementById('ct-subject')?.value;
    const message = document.getElementById('ct-message')?.value.trim();
    const errEl   = document.getElementById('ct-error');
    const okEl    = document.getElementById('ct-success');
    const btn     = document.getElementById('btn-ct-send');

    errEl.style.display = 'none';
    okEl.style.display  = 'none';

    if (!name)    { errEl.textContent = 'Please enter your name.'; errEl.style.display='block'; return; }
    if (!message) { errEl.textContent = 'Please enter a message.'; errEl.style.display='block'; return; }

    btn.disabled = true; btn.textContent = 'Sending…';

    try {
      // 1. Save to Supabase for your records
      const { error } = await supabase.from('support_messages').insert({
        gym_id:    S.gym?.id   || null,
        gym_name:  gymName,
        gym_code:  S.gym?.gym_code || null,
        owner_name: name,
        subject,
        message,
        created_at: new Date().toISOString(),
      });
      // Don't block on DB error — still open WhatsApp
      if (error) console.warn('[Contact] DB insert failed:', error.message);
    } catch (e) {
      console.warn('[Contact] DB error:', e);
    }

    // 2. Open WhatsApp with the full message
    const waMsg = encodeURIComponent(
      `[Flym Support - ${subject}]\nGym: ${gymName} (${S.gym?.gym_code||'—'})\nFrom: ${name}\n\n${message}`
    );
    window.open('https://wa.me/919945791450?text=' + waMsg, '_blank');

    okEl.style.display = 'block';
    document.getElementById('ct-message').value = '';
    btn.disabled = false; btn.textContent = 'Send Message →';
  });
}


export { renderContact };
