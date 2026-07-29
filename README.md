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
  highlights the matching card in the list (and vice versa). The base map is bundled, so
  the globe works offline.
- **Filters** — filter by country and genre. The station count, list, and globe markers
  update synchronously, and each filter's option counts recalculate against the current
  selection.
- **Search** — a ⌘K / Ctrl-K command palette with keyboard navigation.
- **Playback bar** — play/pause, volume, favorite toggle, and a sleep timer.
- **Favorites** — saved in `localStorage` and available as a dedicated filter.

## Development

```bash
npm install     # install dependencies
npm run dev     # start the dev server
npm run build   # produce a production build in dist/
npm run preview # preview the production build locally
```

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
