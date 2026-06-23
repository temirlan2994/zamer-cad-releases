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

## APK Status

This computer currently does not have Flutter, Java, Gradle, or Android SDK installed, so an APK cannot be compiled in this environment yet.
The architecture is designed so the prototype logic can become a Flutter/Kotlin Android app after the Android toolchain is installed.
