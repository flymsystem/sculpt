// src/lib/qr.js — QR encode/decode, loaded on demand only.
//
// Never statically imported. `qrcode` and `jsqr` together are small
// (~60 kB) but every visitor to the landing page or login screen pays
// for whatever this file pulls in at module-load time if it's ever
// imported outside the two check-in pages that need it — see the
// guard test in tests/build-integrity.spec.js and the vendor-qr
// chunk in vite.config.js.

export async function generateQR(text) {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(text, { margin: 1, width: 480, errorCorrectionLevel: 'M' });
}

// Safari has no BarcodeDetector (as of this writing). Chrome/Android
// does, and it decodes off the GPU — much faster than jsQR's JS-only
// scan loop — so it's tried first and jsQR is the universal fallback.
async function hasNativeDetector() {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch (_) {
    return false;
  }
}

/**
 * Starts the camera on `videoEl` and calls `onDecode(text)` once per
 * successful frame decode. Returns a stop() function that must be
 * called on page teardown — it stops both the scan loop and the
 * camera stream.
 */
export async function startScanner(videoEl, onDecode, onError) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    onError?.(err);
    return () => {};
  }
  videoEl.srcObject = stream;
  await videoEl.play();

  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
  };

  const nativeOk = await hasNativeDetector();

  if (nativeOk) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const loop = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(videoEl);
        if (codes.length) onDecode(codes[0].rawValue);
      } catch (_) { /* transient decode failure — keep scanning */ }
      if (!stopped) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return stop;
  }

  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const loop = () => {
    if (stopped) return;
    if (videoEl.videoWidth) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(frame.data, frame.width, frame.height);
      if (result?.data) onDecode(result.data);
    }
    if (!stopped) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return stop;
}
