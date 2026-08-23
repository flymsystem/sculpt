// tests/renewal-date.spec.js — unit coverage for computeRenewalBase()
// (FIX-PROMPT.md item 11: renewing a still-active membership must extend
// from the EXISTING expiry date, not today; an expired one renews from
// today). No browser needed — helpers.js is pure functions, no DOM.
import { test, expect } from '@playwright/test';
import { computeRenewalBase } from '../src/pages/dashboard/helpers.js';

const TODAY = '2026-08-23';

test('active membership (expiry in the future) renews from its existing expiry date', () => {
  const member = { expiry_date: '2026-09-05', cancelled_at: null };
  expect(computeRenewalBase(member, TODAY)).toBe('2026-09-05');
});

test('expired membership (expiry in the past) renews from today', () => {
  const member = { expiry_date: '2026-08-10', cancelled_at: null };
  expect(computeRenewalBase(member, TODAY)).toBe(TODAY);
});

test('membership expiring exactly today is treated as still active — renews from today (inclusive)', () => {
  const member = { expiry_date: TODAY, cancelled_at: null };
  expect(computeRenewalBase(member, TODAY)).toBe(TODAY);
});

test('cancelled membership always renews from today, even if expiry is still in the future', () => {
  const member = { expiry_date: '2026-12-01', cancelled_at: '2026-08-20T10:00:00Z' };
  expect(computeRenewalBase(member, TODAY)).toBe(TODAY);
});

test('member with no expiry_date on record (e.g. never had a plan) renews from today', () => {
  const member = { expiry_date: null, cancelled_at: null };
  expect(computeRenewalBase(member, TODAY)).toBe(TODAY);
});
