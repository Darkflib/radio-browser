# Radio Browser

A single-page global radio app: browse thousands of live internet radio stations on an
interactive 3D vector globe and play them straight in the browser.

Built with **Vite** and **vanilla JavaScript** — no React, no Tailwind, no UI libraries.
Custom CSS, the Inter typeface, and a minimalist white aesthetic (Linear/Vercel style).

## Features

- **Live data** — fetches the top 10,000 stations by popularity from
  [radio-browser.info](https://www.radio-browser.info/) at runtime (no static fixtures),
  with automatic API-mirror selection and a 3-attempt retry.
- **Health filtering** — keeps only "healthy" stations: HTTPS streams, known codecs, and
  valid geo-coordinates (~1,800 stations survive the filter).
- **Browser cache** — the filtered station set is cached in `localStorage` for 24h, so
  repeat visits load instantly without re-downloading the full dataset.
- **3D vector globe** — powered by [globe.gl](https://github.com/vasturiano/globe.gl).
  Countries are drawn as accurate filled vector polygons; stations are simple colored
  dots, with names and details in hover tooltips. Clicking a dot starts playback and
  highlights the matching card in the list (and vice versa). Stations that share a
  location (radio-browser stores city-level coordinates) are fanned out into a small
  rosette so each stays clickable; very dense stacks collapse into a single cluster dot
  that opens a picker listing every station there. The base map is bundled, so the globe
  works offline.
- **Filters** — filter by country, genre, and codec. The station count, list, and globe
  markers update synchronously, and each filter's option counts recalculate against the
  current selection.
- **Near me** — the toolbar location button asks for your position (via the browser
  Geolocation API) and re-orders the list by distance, showing a distance badge on each
  station and dropping a pulsing "you are here" ring on the globe. Nothing is sent
  anywhere — the coordinates never leave the page.
- **Dark mode** — a toolbar toggle switches between light and dark themes (globe
  included). The choice is remembered in `localStorage`, and the app follows your OS
  preference until you pick one explicitly.
- **Search** — a ⌘K / Ctrl-K command palette with keyboard navigation.
- **Random station** — the toolbar shuffle button (or the `R` shortcut) plays a random
  station from the current filtered selection.
- **Playback bar** — play/pause, volume, favorite toggle, and a sleep timer.
- **Favorites** — saved in `localStorage` and available as a dedicated filter.
- **Share & deep-link** — the playing station is reflected in the URL as
  `?station=<uuid>`, and the player's share button copies that link (or opens the
  native share sheet on mobile). Opening a shared link selects and plays that
  station on load, fetching it by UUID if it isn't in the cached top set. When the
  browser blocks autoplay on load (no user gesture yet), a small **Play / Dismiss**
  prompt appears so a single click starts playback.

## Development

```bash
npm install     # install dependencies
npm run dev     # start the dev server
npm run build   # produce a production build in dist/
npm run preview # preview the production build locally
```

## Testing

The suite is split into deterministic, merge-gating tests (no network) and an
advisory live canary that is never a merge gate.

```bash
npm test              # unit/integration tests (Vitest, jsdom)
npm run test:watch    # the same, in watch mode
npm run test:coverage # unit tests + enforced coverage thresholds
npm run test:e2e      # Playwright browser flows (API fully mocked)
npm run test:live     # advisory live canary — hits the real service (NOT a gate)
```

- **Unit / integration** ([`tests/unit`](tests/unit)) — the risk-bearing logic:
  - `api.js` — cache freshness & `force`, stale-while-error fallback, bounded
    retries, 429/4xx-vs-5xx policy, mirror re-probing, UUID encoding, the health
    filter, and safe normalisation (numeric fields coerced to finite numbers).
  - `store.js` — country/genre/codec/favorites filtering (incl. compound codecs
    and cross-filtered option counts), near-me ordering, favorites persistence,
    and the sleep timer.
  - `cluster.js` — antimeridian distance, group-radius and spread-limit
    boundaries, centroids, and order-independence.
- **Coverage gates** (enforced in [`vitest.config.js`](vitest.config.js)):
  `api.js` / `store.js` / `cluster.js` at **85%** lines/functions/statements and
  **75%** branches. The WebGL/globe and DOM layers are covered behaviourally by
  the e2e suite instead.
- **E2E** ([`tests/e2e`](tests/e2e)) — five browser flows (initial load,
  filtering/search, playback, deep links, persistence) plus a security
  regression that injects markup into every upstream field and asserts nothing
  executes. Every radio-browser request is intercepted, so e2e never touches the
  network. A small reusable station fixture (healthy, broken, malformed,
  clustered, and hostile-metadata records) lives in
  [`tests/fixtures`](tests/fixtures) and [`tests/e2e/fixtures.js`](tests/e2e/fixtures.js).
- **Live canary** ([`tests/live`](tests/live)) — advisory only. It checks that a
  mirror responds with valid JSON and that some records survive the health
  filter; it never asserts a specific station exists or plays. It runs on a
  schedule via [`.github/workflows/live-canary.yml`](.github/workflows/live-canary.yml).

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the unit tests,
coverage, and production build on Node 20, plus the Playwright e2e job.

## Deployment

Pushing to `main` triggers the GitHub Actions workflow in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds the site and
publishes it to GitHub Pages. Enable Pages for the repository with the **GitHub Actions**
source to activate it.

## Tech notes

- Colored dots on the globe are cached by `stationuuid` so they persist when filters are
  toggled — markers are reused, never recreated.
- Country landmasses are drawn as filled vector polygons from bundled
  [world-atlas](https://github.com/topojson/world-atlas) TopoJSON, keeping the globe
  self-contained, accurate, and fast.
