// tests/member-photo-persist.spec.js — member profile photo persistence
// (A1: "upload a member photo, save, navigate away, come back — the
// photo is gone").
//
// Root cause (migration 126_member_photo_url_column.sql): members.photo_url
// never existed as a column. dashboard/photo.js's saveMemberPhoto()
// uploaded the blob to the 'member-photos' storage bucket successfully,
// then ran `supabase.from('members').update({ photo_url })` against a
// column PostgREST had no idea about — that write silently failed (only
// surfaced as an easy-to-miss amber toast), the storage object was left
// orphaned, and members_with_status (getMembers()'s source view) couldn't
// select a column that didn't exist regardless. Fixed by adding the
// column and adding it to the view's explicit SELECT list.
//
// This test drives the real upload/replace/remove functions
// (window.__sculptPhoto, exposed by dashboard/photo.js the same way
// lib/members.js exposes window.__sculptMembers) against the live
// Supabase project rather than the canvas-based cropper UI in
// components/photo-picker.js — Playwright can't meaningfully drive
// freehand canvas drag/zoom interactions, and the picker's only job is
// producing a { blob, dataUrl } pair, which is exactly what a tiny fixture
// JPEG data URL already is. What this DOES exercise for real: the
// storage upload, the storage.objects RLS policies (owner AND staff —
// 120_storage_staff_access.sql), the members.photo_url column write, and
// the members_with_status view read that the dashboard actually renders
// from after a reload. What it does NOT exercise: the picker/cropper UI
// itself, or the member-modals.js click handlers that call
// window.__pendingAddPhoto / window.__pendingEditPhoto — those are covered
// by reading the code, not by this test. See the report for what was
// manually code-reviewed instead of run.
//
// Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD (owner) for the owner test;
// SCULPT_STAFF_EMAIL/SCULPT_STAFF_PASSWORD (a real staff login, not the
// owner) additionally for the staff test. Each test creates and cleans up
// its own disposable member — see tests/add-member.spec.js for the same
// pattern. --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const OWNER_EMAIL = process.env.SCULPT_TEST_EMAIL;
const OWNER_PASSWORD = process.env.SCULPT_TEST_PASSWORD;
const STAFF_EMAIL = process.env.SCULPT_STAFF_EMAIL;
const STAFF_PASSWORD = process.env.SCULPT_STAFF_PASSWORD;

// 1x1 red pixel JPEG — small, valid, decodable, good enough to prove the
// upload/DB-write/read round trip without needing a real photo.
const FIXTURE_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

function randomSuffix() { return Math.random().toString(36).slice(2, 8); }

async function signIn(page, email, password) {
  const logoutBtn = page.locator('#topbar-logout-btn');
  if (await logoutBtn.count()) {
    await logoutBtn.click();
    await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 10_000 }).catch(() => {});
  }
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-pass').fill(password);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await page.waitForFunction(() => typeof window._navTo === 'function');
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
  // dashboard/photo.js is only imported by dashboard/index.js's module
  // graph, which is already loaded once /dashboard renders — but wait
  // for the hook explicitly rather than assuming timing.
  await page.evaluate(() => window._navTo('members'));
  await page.waitForFunction(() => !!window.__sculptPhoto && !!window.__sculptMembers);
}

async function addDisposableMember(page, gymId, name) {
  return page.evaluate(async ({ gymId, name }) => {
    return window.__sculptMembers.addMember(gymId, {
      fullName: name,
      phone: String(9_000_000_000 + Math.floor(Math.random() * 99_999_999)).slice(0, 10),
      joinDate: new Date().toISOString().split('T')[0],
      memberType: 'Trial',
    });
  }, { gymId, name });
}

async function cleanupMember(page, gymId, memberId) {
  await page.evaluate(async ({ gymId, memberId }) => {
    await window.__sculptMembers.deleteMember(memberId, gymId).catch(() => {});
  }, { gymId, memberId });
}

async function runPhotoPersistenceCycle(page, roleLabel) {
  const gymId = await page.evaluate(() => window.__sculptSession?.gym?.id);
  expect(gymId, `${roleLabel} session has no gym id`).toBeTruthy();

  const name = `E2E PhotoPersist ${roleLabel} ${randomSuffix()}`;
  const member = await addDisposableMember(page, gymId, name);
  expect(member?.id, `member creation failed for ${roleLabel}`).toBeTruthy();

  try {
    // ── 1. Upload a photo to the freshly-created member ──────────
    const uploadedUrl = await page.evaluate(
      ({ dataUrl, gymId, memberId }) => window.__sculptPhoto.saveMemberPhoto(dataUrl, gymId, memberId),
      { dataUrl: FIXTURE_JPEG_DATA_URL, gymId, memberId: member.id }
    );
    expect(uploadedUrl, `${roleLabel}: saveMemberPhoto returned no URL`).toBeTruthy();

    // ── Persistence check: re-fetch from the DB exactly like
    //    getMembers() does after a reload/navigate-away-and-back ──
    let refetched = await page.evaluate(
      ({ gymId }) => window.__sculptMembers.getMembers(gymId),
      { gymId }
    );
    let row = refetched.find((m) => m.id === member.id);
    expect(row, `${roleLabel}: member not found after upload`).toBeTruthy();
    expect(row.photo_url, `${roleLabel}: photo_url did not persist after upload — this is the A1 bug`).toBeTruthy();
    expect(row.photo_url).toBe(uploadedUrl);

    // ── 2. Replace the photo (upsert path) ────────────────────────
    const replacedUrl = await page.evaluate(
      ({ dataUrl, gymId, memberId }) => window.__sculptPhoto.saveMemberPhoto(dataUrl, gymId, memberId),
      { dataUrl: FIXTURE_JPEG_DATA_URL, gymId, memberId: member.id }
    );
    expect(replacedUrl, `${roleLabel}: replace upload returned no URL`).toBeTruthy();

    refetched = await page.evaluate(
      ({ gymId }) => window.__sculptMembers.getMembers(gymId),
      { gymId }
    );
    row = refetched.find((m) => m.id === member.id);
    expect(row.photo_url, `${roleLabel}: photo_url lost after replace`).toBeTruthy();
    expect(row.photo_url).toBe(replacedUrl);

    // ── 3. Remove the photo — storage object AND column must clear ─
    await page.evaluate(
      ({ gymId, memberId }) => window.__sculptPhoto.removeMemberPhoto(gymId, memberId),
      { gymId, memberId: member.id }
    );

    refetched = await page.evaluate(
      ({ gymId }) => window.__sculptMembers.getMembers(gymId),
      { gymId }
    );
    row = refetched.find((m) => m.id === member.id);
    expect(row, `${roleLabel}: member vanished after photo removal`).toBeTruthy();
    expect(row.photo_url, `${roleLabel}: photo_url not cleared after removal`).toBeNull();

    // The storage object itself must actually be gone too, not just the
    // column — a stale object would be a broken/orphaned image left in
    // the bucket. window.__sculptPhoto.memberPhotoExistsInStorage() is a
    // test-only helper (dashboard/photo.js) that lists the bucket rather
    // than guessing at error text; a plain dynamic import of
    // /src/lib/supabase.js from here would not resolve against the built
    // preview server (hashed chunk filenames), which is why this goes
    // through an exposed hook instead.
    const stillInStorage = await page.evaluate(
      ({ gymId, memberId }) => window.__sculptPhoto.memberPhotoExistsInStorage(gymId, memberId),
      { gymId, memberId: member.id }
    );
    expect(stillInStorage, `${roleLabel}: storage object was not deleted on remove`).toBe(false);
  } finally {
    await cleanupMember(page, gymId, member.id);
  }
}

test.describe('member photo persistence (A1)', () => {
  test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');

  test('owner: upload, replace and remove a member photo all persist across a reload', async ({ page }) => {
    await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
    await runPhotoPersistenceCycle(page, 'owner');
  });

  test('staff: upload, replace and remove a member photo all persist across a reload', async ({ page }) => {
    test.skip(!STAFF_EMAIL || !STAFF_PASSWORD, 'Needs SCULPT_STAFF_EMAIL/SCULPT_STAFF_PASSWORD (a staff login, not the owner)');
    await signIn(page, STAFF_EMAIL, STAFF_PASSWORD);
    const staffId = await page.evaluate(() => window.__sculptSession?.staffRecord?.id || null);
    if (!staffId) throw new Error('SCULPT_STAFF_EMAIL is not a staff login (no staffRecord on the session) — this test needs a real staff account, not the owner.');
    await runPhotoPersistenceCycle(page, 'staff');
  });
});
