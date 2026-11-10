## Hello, this is a 360-media-player for Linux (for you)!
> At the moment, it is a strong word. Because at now it’s only for Debian-like distributions. But this is cool too, right? And over time, we will do porting for other popular Linux distributions.

## Modern Electron + React build
This project has been migrated from the legacy Vue 2 + Quasar + Electron 7 stack to a supported Electron + React + Vite configuration.

- Electron: 33.x
- Node.js: 20 LTS
- Renderer: React 18
- Build tool: Vite
- Packaging: electron-builder for Linux `.deb`

Local development:

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run electron:build
```

### Available npm scripts

- `npm run dev` — starts the Vite renderer and Electron app together. Electron starts after Vite is listening on port `5173`; both processes stop if either one exits.
- `npm run dev:renderer` — starts the Vite development server, listening on all network interfaces (`0.0.0.0`).
- `npm run dev:electron` — waits for the Vite server on port `5173`, then launches Electron.
- `npm run build` — builds the production renderer into `dist/`.
- `npm run preview` — serves the built renderer locally for preview. Run `npm run build` first.
- `npm test` — runs the Jest test suite serially.
- `npm run electron:build` — builds the renderer, then packages the app with the targets configured in `electron-builder.json`.
- `npm run electron:dist` — packages the app as a Linux `.deb`. This command does not build the renderer, so run `npm run build` first to include the latest renderer changes.

## Why?
It's straightforward, I love 360-photo and 360-video, and I even have a camera for this, and I also like linux... it's all great, but in order to watch my (or your) cool 360’s I had to switch to windows, which is at least not user-friendly! And the search for suitable software did not materialize. Well, enough to endure it – I decided and started developing this application. So **360-media-player** appeared, and I hope that it will be useful to you as well as to me. 

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
- Display ordinary photo and video, not 360. To be able to use, including as a regular media-player.
- Support for other formats:
    - insta360
    - gopro

 

## How to help the project?
* The best way is to [**become a sponsor**](https://www.liqpay.ua/en/checkout/card/sht360player) . I will be very grateful to you because it will allow me to focus on development, rather than finding food.

* If you are a designer, you can help with the visual design. Help is needed in the design of [sht-360-player.cf](https://sht-360-player.cf), and the interface in the application.

* And if you are like a programmer, then 360-media-player is open to your code. It is created under the open MIT license, and you can safely make your changes (I'm waiting for your pull-requests).
  

## Are you in touch?
Of course, you can always contact me at this email: **sergii@shturnev.com**
