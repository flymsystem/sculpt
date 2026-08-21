// Dashboard shared state — imported by all modules
export const DEFAULT_WA_TEMPLATE =
  'Hi {name}! 👋\n\nYour *{plan}* at *{gym}* expires on *{date}*.\n\nPlease renew to continue your fitness journey! 💪\n\nContact us to renew.';

// {name} {appnum} {gym} {link} — sent once when a member is added, and
// again from their detail view if they lose the message. Editable in
// Gym Settings alongside DEFAULT_WA_TEMPLATE (gyms.credentials_wa_template).
export const DEFAULT_CREDENTIALS_WA_TEMPLATE =
  'Hi {name}! 👋\n\nWelcome to *{gym}*! Here are your login details for the member app:\n\n📱 Application Number: *{appnum}*\n🔗 Login: {link}\n\nUse your Application Number and phone number to log in — no password needed.\n\nSee you at the gym! 💪';

// Follow-up nudge for the "not seen recently" list — {name} {days} {gym}.
export const DEFAULT_FOLLOWUP_WA_TEMPLATE =
  'Hi {name}! 👋\n\nWe haven\'t seen you at *{gym}* in {days} days — everything okay?\n\nWe\'d love to have you back for a workout! 💪\n\nLet us know if there\'s anything we can help with.';

export let S = {
  gym: null,
  members: [],
  plans: [],
  payHistory: [],
  addonTemplates: [],
  expenses: [],
  enquiries: [],
  staff: [],
  branches: [],
  section: 'overview',
  // ── v3: Role & tier ──
  role: 'owner',          // 'owner' or 'staff'
  staffRecord: null,      // linked staff row (only when role='staff')
};
export let _memberPage = 1;
export const PAGE_SIZE = 50;
export function setMemberPage(p) { _memberPage = p; }
