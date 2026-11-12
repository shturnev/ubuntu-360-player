## Hello, this is 360 Media Viewer for Linux!
> At the moment, it is a strong word. Because at now it’s only for Debian-like distributions. But this is cool too, right? And over time, we will do porting for other popular Linux distributions.

## Modern Electron + React build
This project has been migrated from the legacy Vue 2 + Quasar + Electron 7 stack to a supported Electron + React + Vite configuration.

- Electron: 45.x
- Node.js: 20 LTS
- Renderer: React 18
- Build tool: Vite
- Packaging: electron-builder for Linux `.deb` and `.AppImage`

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

The repo keeps `.env` and local variants ignored, while `.env.example` remains tracked and safe to commit.

## Build and install release artifacts

```bash
npm install
npm run electron:build
```

This builds the production renderer and packages both Linux artifacts in
`dist_electron/`:

- `*.deb`
- `*.AppImage`

Install a local Debian package with APT, which will resolve its declared
dependencies (including `ffmpeg` and `graphicsmagick`):

```bash
sudo apt install ./dist_electron/<package>.deb
```

Run the AppImage after marking it executable:

```bash
chmod +x dist_electron/<package>.AppImage
./dist_electron/<package>.AppImage
```

The AppImage is portable, but not universally dependency-free: some Linux
distributions require a compatible FUSE runtime to launch it.

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
- `npm run electron:build` — builds the renderer, then packages the app as the `.deb` and `.AppImage` targets configured in `electron-builder.json`.
- `npm run electron:dist` — alias for `npm run electron:build`; it always builds the renderer before creating both release artifacts.

## Why?
It's straightforward: I love 360 photos and videos, and I also like Linux. To view them, I had to switch to Windows, so I started developing this application. That is how **360 Media Viewer** began, and I hope it will be useful to you too.

[//]: # (### Where can I download?)

## What can?
* View directory, convenient preview of media files.
* Support 360-photo (jpg)
* Support 360-video (mp4 HEVC/H.264 and convert other to H.264)
* Ability to delete unnecessary media
* Ability to clear accumulated cache
* Ability to delete when viewing in full size
 

## What is planned?
- Ability to view exif information. (date / time / location, etc.)
- Ability to edit photos. Horizon alignment (a vital feature, as for me)
- Ability to take screenshot of the panorama area
- Display ordinary photos and videos, not just 360-degree media.
- Support for other formats:
    - insta360
    - gopro

 

## How to help the project?
* The best way is to [**become a sponsor**](https://www.liqpay.ua/en/checkout/card/sht360player) . I will be very grateful to you because it will allow me to focus on development, rather than finding food.

* If you are a designer, you can help with the visual design. Help is needed in the design of [sht-360-player.cf](https://sht-360-player.cf), and the interface in the application.

* If you are a programmer, 360 Media Viewer is open to your contributions under the MIT license. Pull requests are welcome.
  

## Are you in touch?
Of course, you can always contact me at this email: **sergii@shturnev.com**
