// src/components/photo-picker.js
// ─────────────────────────────────────────────────────────────
// Lightweight photo picker + cropper (no dependencies)
// PC: File picker or Camera
// Mobile: Camera or Gallery
// Returns a cropped 400×400 JPEG Blob (pickPhoto)
//         or a cropped 1200×800 JPEG Blob (pickAadharCard)
// ─────────────────────────────────────────────────────────────

let _cropStylesInjected = false;

/**
 * Opens the photo picker flow.
 * Returns a Promise that resolves to { blob, dataUrl } or null if cancelled.
 */
export function pickPhoto() {
  return new Promise((resolve) => {
    _injectCropStyles();

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // Create hidden file inputs
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.setAttribute('capture', 'environment');
    cameraInput.style.display = 'none';

    document.body.appendChild(fileInput);
    document.body.appendChild(cameraInput);

    // Source selection overlay
    const overlay = document.createElement('div');
    overlay.className = 'photo-picker-overlay';
    overlay.innerHTML = `
      <div class="photo-picker-sheet">
        <div class="photo-picker-title">Add Photo</div>
        <button class="photo-picker-option" id="pp-camera">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span>${isMobile ? 'Take Photo' : 'Use Camera'}</span>
        </button>
        <button class="photo-picker-option" id="pp-gallery">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>${isMobile ? 'Choose from Gallery' : 'Choose from Computer'}</span>
        </button>
        <button class="photo-picker-cancel" id="pp-cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    function cleanup() {
      overlay.remove();
      fileInput.remove();
      cameraInput.remove();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); resolve(null); }
    });
    document.getElementById('pp-cancel').addEventListener('click', () => { cleanup(); resolve(null); });

    document.getElementById('pp-camera').addEventListener('click', () => {
      overlay.classList.remove('active');
      setTimeout(() => { overlay.remove(); cameraInput.click(); }, 150);
    });
    document.getElementById('pp-gallery').addEventListener('click', () => {
      overlay.classList.remove('active');
      setTimeout(() => { overlay.remove(); fileInput.click(); }, 150);
    });

    function handleFile(file) {
      if (!file) { cleanup(); resolve(null); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        fileInput.remove();
        cameraInput.remove();
        openCropper(e.target.result).then(resolve);
      };
      reader.readAsDataURL(file);
    }

    fileInput.addEventListener('change', (e) => handleFile(e.target.files?.[0]));
    cameraInput.addEventListener('change', (e) => handleFile(e.target.files?.[0]));
  });
}

/**
 * Opens a simple file picker for a brand logo.
 * Unlike pickPhoto(), this does NOT force a square/circular crop —
 * it keeps the original aspect ratio and preserves transparency (PNG/SVG).
 * Only downscales if the image is larger than MAX_DIM, to keep file size sane.
 * Returns a Promise that resolves to { dataUrl, mime } or null if cancelled.
 */
export function pickLogo() {
  return new Promise((resolve) => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    function cleanup() { fileInput.remove(); }

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) { cleanup(); resolve(null); return; }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const rawDataUrl = ev.target.result;

        // SVG is vector — pass through untouched, no canvas re-rendering needed
        if (file.type === 'image/svg+xml') {
          cleanup();
          resolve({ dataUrl: rawDataUrl, mime: 'image/svg+xml' });
          return;
        }

        const img = new Image();
        img.onload = () => {
          const MAX_DIM = 800;
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          // No fillRect — canvas stays transparent where the source image is transparent
          ctx.drawImage(img, 0, 0, width, height);

          const outMime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
          const outDataUrl = canvas.toDataURL(outMime, 0.92);
          cleanup();
          resolve({ dataUrl: outDataUrl, mime: outMime });
        };
        img.onerror = () => { cleanup(); resolve(null); };
        img.src = rawDataUrl;
      };
      reader.onerror = () => { cleanup(); resolve(null); };
      reader.readAsDataURL(file);
    });

    fileInput.click();
  });
}

/**
 * Opens the crop modal. Returns { blob, dataUrl } or null.
 */
function openCropper(imageSrc) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'crop-overlay';

    overlay.innerHTML = `
      <div class="crop-modal">
        <div class="crop-header">
          <span class="crop-title">Crop Photo</span>
          <button class="crop-close" id="crop-cancel-x">✕</button>
        </div>
        <div class="crop-area" id="crop-area">
          <canvas id="crop-canvas"></canvas>
          <div class="crop-circle" id="crop-circle"></div>
        </div>
        <div class="crop-controls">
          <label class="crop-zoom-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </label>
          <input type="range" id="crop-zoom" min="100" max="300" value="100" class="crop-slider">
        </div>
        <div class="crop-footer">
          <button class="btn btn-ghost" id="crop-cancel">Cancel</button>
          <button class="btn btn-primary" id="crop-confirm">Use Photo</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => overlay.classList.add('active'));

    const canvas = document.getElementById('crop-canvas');
    const ctx = canvas.getContext('2d');
    const cropArea = document.getElementById('crop-area');
    const zoomSlider = document.getElementById('crop-zoom');

    const img = new Image();
    let scale = 1;
    let offsetX = 0, offsetY = 0;
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let startOffsetX = 0, startOffsetY = 0;

    const CROP_SIZE = 280; // visual crop circle diameter
    const OUTPUT_SIZE = 400; // final output px

    img.onload = () => {
      // Size canvas to fit the crop area
      const areaW = cropArea.clientWidth;
      const areaH = cropArea.clientHeight || 320;
      canvas.width = areaW;
      canvas.height = areaH;

      // Initial scale: fit image so shorter side fills crop circle
      const minDim = Math.min(img.width, img.height);
      scale = CROP_SIZE / minDim;
      zoomSlider.min = Math.round(scale * 100);
      zoomSlider.max = Math.round(scale * 100 * 3);
      zoomSlider.value = Math.round(scale * 100);

      // Center image
      offsetX = (areaW - img.width * scale) / 2;
      offsetY = (areaH - img.height * scale) / 2;

      draw();
    };
    img.src = imageSrc;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw image
      ctx.save();
      ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);

      // Dark overlay with circular cutout
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cut out circle
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, CROP_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();

      // Redraw image inside circle only
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);
      ctx.restore();

      // Circle border
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, CROP_SIZE / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Zoom
    zoomSlider.addEventListener('input', () => {
      const oldScale = scale;
      scale = parseInt(zoomSlider.value) / 100;
      // Zoom toward center
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      offsetX = cx - (cx - offsetX) * (scale / oldScale);
      offsetY = cy - (cy - offsetY) * (scale / oldScale);
      draw();
    });

    // Drag — mouse
    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      startOffsetX = offsetX; startOffsetY = offsetY;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      offsetX = startOffsetX + (e.clientX - dragStartX);
      offsetY = startOffsetY + (e.clientY - dragStartY);
      draw();
    });
    window.addEventListener('mouseup', () => {
      isDragging = false;
      canvas.style.cursor = 'grab';
    });

    // Drag — touch
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
        startOffsetX = offsetX; startOffsetY = offsetY;
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      e.preventDefault();
      offsetX = startOffsetX + (e.touches[0].clientX - dragStartX);
      offsetY = startOffsetY + (e.touches[0].clientY - dragStartY);
      draw();
    }, { passive: false });
    canvas.addEventListener('touchend', () => { isDragging = false; }, { passive: true });

    // Pinch-to-zoom on mobile
    let lastPinchDist = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        isDragging = false;
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const delta = dist - lastPinchDist;
        const oldScale = scale;
        scale = Math.max(parseInt(zoomSlider.min) / 100, Math.min(parseInt(zoomSlider.max) / 100, scale + delta * 0.003));
        zoomSlider.value = Math.round(scale * 100);
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        offsetX = cx - (cx - offsetX) * (scale / oldScale);
        offsetY = cy - (cy - offsetY) * (scale / oldScale);
        lastPinchDist = dist;
        draw();
      }
    }, { passive: false });

    function closeCropper(result) {
      overlay.classList.remove('active');
      setTimeout(() => {
        overlay.remove();
        document.body.style.overflow = '';
        // Clean up mouse/touch listeners
      }, 200);
      resolve(result);
    }

    // Cancel
    document.getElementById('crop-cancel')?.addEventListener('click', () => closeCropper(null));
    document.getElementById('crop-cancel-x')?.addEventListener('click', () => closeCropper(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCropper(null); });

    // Confirm — extract cropped circle as square JPEG
    document.getElementById('crop-confirm')?.addEventListener('click', () => {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = OUTPUT_SIZE;
      outCanvas.height = OUTPUT_SIZE;
      const outCtx = outCanvas.getContext('2d');

      // Calculate what portion of the source image is inside the crop circle
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const r = CROP_SIZE / 2;

      // Source coords in image space
      const srcX = (cx - r - offsetX) / scale;
      const srcY = (cy - r - offsetY) / scale;
      const srcW = CROP_SIZE / scale;
      const srcH = CROP_SIZE / scale;

      // Draw circular crop
      outCtx.beginPath();
      outCtx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
      outCtx.closePath();
      outCtx.clip();

      outCtx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const dataUrl = outCanvas.toDataURL('image/jpeg', 0.88);
      outCanvas.toBlob((blob) => {
        closeCropper({ blob, dataUrl });
      }, 'image/jpeg', 0.88);
    });
  });
}


// ═══════════════════════════════════════════════════════════════
// AADHAAR CARD PICKER — rectangular landscape crop
// Optimised for cropping the data section of an Aadhaar card
// (name, number, address, DOB, photo — roughly top 30-50%)
// Output: 1200×800 JPEG (3:2 landscape)
// ═══════════════════════════════════════════════════════════════

/**
 * Opens the Aadhaar card photo picker → rectangular cropper.
 * Returns a Promise that resolves to { blob, dataUrl } or null if cancelled.
 */
export function pickAadharCard() {
  return new Promise((resolve) => {
    _injectCropStyles();

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.setAttribute('capture', 'environment');
    cameraInput.style.display = 'none';

    document.body.appendChild(fileInput);
    document.body.appendChild(cameraInput);

    const overlay = document.createElement('div');
    overlay.className = 'photo-picker-overlay';
    overlay.innerHTML = `
      <div class="photo-picker-sheet">
        <div class="photo-picker-title">Upload Aadhaar Card</div>
        <button class="photo-picker-option" id="pp-aadhar-camera">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span>${isMobile ? 'Take Photo' : 'Use Camera'}</span>
        </button>
        <button class="photo-picker-option" id="pp-aadhar-gallery">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>${isMobile ? 'Choose from Gallery' : 'Choose from Computer'}</span>
        </button>
        <button class="photo-picker-cancel" id="pp-aadhar-cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    function cleanup() {
      overlay.remove();
      fileInput.remove();
      cameraInput.remove();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); resolve(null); }
    });
    document.getElementById('pp-aadhar-cancel').addEventListener('click', () => { cleanup(); resolve(null); });

    document.getElementById('pp-aadhar-camera').addEventListener('click', () => {
      overlay.classList.remove('active');
      setTimeout(() => { overlay.remove(); cameraInput.click(); }, 150);
    });
    document.getElementById('pp-aadhar-gallery').addEventListener('click', () => {
      overlay.classList.remove('active');
      setTimeout(() => { overlay.remove(); fileInput.click(); }, 150);
    });

    function handleFile(file) {
      if (!file) { cleanup(); resolve(null); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        fileInput.remove();
        cameraInput.remove();
        openAadharCropper(e.target.result).then(resolve);
      };
      reader.readAsDataURL(file);
    }

    fileInput.addEventListener('change', (e) => handleFile(e.target.files?.[0]));
    cameraInput.addEventListener('change', (e) => handleFile(e.target.files?.[0]));
  });
}


/**
 * Rectangular cropper for Aadhaar card.
 * Crop window is a 3:2 landscape rectangle.
 */
function openAadharCropper(imageSrc) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'crop-overlay';

    overlay.innerHTML = `
      <div class="crop-modal">
        <div class="crop-header">
          <span class="crop-title">Crop Aadhaar Card</span>
          <button class="crop-close" id="acrop-cancel-x">\u2715</button>
        </div>
        <div style="padding:0 18px;font-size:12px;color:var(--text-tertiary);line-height:1.4;padding-top:8px;">
          Position the important details (name, number, address) inside the rectangle. Pinch or use the slider to zoom.
        </div>
        <div class="crop-area" id="acrop-area" style="height:340px;">
          <canvas id="acrop-canvas"></canvas>
        </div>
        <div class="crop-controls">
          <label class="crop-zoom-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </label>
          <input type="range" id="acrop-zoom" min="100" max="300" value="100" class="crop-slider">
        </div>
        <div class="crop-footer">
          <button class="btn btn-ghost" id="acrop-cancel">Cancel</button>
          <button class="btn btn-primary" id="acrop-confirm">Crop &amp; Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => overlay.classList.add('active'));

    const canvas = document.getElementById('acrop-canvas');
    const ctx = canvas.getContext('2d');
    const cropArea = document.getElementById('acrop-area');
    const zoomSlider = document.getElementById('acrop-zoom');

    const img = new Image();
    let scale = 1;
    let offsetX = 0, offsetY = 0;
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let startOffsetX = 0, startOffsetY = 0;

    // Crop rectangle dimensions (3:2 landscape) — sized for mobile
    const CROP_W = 300;
    const CROP_H = 200;
    // Output dimensions for saved image
    const OUT_W = 1200;
    const OUT_H = 800;

    img.onload = () => {
      const areaW = cropArea.clientWidth;
      const areaH = cropArea.clientHeight || 340;
      canvas.width = areaW;
      canvas.height = areaH;

      // Initial scale: fit image so shorter dimension fills crop rect
      const scaleW = CROP_W / img.width;
      const scaleH = CROP_H / img.height;
      scale = Math.max(scaleW, scaleH);
      zoomSlider.min = Math.round(scale * 100);
      zoomSlider.max = Math.round(scale * 100 * 4);
      zoomSlider.value = Math.round(scale * 100);

      // Center image
      offsetX = (areaW - img.width * scale) / 2;
      offsetY = (areaH - img.height * scale) / 2;

      draw();
    };
    img.src = imageSrc;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const rx = CROP_W / 2;
      const ry = CROP_H / 2;

      // Draw image
      ctx.save();
      ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);

      // Dark overlay
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cut out rectangle
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      // Rounded rectangle for a polished look
      const rr = 8;
      ctx.moveTo(cx - rx + rr, cy - ry);
      ctx.lineTo(cx + rx - rr, cy - ry);
      ctx.quadraticCurveTo(cx + rx, cy - ry, cx + rx, cy - ry + rr);
      ctx.lineTo(cx + rx, cy + ry - rr);
      ctx.quadraticCurveTo(cx + rx, cy + ry, cx + rx - rr, cy + ry);
      ctx.lineTo(cx - rx + rr, cy + ry);
      ctx.quadraticCurveTo(cx - rx, cy + ry, cx - rx, cy + ry - rr);
      ctx.lineTo(cx - rx, cy - ry + rr);
      ctx.quadraticCurveTo(cx - rx, cy - ry, cx - rx + rr, cy - ry);
      ctx.closePath();
      ctx.fill();

      // Redraw image behind cutout
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);
      ctx.restore();

      // Rectangle border
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - rx + rr, cy - ry);
      ctx.lineTo(cx + rx - rr, cy - ry);
      ctx.quadraticCurveTo(cx + rx, cy - ry, cx + rx, cy - ry + rr);
      ctx.lineTo(cx + rx, cy + ry - rr);
      ctx.quadraticCurveTo(cx + rx, cy + ry, cx + rx - rr, cy + ry);
      ctx.lineTo(cx - rx + rr, cy + ry);
      ctx.quadraticCurveTo(cx - rx, cy + ry, cx - rx, cy + ry - rr);
      ctx.lineTo(cx - rx, cy - ry + rr);
      ctx.quadraticCurveTo(cx - rx, cy - ry, cx - rx + rr, cy - ry);
      ctx.closePath();
      ctx.stroke();

      // Corner markers for visual guidance
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      const mk = 20; // marker length
      // Top-left
      ctx.beginPath();
      ctx.moveTo(cx - rx, cy - ry + mk); ctx.lineTo(cx - rx, cy - ry); ctx.lineTo(cx - rx + mk, cy - ry);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(cx + rx - mk, cy - ry); ctx.lineTo(cx + rx, cy - ry); ctx.lineTo(cx + rx, cy - ry + mk);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(cx - rx, cy + ry - mk); ctx.lineTo(cx - rx, cy + ry); ctx.lineTo(cx - rx + mk, cy + ry);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(cx + rx - mk, cy + ry); ctx.lineTo(cx + rx, cy + ry); ctx.lineTo(cx + rx, cy + ry - mk);
      ctx.stroke();
    }

    // Zoom
    zoomSlider.addEventListener('input', () => {
      const oldScale = scale;
      scale = parseInt(zoomSlider.value) / 100;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      offsetX = cx - (cx - offsetX) * (scale / oldScale);
      offsetY = cy - (cy - offsetY) * (scale / oldScale);
      draw();
    });

    // Drag — mouse
    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      startOffsetX = offsetX; startOffsetY = offsetY;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      offsetX = startOffsetX + (e.clientX - dragStartX);
      offsetY = startOffsetY + (e.clientY - dragStartY);
      draw();
    });
    window.addEventListener('mouseup', () => {
      isDragging = false;
      canvas.style.cursor = 'grab';
    });

    // Drag — touch (single finger)
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
        startOffsetX = offsetX; startOffsetY = offsetY;
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      e.preventDefault();
      offsetX = startOffsetX + (e.touches[0].clientX - dragStartX);
      offsetY = startOffsetY + (e.touches[0].clientY - dragStartY);
      draw();
    }, { passive: false });
    canvas.addEventListener('touchend', () => { isDragging = false; }, { passive: true });

    // Pinch-to-zoom on mobile
    let lastPinchDist = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        isDragging = false;
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const delta = dist - lastPinchDist;
        const oldScale = scale;
        scale = Math.max(parseInt(zoomSlider.min) / 100, Math.min(parseInt(zoomSlider.max) / 100, scale + delta * 0.003));
        zoomSlider.value = Math.round(scale * 100);
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        offsetX = cx - (cx - offsetX) * (scale / oldScale);
        offsetY = cy - (cy - offsetY) * (scale / oldScale);
        lastPinchDist = dist;
        draw();
      }
    }, { passive: false });

    function closeCropper(result) {
      overlay.classList.remove('active');
      setTimeout(() => {
        overlay.remove();
        document.body.style.overflow = '';
      }, 200);
      resolve(result);
    }

    // Cancel
    document.getElementById('acrop-cancel')?.addEventListener('click', () => closeCropper(null));
    document.getElementById('acrop-cancel-x')?.addEventListener('click', () => closeCropper(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCropper(null); });

    // Confirm — extract rectangle as landscape JPEG
    document.getElementById('acrop-confirm')?.addEventListener('click', () => {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = OUT_W;
      outCanvas.height = OUT_H;
      const outCtx = outCanvas.getContext('2d');

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // Source coords in image space
      const srcX = (cx - CROP_W / 2 - offsetX) / scale;
      const srcY = (cy - CROP_H / 2 - offsetY) / scale;
      const srcW = CROP_W / scale;
      const srcH = CROP_H / scale;

      outCtx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUT_W, OUT_H);

      const dataUrl = outCanvas.toDataURL('image/jpeg', 0.90);
      outCanvas.toBlob((blob) => {
        closeCropper({ blob, dataUrl });
      }, 'image/jpeg', 0.90);
    });
  });
}


function _injectCropStyles() {
  if (_cropStylesInjected) return;
  _cropStylesInjected = true;

  const s = document.createElement('style');
  s.id = 'photo-picker-styles';
  s.textContent = `
    /* Source picker sheet */
    .photo-picker-overlay {
      position:fixed;inset:0;z-index:700;
      background:rgba(0,0,0,0.6);
      display:flex;align-items:flex-end;justify-content:center;
      opacity:0;transition:opacity 0.2s;
    }
    .photo-picker-overlay.active { opacity:1; }
    .photo-picker-sheet {
      background:var(--surface-1);
      border-radius:var(--radius-xl) var(--radius-xl) 0 0;
      padding:20px;width:100%;max-width:400px;
      transform:translateY(100%);
      transition:transform 0.25s cubic-bezier(0.4,0,0.2,1);
    }
    .photo-picker-overlay.active .photo-picker-sheet {
      transform:translateY(0);
    }
    .photo-picker-title {
      font-size:16px;font-weight:600;color:var(--text-primary);
      text-align:center;margin-bottom:16px;
    }
    .photo-picker-option {
      display:flex;align-items:center;gap:14px;
      width:100%;padding:14px 16px;
      background:var(--surface-2);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);color:var(--text-primary);
      font-size:15px;cursor:pointer;margin-bottom:8px;
      font-family:var(--font-sans);
      transition:background 0.15s;
    }
    .photo-picker-option:hover { background:var(--surface-3); }
    .photo-picker-option svg { color:var(--brand-text);flex-shrink:0; }
    .photo-picker-cancel {
      width:100%;padding:12px;margin-top:8px;
      background:transparent;border:1px solid var(--border-default);
      border-radius:var(--radius-md);color:var(--text-secondary);
      font-size:14px;cursor:pointer;font-family:var(--font-sans);
    }

    /* Crop modal */
    .crop-overlay {
      position:fixed;inset:0;z-index:750;
      background:rgba(0,0,0,0.85);
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.2s;
    }
    .crop-overlay.active { opacity:1; }
    .crop-modal {
      background:var(--surface-1);
      border-radius:var(--radius-lg);
      width:420px;max-width:calc(100vw - 24px);
      overflow:hidden;
      box-shadow:var(--shadow-lg);
    }
    .crop-header {
      display:flex;align-items:center;justify-content:space-between;
      padding:14px 18px;border-bottom:1px solid var(--border-subtle);
    }
    .crop-title { font-size:15px;font-weight:600;color:var(--text-primary); }
    .crop-close {
      background:none;border:none;color:var(--text-tertiary);
      font-size:18px;cursor:pointer;padding:4px;
    }
    .crop-area {
      position:relative;
      width:100%;height:320px;
      background:#000;overflow:hidden;
      touch-action:none;
    }
    .crop-area canvas {
      width:100%;height:100%;
      cursor:grab;display:block;
    }
    .crop-controls {
      display:flex;align-items:center;gap:10px;
      padding:12px 18px;background:var(--surface-2);
    }
    .crop-zoom-label {
      color:var(--text-tertiary);display:flex;align-items:center;
    }
    .crop-slider {
      flex:1;height:4px;
      -webkit-appearance:none;appearance:none;
      background:var(--border-strong);border-radius:2px;
      outline:none;
    }
    .crop-slider::-webkit-slider-thumb {
      -webkit-appearance:none;appearance:none;
      width:18px;height:18px;border-radius:50%;
      background:var(--brand);cursor:pointer;
      border:2px solid var(--surface-1);
    }
    .crop-slider::-moz-range-thumb {
      width:18px;height:18px;border-radius:50%;
      background:var(--brand);cursor:pointer;border:2px solid var(--surface-1);
    }
    .crop-footer {
      display:flex;gap:10px;padding:14px 18px;
      border-top:1px solid var(--border-subtle);
    }
    .crop-footer .btn { flex:1;justify-content:center; }

    /* Mobile adjustments */
    @media (max-width:768px) {
      .photo-picker-sheet { max-width:100%;border-radius:var(--radius-xl) var(--radius-xl) 0 0; }
      .crop-modal { width:100%;max-width:100%;border-radius:var(--radius-xl) var(--radius-xl) 0 0;max-height:100vh; }
      .crop-area { height:280px; }
      .crop-overlay { align-items:flex-end; }
    }
  `;
  document.head.appendChild(s);
}
