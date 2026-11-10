# Copilot instructions for sht-vr-player

## Project overview

This repo is a Linux desktop VR/media viewer built with Electron, React, and Vite. The app loads a renderer UI in a BrowserWindow (`electron/main.js`), exposes a tightly-scoped bridge via `electron/preload.js`, and uses the main process for file-system and media operations. The actual viewer logic lives in `src/App.jsx`; the domain logic and media cache handling live under `src/models/`.

The active app is React/Vite (`index.html` → `src/main.jsx` → `src/App.jsx`). Vue/Quasar has been removed; keep renderer changes in React and communicate with the Electron main process only through the existing `window.shtVR` bridge.

## Build, test, and packaging commands

Install dependencies:

```bash
npm install
```

Run the app in development mode:

```bash
npm run dev
```

This launches Vite for the renderer and Electron for the desktop app.

Build the renderer bundle:

```bash
npm run build
```

Package the Electron/Linux app:

```bash
npm run electron:build
```

Create a Linux `.deb` package directly:

```bash
npm run electron:dist
```

Run the full Jest suite:

```bash
npm test
```

Run one test file only:

```bash
npm test -- --runTestsByPath tests/unit/Media.spec.js
```

The repo currently has no lint script configured in `package.json`.

## High-level architecture

- `electron/main.js`
  - Creates the Electron BrowserWindow.
  - Starts the app in dev mode with `http://localhost:5173` or loads the built `dist/index.html` in production.
  - Initializes `MainModelClass` and its IPC listeners.

- `electron/preload.js`
  - Exposes a safe `window.shtVR` API for the renderer.
  - Allows only a fixed allowlist of IPC channels (`open-dir`, `delete-selected`, `get-config`, `start-file-server`, etc.).

- `src/App.jsx`
  - Renderer-side UI for browsing a selected media folder, previewing images/video, and triggering delete/cache actions.
  - Listens to `window.shtVR` events from the main process and renders the gallery/preview state.
- `src/PanoramaViewer.jsx`
  - Renders equirectangular images and videos as an interactive 360° panorama, with a flat-view fallback.

- `src/models/MainModelClass.js`
  - Main process orchestration layer.
  - Starts the local Express static server, reads directories, prepares cache folders, checks config, handles deletions, and triggers update checks.

- `src/models/Media.js`
  - Generates thumbnails and cache entries under the user home directory.
  - Uses symlinks in `~/.sht-vr-player/static/big` to expose files, and generates small thumbnails with `gm`/ImageMagick or `ffmpeg` for video.

- `src/models/ConfigModel.js` and `src/models/Updater.js`
  - Store user settings and app update checks.

- `tests/unit/`
  - Jest tests for the model logic. Keep new tests beside the relevant model file and use the existing Jest + jsdom setup.

## Key conventions and repo-specific patterns

- The generated app data lives outside the repo root, usually under `~/.sht-vr-player` (or `SHT_VR_HOME` when set). Do not assume source files are the runtime data store.
- Main-process I/O is the authoritative layer: directory reads, file deletion, media generation, and cache cleanup stay in the Electron main process; the React renderer should call `window.shtVR.send(...)` and react to events instead of directly touching the filesystem.
- The app uses IPC events and a strict allowlist in `electron/preload.js`; new event channels should be added intentionally and remain in sync with both the preload bridge and the main-process listeners.
- The renderer is React/Vite-only. Keep renderer changes in that stack and leave filesystem/media operations in the main process.
- Existing tests are plain Jest specs under `tests/unit`; use the same naming and file organization (`*.spec.js`) when adding coverage.
