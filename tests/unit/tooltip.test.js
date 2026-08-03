import { describe, it, expect } from 'vitest';
import { escHtml, stationTooltip, clusterTooltip } from '../../src/tooltip.js';
import { XSS } from '../fixtures/stations.js';

// Parse the tooltip HTML the way globe.gl renders it (as real HTML) and prove
// the hostile payload produced no live element or event handler — only the
// three legitimate structural tags (div.globe-tooltip > strong, span).
function assertNoInjection(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  expect(host.querySelector('img, script, svg, iframe')).toBeNull();
  expect(host.querySelector('[onerror], [onload], [onclick]')).toBeNull();
  expect(host.querySelectorAll('*').length).toBeLessThanOrEqual(3);
}

describe('escHtml', () => {
  it('escapes &, <, > and "', () => {
    expect(escHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
  it('renders null/undefined as an empty string', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });
});

describe('stationTooltip', () => {
  it('renders name, country, codec and bitrate for normal data', () => {
    const html = stationTooltip({ name: 'BBC 1', country: 'UK', codec: 'MP3', bitrate: 128 });
    expect(html).toContain('BBC 1');
    expect(html).toContain('UK');
    expect(html).toContain('MP3');
    expect(html).toContain('128 kbps');
  });

  it('omits the bitrate segment when bitrate is 0/absent', () => {
    expect(stationTooltip({ name: 'X', country: 'US', codec: 'MP3', bitrate: 0 })).not.toContain('kbps');
    expect(stationTooltip({ name: 'X', country: 'US', codec: 'MP3' })).not.toContain('kbps');
  });

  it('keeps hostile text fields inert (no injected element/handler)', () => {
    assertNoInjection(stationTooltip({ name: `Evil ${XSS}`, country: XSS, codec: XSS, bitrate: 128 }));
  });

  it('drops a hostile string bitrate — the tooltip injection sink stays safe', () => {
    // Regression guard for the exact finding: even if normalisation upstream
    // regressed and a raw markup string reached the tooltip as `bitrate`, it is
    // coerced to a finite number (→ 0, segment omitted) and cannot inject.
    const html = stationTooltip({
      name: 'Radio', country: 'US', codec: 'MP3',
      bitrate: '48"><img src=x onerror="window.__x=1">',
    });
    assertNoInjection(html);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('kbps'); // NaN → 0 → omitted
  });
});

describe('clusterTooltip', () => {
  it('renders the station count and country', () => {
    const html = clusterTooltip({ count: 12, country: 'Germany' });
    expect(html).toContain('12 stations');
    expect(html).toContain('Germany');
  });

  it('coerces a non-numeric count and keeps a hostile country inert', () => {
    const html = clusterTooltip({ count: '5<script>', country: XSS });
    assertNoInjection(html);
    expect(html).toContain('0 stations'); // '5<script>' → NaN → 0
  });

  it('omits the separator when there is no country', () => {
    expect(clusterTooltip({ count: 3, country: '' })).toContain('click to list');
  });
});
