# Zamer CAD

Professional mobile measuring and drafting concept for interior designers.

Current workspace contains the first interactive prototype and architecture notes.

## What is included

- `prototype/` - browser-based mobile Canvas prototype.
- `docs/architecture.md` - recommended APK/product architecture.
- `docs/export-strategy.md` - DXF/DWG/PDF/IFC export plan.

## Run Prototype

Open `prototype/index.html` in a browser, or serve the folder locally:

```powershell
& "C:\Users\7\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" prototype/server.js
```

Then open:

```text
http://127.0.0.1:4187
```

## Install on a Phone (PWA)

The prototype is an installable Progressive Web App: manifest
(`manifest.webmanifest`), a service worker (`sw.js`, network-first with offline
fallback), and icons in `icons/` (regenerate with `npm run icons`).

- **Quick look on the same Wi-Fi** — start the server bound to the LAN, then open
  the printed `Phone URL` on the device:

  ```powershell
  $env:HOST = "0.0.0.0"; & "C:\Users\7\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
  ```

  Service workers / offline require HTTPS or `localhost`, so over a plain LAN IP
  the app runs but full install/offline is limited.

- **Real install (anywhere + offline)** — deploy the static `prototype/` folder to
  any HTTPS static host (Netlify, Vercel, GitHub Pages), open the URL on the phone,
  then use **Add to Home Screen**. The Node server is only needed for project
  autosave; the app itself runs from the static files.

## Prototype Code Structure

The browser prototype is being refactored from a single monolith toward the
layered architecture in `docs/architecture.md`. Current layout:

```text
prototype/
  core/            DOM-free, unit-tested CAD core (reusable by a future port)
    geometry.js    angle/vector math, arcs, bounds, hit-testing predicates
    blocks.js      furniture block sizing + footprint segments
    dxf.js         DXF serialization
    *.test.js      node:test unit tests
  app.js           UI shell, input handling, rendering (imports ./core/*)
  server.js        static file server + project autosave endpoint
```

`app.js` loads as an ES module (`<script type="module">`) and imports the core.
Rendering is batched: all `draw()` calls coalesce into a single
`requestAnimationFrame`, instead of repainting synchronously per pointer move.

## Tests

Pure core logic is covered by Node's built-in test runner (no dependencies):

```powershell
& "C:\Users\7\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test "core/*.test.js"
```

Or, if `npm` is on PATH, from the `prototype/` folder:

```powershell
npm test
```

## APK Status

This computer currently does not have Flutter, Java, Gradle, or Android SDK installed, so an APK cannot be compiled in this environment yet.
The architecture is designed so the prototype logic can become a Flutter/Kotlin Android app after the Android toolchain is installed.
