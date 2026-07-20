# Zamer CAD

Professional mobile measuring and drafting concept for interior designers.

Current workspace contains the first interactive prototype and architecture notes.

## What is included

- `prototype/` - browser-based mobile Canvas prototype.
- `docs/architecture.md` - recommended APK/product architecture.
- `docs/export-strategy.md` - DXF/DWG/PDF/IFC export plan.

## Run Prototype

Serve the app locally from the repo root:

```powershell
cd prototype
node server.js
```

Then open:

```text
http://127.0.0.1:4187
```

If `node` is not on PATH inside Codex Desktop, use the bundled runtime path shown
by Codex workspace dependencies, for example:

```powershell
& "C:\Users\7\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

## Install on a Phone (PWA)

The prototype is an installable Progressive Web App: manifest
(`manifest.webmanifest`), a service worker (`sw.js`, network-first with offline
fallback), and icons in `icons/` (regenerate with `npm run icons`).

- **Quick look on the same Wi-Fi** — start the server bound to the LAN, then open
  the printed `Phone URL` on the device:

  ```powershell
  cd prototype
  $env:HOST = "0.0.0.0"; & "C:\Users\7\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
  ```

  Service workers / offline require HTTPS or `localhost`, so over a plain LAN IP
  the app runs but full install/offline is limited.

- **Real install (anywhere + offline)** — deploy the complete `prototype/` app and
  its Node API to one HTTPS domain with persistent server storage. A static host by
  itself is no longer sufficient because accounts, project revisions, and conflict
  recovery are server features. Follow [`docs/deployment.md`](docs/deployment.md).

## Temporary Public Phone Link

For quick testing outside the local network, use Cloudflare Quick Tunnel:

```powershell
cd C:\path\to\zamer
.\tools\cloudflared.exe tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:4187
```

Quick Tunnel URLs are temporary. For an APK that updates reliably, use a fixed
domain or named Cloudflare Tunnel.

## Fresh Setup on Another Computer / Codex

1. Install Git and Node.js 20+.
2. Clone the repository:

   ```powershell
   git clone <your-github-repo-url>
   cd <repo-folder>\prototype
   ```

3. Run the server:

   ```powershell
   node server.js
   ```

4. Open `http://127.0.0.1:4187`.

Project files, revision history, deleted-project recovery files, and login/session
data are intentionally ignored by Git. They are runtime data and must live in the
persistent server volume, not in the source repository.

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

## Deploy To A Real Domain

The urgent closed-beta deployment uses Docker, a persistent data volume, Caddy HTTPS,
server-side project revisions, recoverable deletes, and automatic conflict copies.
See [`docs/deployment.md`](docs/deployment.md) for the DNS, server, backup, update,
and pre-measurement checklist.

## APK Status

This computer currently does not have Java/Gradle/Android SDK installed, so an
APK cannot be compiled in this environment yet.

Recommended APK path:

- Wrap this PWA in an Android shell using Capacitor or a Trusted Web Activity.
- Point the APK at a fixed HTTPS domain so app updates can ship from the server.
- Build release APK/AAB after Android Studio or Android command-line tools are installed.
