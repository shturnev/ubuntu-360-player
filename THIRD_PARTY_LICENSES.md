# Third-party licenses

360 Media Viewer itself is licensed under BUSL-1.1 (see `LICENSE`). It bundles or uses the third-party components
below, each of which stays under its own license. They are separate programs or libraries that the app runs; they are
not relicensed under BUSL-1.1.

## Bundled in the Windows installer

### FFmpeg (`ffmpeg.exe`)

- Package: [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) 5.3.0 (package license: GPL-3.0-or-later).
- Binary: FFmpeg 6.1.1 "essentials" static build from [www.gyan.dev](https://www.gyan.dev/ffmpeg/builds/).
- License: **GNU GPL v3** (the build is configured with `--enable-gpl --enable-version3`).
- Source code of this build: <https://github.com/FFmpeg/FFmpeg/commit/e38092ef93> (and the build configuration in
  `ffmpeg.exe.README`).
- The full license text and build notes ship with the app in
  `resources\app.asar.unpacked\node_modules\ffmpeg-static\` (`ffmpeg.exe.LICENSE`, `ffmpeg.exe.README`).
- The app only starts `ffmpeg.exe` as a separate process (no linking).

### FFprobe (`ffprobe.exe`)

- Package: [`ffprobe-static`](https://github.com/joshwnj/ffprobe-static) 3.1.0 (package license: MIT).
- Binary: FFmpeg 4.0.2 static Windows build (historical Zeranoe build; Zeranoe shut down in 2020), configured with
  `--enable-gpl --enable-version3`, so the binary is licensed under the **GNU GPL v3**.
- Source code: FFmpeg 4.0.2, <https://ffmpeg.org/releases/ffmpeg-4.0.2.tar.xz>.
- Shipped in `resources\app.asar.unpacked\node_modules\ffprobe-static\`.
- Started as a separate process only.

### ExifTool (`exiftool.exe`)

- Package: [`exiftool-vendored.exe`](https://github.com/photostructure/exiftool-vendored.js) 13.64.0 (MIT); the
  bundled ExifTool by Phil Harvey is available under the **Artistic License or GNU GPL v1+**, and includes a
  Strawberry Perl runtime with its own licenses (`Licenses_Strawberry_Perl.zip`).
- Source and license: <https://exiftool.org/> and <https://github.com/exiftool/exiftool>.
- Shipped in `resources\app.asar.unpacked\node_modules\exiftool-vendored.exe\` with its `LICENSE`.
- Started as a separate process only.

### sharp and libvips

- [`sharp`](https://github.com/lovell/sharp) 0.35.x: Apache-2.0.
- `@img/sharp-win32-x64`: Apache-2.0 AND **LGPL-3.0-or-later** (contains prebuilt [libvips](https://www.libvips.org/)
  and its dependencies). Source: <https://github.com/libvips/libvips> and <https://github.com/lovell/sharp-libvips>.
- Shipped in `resources\app.asar.unpacked\node_modules\sharp\` and `...\@img\` with their license files.

## Linux packages (`.deb`, AppImage)

The Linux builds do not bundle FFmpeg, FFprobe or sharp. They do bundle the Perl ExifTool from
[`exiftool-vendored.pl`](https://github.com/photostructure/exiftool-vendored.js) (ExifTool by Phil Harvey,
**Artistic License or GNU GPL v1+**, source: <https://exiftool.org/>), which runs on the system Perl. The `.deb`
depends on the distribution packages `ffmpeg`, `graphicsmagick` and `perl`, which are installed and licensed
separately by your distribution.

## Electron and Chromium

The app runs on [Electron](https://www.electronjs.org/) (MIT). Electron builds ship the licenses of Electron and
Chromium as `LICENSE` and `LICENSES.chromium.html` next to the executable.

## Other npm dependencies

The remaining runtime dependencies (React, Vite build output, Express and others) are distributed under permissive
licenses (MIT, ISC, BSD, Apache-2.0). Their names, versions and licenses are listed in `package.json` and in each
package's own `LICENSE` file inside `node_modules`.

## Obtaining source code

The FFmpeg, ExifTool and libvips sources are available at the links above. If you cannot get them from there, open an
issue at <https://github.com/shturnev/ubuntu-360-player/issues> and we will provide them.
