/**
 * Globe hover-tooltip HTML builders (pure, dependency-free).
 *
 * This is the injection-sensitive sink: globe.gl renders whatever string the
 * pointLabel callback returns as HTML on hover. Keeping the builders here — free
 * of globe.gl/DOM imports — lets them be unit-tested directly.
 *
 * Defence in depth: every interpolated text field is HTML-escaped and every
 * numeric field is coerced to a finite number, so hostile upstream metadata
 * (e.g. a bitrate of '48"><img onerror=…>') can never inject an element or an
 * event handler even if normalisation upstream were to regress.
 */

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Coerce to a finite number, defaulting to 0 for junk/missing values. */
function finiteOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Tooltip markup for a single station marker. */
export function stationTooltip(d) {
  const codec = d.codec ? ` · ${escHtml(d.codec)}` : '';
  const bitrate = finiteOrZero(d.bitrate);
  const kbps = bitrate > 0 ? ` · ${bitrate} kbps` : '';
  return `
      <div class="globe-tooltip">
        <strong>${escHtml(d.name)}</strong>
        <span>${escHtml(d.country)}${codec}${kbps}</span>
      </div>
    `;
}

/** Tooltip markup for a cluster marker. */
export function clusterTooltip(d) {
  const count = finiteOrZero(d.count);
  const sep = d.country ? ' · ' : '';
  return `
      <div class="globe-tooltip">
        <strong>${count} stations</strong>
        <span>${escHtml(d.country)}${sep}click to list</span>
      </div>
    `;
}
