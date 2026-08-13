// src/lib/invoice-pdf.js
// ─────────────────────────────────────────────────────────────────
// Renders the same HTML used for the "Print / PDF" preview into an
// actual PDF Blob, off-screen, so it can be uploaded to storage and
// linked from a WhatsApp message. Uses html2pdf.js (html2canvas +
// jsPDF under the hood) — no server round-trip needed.
// ─────────────────────────────────────────────────────────────────
// html2pdf.js bundles jsPDF + html2canvas — around 1 MB of JavaScript.
// It used to be a static import, which meant every visitor downloaded it
// before the app could start: the landing page, the login screen and
// every dashboard load all paid for a PDF engine that is only needed
// when someone actually taps "Save as PDF" on an invoice.
//
// Imported on demand instead. The first PDF takes a moment longer to
// start; everything else in the app starts a lot sooner. Cached by the
// browser and the service worker after that first use.
let _html2pdfPromise = null;
function loadHtml2Pdf() {
  if (!_html2pdfPromise) {
    _html2pdfPromise = import('html2pdf.js')
      .then(m => m.default || m)
      .catch(err => {
        _html2pdfPromise = null;   // let the next attempt retry
        throw new Error('Could not load the PDF engine. Check your connection and try again.');
      });
  }
  return _html2pdfPromise;
}

async function generateInvoicePdfBlob(html) {
  const html2pdf = await loadHtml2Pdf();

  const container = document.createElement('div');
  // Position on-screen but invisible — html2canvas has a known bug where
  // elements at left:-99999px render faded/partial because the browser
  // skips painting off-viewport content.
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = '620px'; // matches .page max-width in the invoice HTML
  container.style.background = '#fff';
  container.style.zIndex = '-9999';
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    // Render just the receipt card, not the full synthetic <html>/<body> wrapper
    const target = container.querySelector('.page') || container;
    const blob = await html2pdf()
      .set({
        margin: 0,
        image: { type: 'png' },
        html2canvas: {
          scale: 3,
          backgroundColor: '#ffffff',
          useCORS: true,
          windowWidth: 620,
          logging: false,
        },
        jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
      })
      .from(target)
      .outputPdf('blob');
    return blob;
  } finally {
    document.body.removeChild(container);
  }
}

export { generateInvoicePdfBlob };