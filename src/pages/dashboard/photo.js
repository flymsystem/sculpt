import { supabase } from '../../lib/supabase.js';
import { showToast } from '../../components/toast.js';

async function saveMemberPhoto(dataUrl, gymId, memberId) {
  if (!dataUrl || !memberId || !gymId) return null;

  // Convert data URL to Blob
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();

  const path = `${gymId}/${memberId}.jpg`;

  // 1. Upload to storage
  const { error: uploadErr } = await supabase.storage
    .from('member-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });

  if (uploadErr) {
    // Show user-visible error
    if (uploadErr.message?.includes('not found') || uploadErr.message?.includes('Bucket')) {
      showToast('Storage bucket "member-photos" not found. Create it in Supabase → Storage.', 'red');
    } else if (uploadErr.message?.includes('policy') || uploadErr.message?.includes('security') || uploadErr.message?.includes('Unauthorized')) {
      showToast('Storage permission denied. Check bucket policies.', 'red');
    } else {
      showToast('Photo upload failed: ' + uploadErr.message, 'red');
    }
    throw new Error(uploadErr.message);
  }

  // 2. Get public URL
  const { data: urlData } = supabase.storage.from('member-photos').getPublicUrl(path);
  const photoUrl = urlData?.publicUrl + '?v=' + Date.now();

  // 3. Save URL to member row
  const { error: dbErr } = await supabase
    .from('members')
    .update({ photo_url: photoUrl })
    .eq('id', memberId)
    .eq('gym_id', gymId);

  if (dbErr) {
    showToast('Photo uploaded but failed to save URL: ' + dbErr.message, 'amber');
    throw new Error(dbErr.message);
  }

  return photoUrl;
}


async function saveGymLogo(dataUrl, gymId, mime = 'image/png') {
  if (!dataUrl || !gymId) return null;

  const resp = await fetch(dataUrl);
  const blob = await resp.blob();

  const ext = mime === 'image/svg+xml' ? 'svg' : (mime === 'image/jpeg' ? 'jpg' : 'png');
  const path = `${gymId}/logo.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('gym-logos')
    .upload(path, blob, { contentType: mime, upsert: true });

  if (uploadErr) {
    if (uploadErr.message?.includes('not found') || uploadErr.message?.includes('Bucket')) {
      showToast('Storage bucket "gym-logos" not found. Run migration 012.', 'red');
    } else if (uploadErr.message?.includes('policy') || uploadErr.message?.includes('security') || uploadErr.message?.includes('Unauthorized')) {
      showToast('Storage permission denied. Check bucket policies.', 'red');
    } else {
      showToast('Logo upload failed: ' + uploadErr.message, 'red');
    }
    throw new Error(uploadErr.message);
  }

  const { data: urlData } = supabase.storage.from('gym-logos').getPublicUrl(path);
  const logoUrl = urlData?.publicUrl + '?v=' + Date.now();

  const { error: dbErr } = await supabase
    .from('gyms')
    .update({ logo_url: logoUrl })
    .eq('id', gymId);

  if (dbErr) {
    showToast('Logo uploaded but failed to save URL: ' + dbErr.message, 'amber');
    throw new Error(dbErr.message);
  }

  return logoUrl;
}


export { saveMemberPhoto, saveGymLogo, removeMemberPhoto, saveStaffPhoto, removeStaffPhoto, saveAadharPhoto, removeAadharPhoto };

async function saveStaffPhoto(dataUrl, gymId, staffId) {
  if (!dataUrl || !staffId || !gymId) return null;

  const resp = await fetch(dataUrl);
  const blob = await resp.blob();

  const path = `${gymId}/staff/${staffId}.jpg`;

  const { error: uploadErr } = await supabase.storage
    .from('member-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });

  if (uploadErr) {
    if (uploadErr.message?.includes('not found') || uploadErr.message?.includes('Bucket')) {
      showToast('Storage bucket "member-photos" not found. Create it in Supabase \u2192 Storage.', 'red');
    } else if (uploadErr.message?.includes('policy') || uploadErr.message?.includes('security') || uploadErr.message?.includes('Unauthorized')) {
      showToast('Storage permission denied. Check bucket policies.', 'red');
    } else {
      showToast('Photo upload failed: ' + uploadErr.message, 'red');
    }
    throw new Error(uploadErr.message);
  }

  const { data: urlData } = supabase.storage.from('member-photos').getPublicUrl(path);
  const photoUrl = urlData?.publicUrl + '?v=' + Date.now();

  const { error: dbErr } = await supabase
    .from('staff')
    .update({ photo_url: photoUrl })
    .eq('id', staffId)
    .eq('gym_id', gymId);

  if (dbErr) {
    showToast('Photo uploaded but failed to save URL: ' + dbErr.message, 'amber');
    throw new Error(dbErr.message);
  }

  return photoUrl;
}

async function removeStaffPhoto(gymId, staffId) {
  if (!staffId || !gymId) return;

  const path = `${gymId}/staff/${staffId}.jpg`;

  try {
    await supabase.storage.from('member-photos').remove([path]);
  } catch (_) { /* silent */ }

  const { error: dbErr } = await supabase
    .from('staff')
    .update({ photo_url: null })
    .eq('id', staffId)
    .eq('gym_id', gymId);

  if (dbErr) {
    showToast('Failed to remove photo: ' + dbErr.message, 'red');
    throw new Error(dbErr.message);
  }
}

async function removeMemberPhoto(gymId, memberId) {
  if (!memberId || !gymId) return;

  const path = `${gymId}/${memberId}.jpg`;

  // 1. Delete from storage (ignore errors — file might not exist)
  try {
    await supabase.storage.from('member-photos').remove([path]);
  } catch (_) { /* silent — file might already be gone */ }

  // 2. Clear URL from member row
  const { error: dbErr } = await supabase
    .from('members')
    .update({ photo_url: null })
    .eq('id', memberId)
    .eq('gym_id', gymId);

  if (dbErr) {
    showToast('Failed to remove photo: ' + dbErr.message, 'red');
    throw new Error(dbErr.message);
  }
}

// ════════════════════════════════════════════════════════════════
// AADHAAR CARD PHOTO — stored in aadhar-photos bucket
// Path: {gymId}/{memberId}.jpg
// DB column: members.aadhar_photo_url
//
// This bucket is PRIVATE (migration 101 — "government ID scans, served
// through signed URLs only"), unlike member-photos. getPublicUrl()
// against a private bucket returns a URL that 403s the moment anyone
// opens it — the upload silently "succeeds" (the object really is
// there) but the stored link never worked. Same fix as invoices.js:
// a signed URL, generated at upload time.
// ════════════════════════════════════════════════════════════════

const AADHAR_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365; // 1 year, matches invoices.js

async function saveAadharPhoto(dataUrl, gymId, memberId) {
  if (!dataUrl || !memberId || !gymId) return null;

  const resp = await fetch(dataUrl);
  const blob = await resp.blob();

  const path = `${gymId}/${memberId}.jpg`;

  // 1. Upload to aadhar-photos bucket
  const { error: uploadErr } = await supabase.storage
    .from('aadhar-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });

  if (uploadErr) {
    if (uploadErr.message?.includes('not found') || uploadErr.message?.includes('Bucket')) {
      showToast('Storage bucket "aadhar-photos" not found. Create it in Supabase \u2192 Storage and run migration 028.', 'red');
    } else if (uploadErr.message?.includes('policy') || uploadErr.message?.includes('security') || uploadErr.message?.includes('Unauthorized')) {
      showToast('Storage permission denied. Check bucket policies for aadhar-photos.', 'red');
    } else {
      showToast('Aadhaar photo upload failed: ' + uploadErr.message, 'red');
    }
    throw new Error(uploadErr.message);
  }

  // 2. Get a signed URL (this bucket is private — getPublicUrl() would
  //    hand back a link that never opens)
  const { data: urlData, error: signErr } = await supabase.storage
    .from('aadhar-photos')
    .createSignedUrl(path, AADHAR_SIGNED_URL_EXPIRY_SECONDS);
  if (signErr || !urlData?.signedUrl) {
    showToast('Aadhaar photo uploaded but could not generate a viewable link: ' + (signErr?.message || 'unknown error'), 'amber');
    throw new Error(signErr?.message || 'Could not create a signed URL for the Aadhaar photo.');
  }
  const aadharUrl = urlData.signedUrl;

  // 3. Save URL to member row
  const { error: dbErr } = await supabase
    .from('members')
    .update({ aadhar_photo_url: aadharUrl })
    .eq('id', memberId)
    .eq('gym_id', gymId);

  if (dbErr) {
    showToast('Aadhaar photo uploaded but failed to save URL: ' + dbErr.message, 'amber');
    throw new Error(dbErr.message);
  }

  return aadharUrl;
}

async function removeAadharPhoto(gymId, memberId) {
  if (!memberId || !gymId) return;

  const path = `${gymId}/${memberId}.jpg`;

  // 1. Delete from storage (ignore errors — file might not exist)
  try {
    await supabase.storage.from('aadhar-photos').remove([path]);
  } catch (_) { /* silent */ }

  // 2. Clear URL from member row
  const { error: dbErr } = await supabase
    .from('members')
    .update({ aadhar_photo_url: null })
    .eq('id', memberId)
    .eq('gym_id', gymId);

  if (dbErr) {
    showToast('Failed to remove Aadhaar photo: ' + dbErr.message, 'red');
    throw new Error(dbErr.message);
  }
}

// memberPhotoExistsInStorage() — test-only helper. A "remove photo" flow
// has to be checked in two places: the members.photo_url column cleared
// AND the storage.objects row actually gone (otherwise an orphaned file
// sits in the bucket and, worse, a stale signed/public URL cached
// anywhere still resolves to real image bytes). list() with a `search`
// filter is the supported way to check "does this exact object exist"
// without guessing at storage error message text.
async function memberPhotoExistsInStorage(gymId, memberId) {
  if (!gymId || !memberId) return false;
  const path = `${memberId}.jpg`;
  const { data, error } = await supabase.storage.from('member-photos').list(gymId, { search: path });
  if (error) return false;
  return (data || []).some((f) => f.name === path);
}

// Test-only hook, same convention as window.__sculptMembers in
// lib/members.js — lets tests/member-photo-persist.spec.js drive an
// upload/replace/remove cycle against the real storage bucket + members
// row without having to automate the canvas-based cropper UI in
// photo-picker.js. saveMemberPhoto/removeMemberPhoto are exactly the
// functions member-modals.js calls (via setPhotoHandler), so this
// exercises the real bug class (migration 126 — members.photo_url did
// not exist as a column, so every upload "succeeded" in storage but the
// DB write silently failed and nothing ever rendered on reload).
if (typeof window !== 'undefined') {
  window.__sculptPhoto = { saveMemberPhoto, removeMemberPhoto, memberPhotoExistsInStorage };
}
