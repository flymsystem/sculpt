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
// ════════════════════════════════════════════════════════════════

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

  // 2. Get public URL
  const { data: urlData } = supabase.storage.from('aadhar-photos').getPublicUrl(path);
  const aadharUrl = urlData?.publicUrl + '?v=' + Date.now();

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
