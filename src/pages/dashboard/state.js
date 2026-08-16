// Dashboard shared state — imported by all modules
export const DEFAULT_WA_TEMPLATE =
  'Hi {name}! 👋\n\nYour *{plan}* at *{gym}* expires on *{date}*.\n\nPlease renew to continue your fitness journey! 💪\n\nContact us to renew.';

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
  subscription: null,
  section: 'overview',
  // ── v3: Role & tier ──
  role: 'owner',          // 'owner' or 'staff'
  tier: 'core',           // 'core' or 'pro' — from gym.subscription_tier
  staffRecord: null,      // linked staff row (only when role='staff')
};
export let _memberPage = 1;
export const PAGE_SIZE = 50;
export function setMemberPage(p) { _memberPage = p; }
