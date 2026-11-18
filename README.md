![360 Media Viewer — Immersive photo & video viewing for Linux](docs/360-media-viewer-banner.png)

## Hello, this is 360 Media Viewer for Linux and Windows!
> Linux support targets Debian-like distributions (`.deb`, `.AppImage`). Windows 10+ x64 is supported through an NSIS installer.

## Why?
It's straightforward: I love 360 photos and videos, and I also like Linux. To view them, I had to switch to Windows, so I started developing this application. That is how **360 Media Viewer** began, and I hope it will be useful to you too.

## What can?
* Open a media directory or add individual media files and browse them in a thumbnail grid.
* View ordinary photos and videos as well as 360° photos and videos, including Insta360 `.insp` photos and paired `.insv` videos.
* Explore 360° media in an interactive panorama viewer, with a flat-view fallback.
* Correct panorama orientation with yaw, pitch, and roll controls; use center guides in Flat view and save the correction to the local cache.
* Navigate between media items, adjust thumbnail size, and select multiple items.
* Play MP4 video (H.264/HEVC) and convert incompatible videos to H.264 with progress reporting.
* View the original filename, EXIF, and other media metadata, including date, time, and location when available.
* Save a screenshot of a ready 360° panorama or export a copy of the current cached media.
* Preserve image EXIF metadata when creating derived cached images.
* Delete one or multiple media items, including from the full-size viewer: after confirmation, the original files are moved to the Recycle Bin / Trash and their cache is removed. INSV pair deletion is unavailable. **Remove selected from library** only removes items from the list.
* Inspect and clear the local media cache.
* Check, download, and install application updates for supported installations.
* Start the application with a media directory or multiple media files as command-line arguments, or use Open With.

### Opening media

Use **Import folder** to replace the current library, or **Import files** to append
JPG, JPEG, PNG, INSP, MP4, and paired INSV files. Installed desktop integration
also offers 360 Media Viewer in **Open With** (Linux: JPG, JPEG, PNG, INSP, and MP4;
Windows: JPG, JPEG, PNG, MP4, INSP, and INSV).
Opening files in an already running instance appends them. A directory passed
alongside files replaces the library first, then the files are added.

### Insta360 INSV video

Import a folder containing both lens files, or select both files together with
**Import files**. The filenames must match the Insta360 pattern
`VID_YYYYMMDD_HHMMSS_00_NNN.insv` and `VID_YYYYMMDD_HHMMSS_10_NNN.insv`,
with the same date, time, and numeric identifier in the same folder. A valid
pair appears as one item; incomplete, ambiguous, or incompatible pairs are
reported as errors. Each lens must contain compatible square H.264 video.

The viewer streams both lenses and stitches them in WebGL without creating a
full MP4. During import it prepares a stitched thumbnail and, where supported,
an experimental gyro stabilization track. Gyro stabilization is currently
calibrated for normal video from Insta360 One2; unsupported recordings fall
back to horizon leveling or no correction, with a warning. Initial preparation
can be slow or time out; the motion track is cached for unchanged files.

Stitching and motion correction are approximate, not factory calibration or
FlowState: seams, parallax, and residual motion may remain. Both 360° and Flat
views can save a screenshot of the current view, not a full-resolution
spherical export. Full-video export, pair deletion, and manual orientation
correction are unavailable for INSV pairs. Audio is played only from the first
lens; recordings with audio only in the second lens currently play silently.

## Where to download the 360 Media Viewer?
[https://viewer360.app/](https://viewer360.app/) or check the [release page](https://github.com/shturnev/ubuntu-360-player/releases)

### Linux

Install a local Debian package with APT, which will resolve its declared
dependencies (including `ffmpeg`, `graphicsmagick`, and `perl`):

```bash
sudo apt install ./dist_electron/<package>.deb
```

Run the AppImage after marking it executable:

```bash
chmod +x dist_electron/<package>.AppImage
./dist_electron/<package>.AppImage
```

The AppImage is portable, but not universally dependency-free: some Linux
distributions require a compatible FUSE runtime to launch it. Install `perl`
and make it available in `PATH` for EXIF preservation; the bundled ExifTool
uses the system Perl runtime. Without it, imports requiring a derived image
and orientation correction fail with an error instead of saving without EXIF.
Media processing also requires `ffmpeg`, `ffprobe`, and GraphicsMagick.
Exports to filesystems without hard-link support fall back to a copy; `python3` is no longer required.

The Debian package registers a private `image/x-360-media-viewer-insp` MIME
type for `.insp` files, because the system MIME database does not generally
define that extension. The AppImage includes the same MIME definition; making
it available to a desktop environment requires an AppImage integration tool.
Neither package makes the application the default file handler.

### Windows

Windows 10 or newer (x64) is supported. Download `360-media-viewer-<version>-setup.exe`
from the [Releases](https://github.com/shturnev/ubuntu-360-player/releases) page and run it.
The installer is per-user (no administrator rights) and lets you pick the install directory.

- No extra software is needed: `ffmpeg`, `ffprobe`, ExifTool (the standalone `.exe`, no Perl)
  and `sharp` for thumbnails are bundled. Set `SHT_VR_TOOLS=system` to use `ffmpeg`/`ffprobe`
  from `PATH` instead.
- The installer adds 360 Media Viewer to **Open with** for JPG, JPEG, PNG, MP4, INSP and INSV.
  It never changes your default applications.
- Data lives in `%USERPROFILE%\.sht-vr-player` (or `%SHT_VR_HOME%\.sht-vr-player`).
- Windows normally forbids symlinks without Developer Mode. The original cache therefore tries
  a symlink, then a copy (images) or hard link (videos), and finally serves the original video
  directly, so large videos are not duplicated. Deleting the cache never touches originals.
- Updates are published as `latest.yml` next to the installer.

Known limitations: the installer is not code-signed, so Windows SmartScreen may warn on
first launch. Click **More info** → **Run anyway** to continue. Bundled `ffmpeg-static` is a GPL build (GPL-3.0-or-later); keep its license
in mind when redistributing the installer. The release workflow builds the installer on a
Windows runner and runs the smoke test; interactive behaviour (installer, import, export,
auto-update) has not been verified on a clean Windows machine yet.

## Keyboard shortcuts

Shortcuts work when the application window is focused. Letter shortcuts use
physical key positions, so they also work with other keyboard layouts. They
do not trigger application actions while typing or when a conflicting dialog
is open. The browser defaults for `Ctrl+O`, `Ctrl+Shift+O`, `Ctrl+P`,
`Ctrl+S`, and `F1` are still suppressed in those contexts.

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` | Open a folder for import. |
| `Ctrl+Shift+O` | Add media files to the current library. |
| `Ctrl+P` | Save a screenshot of the ready 360° panorama. Also available in Flat view for INSV pairs; unavailable in other Flat views or fallback. |
| `Ctrl+S` | Save a byte-for-byte copy of the current cached media file, which may differ from the original after conversion or orientation correction. Not available for INSV pairs. |
| `F1` | Open Settings. |
| `I` | Show information about the current media; pauses video. |
| `O` | Toggle orientation correction for the current media, except INSV pairs. |
| `Space` | Play or pause video. |
| `Left` / `Right` | Show the previous / next media. |

The shortcuts are also listed in Settings and on the empty-library screen.

## Releases and updates

When a pull request is merged into `main`, maintainers must apply exactly one
release label to create a release: `release:major` for incompatible changes,
`release:minor` for backwards-compatible functionality, or `release:patch`
for backwards-compatible fixes. Merges without exactly one of these labels do
not change the version. The versioning workflow creates the version commit,
tag, and changelog entry, then starts the release workflow. The release
workflow tests the tagged commit, builds the Linux `.deb` and `.AppImage`
packages and the Windows NSIS installer, generates the update metadata
(`latest-linux.yml`, `latest.yml`), and attaches those release assets to
the matching GitHub Release.

Maintainers can also run **Manual SemVer release** from the Actions tab while
on `main`. They must explicitly select `major`, `minor`, or `patch`; the
workflow creates the same version commit, tag, changelog entry, and release
assets as the PR-label process.

The application checks published GitHub Releases when update checks are enabled.
It first offers **Download update**; downloading never restarts the application.
After the download completes, **Restart and install** requires separate explicit
confirmation. AppImage and `.deb` installations use the release metadata directly.
Installing a `.deb` update requires administrator authorization and a working
system package manager. This update path is intended until a hosted APT
repository is available. Auto-update requires a GitHub Release containing the
packages and its update metadata.

## What is planned?
- Support for other formats:
    - gopro

## Development

### Modern Electron + React build
- Electron: 45.x
- Node.js: 20.19.x or 22.12+
- Renderer: React 18
- Build tool: Vite
- Packaging: electron-builder for Linux `.deb` and `.AppImage`, and a Windows NSIS installer

Local development:

```bash
npm install
npm run dev
```

Environment configuration:

```bash
cp .env.example .env
# optionally edit .env and set DEV_SERVER_PORT=5173
```

Supported variables:

- `DEV_SERVER_PORT` — base port for the Vite dev server. The app probes up to 5 ports starting at this value (for example `5173` to `5177` by default). Invalid values fail fast with a descriptive error.
- `SHT_VR_HOME` — optional override for the app data root. The application uses `<SHT_VR_HOME>/.sht-vr-player` as the storage root and falls back to `HOME`/`os.homedir()` when it is unset. The storage directory name remains unchanged to preserve existing user data.
- `SHT_VR_TOOLS` — set to `system` to use `ffmpeg`/`ffprobe` from `PATH` instead of the bundled Windows binaries.

The repo keeps `.env` and local variants ignored, while `.env.example` remains tracked and safe to commit.

### Build and install release artifacts

```bash
npm install
npm run electron:build
```

This builds the production renderer and packages both Linux artifacts in
`dist_electron/`:

- `*.deb`
- `*.AppImage`

On Windows, build the installer with `npm ci` and
`npm run electron:build -- --win --publish never`. It produces
`*-setup.exe`, its `.blockmap`, and `latest.yml`. Check the bundled tools with
`node electron/smoke-tools.js`.

Maintainers planning Snap Store or repository-wide APT distribution should
follow [the distribution guide](docs/distribution.md). A local `.deb` is not
sufficient to make `apt install <package>` work on arbitrary machines.

### Available npm scripts

- `npm run dev` — starts the Vite renderer and Electron app together. Electron starts after Vite is listening on port `5173`; both processes stop if either one exits.
- `npm run dev:renderer` — starts the Vite development server, listening on all network interfaces (`0.0.0.0`).
- `npm run dev:electron` — waits for the Vite server on port `5173`, then launches Electron.
- `npm run build` — builds the production renderer into `dist/`.
- `npm run preview` — serves the built renderer locally for preview. Run `npm run build` first.
- `npm test` — runs the Jest test suite serially.
- `npm run electron:build` — builds the renderer, then packages the app for the targets configured in `electron-builder.json` (Linux `.deb`/`.AppImage` on Linux; pass `--win` for the Windows installer).
- `npm run electron:dist` — alias for `npm run electron:build`; it always builds the renderer before creating the release artifacts.

## How to help the project?
* The best way is to [**become a sponsor**](https://www.privat24.ua/send/krdrh) . I will be very grateful to you because it will allow me to focus on development, rather than finding food.

* If you are a designer, you can help with the visual design. Help is needed in the design of [https://viewer360.app/](https://viewer360.app/), and the interface in the application.

* The source code is available under the [Business Source License 1.1](LICENSE). The application is **free** for personal and commercial use on the terms in `LICENSE`. Contributors may create forks, issues, and pull requests to improve this project. Competitive production use is prohibited until the Change Date.

## Are you in touch?
Of course, you can always contact me at this email: **sergii@shturnev.com**

<p align="center">
  <img src="docs/works-on-my-machine.png" alt="Works on my machine" width="320">
</p>
