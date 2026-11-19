# CHANGELOG
All notable changes to this project will be documented in this file.

## [3.10.1] - 2026-11-19
### Changed
- Fix Unicode EXIF paths and empty folder imports ([#104](https://github.com/shturnev/ubuntu-360-player/pull/104))

## [3.10.0] - 2026-11-19
### Changed
- Add lens FOV correction for INSP and INSV ([#102](https://github.com/shturnev/ubuntu-360-player/pull/102))

## [3.9.4] - 2026-11-19
### Changed
- Limit memory peaks during INSP imports ([#100](https://github.com/shturnev/ubuntu-360-player/pull/100))

## [3.9.3] - 2026-11-19
### Changed
- docs: license note in every release, Zeranoe wording ([#98](https://github.com/shturnev/ubuntu-360-player/pull/98))

## [3.9.2] - 2026-11-19
### Changed
- chore: remove unused trash dependency ([#97](https://github.com/shturnev/ubuntu-360-player/pull/97))

## [3.9.1] - 2026-11-19
### Changed
- docs: third\-party licenses \(\#92\) ([#96](https://github.com/shturnev/ubuntu-360-player/pull/96))

## [3.9.0] - 2026-11-18
### Changed
- feat: Delete moves original files to the trash \(\#92\) ([#95](https://github.com/shturnev/ubuntu-360-player/pull/95))

## [3.8.1] - 2026-11-18
### Changed
- fix: stabilize release CI tests and Windows smoke check \(\#76\) ([#94](https://github.com/shturnev/ubuntu-360-player/pull/94))

## [3.8.0] - 2026-11-18
### Changed
- feat: Windows x64 support \(\#76\) ([#93](https://github.com/shturnev/ubuntu-360-player/pull/93))

## [3.7.0] - 2026-11-18
### Changed
- Fix INSV orientation and autoplay videos ([#89](https://github.com/shturnev/ubuntu-360-player/pull/89))

## [3.6.1] - 2026-11-18
### Changed
- Fix packaged INSV startup and update README ([#88](https://github.com/shturnev/ubuntu-360-player/pull/88))

## [3.6.0] - 2026-11-18
### Changed
- feat: add paired INSV playback and stabilization ([#87](https://github.com/shturnev/ubuntu-360-player/pull/87))

## [3.5.0] - 2026-11-16
### Changed
- Add individual media file imports ([#83](https://github.com/shturnev/ubuntu-360-player/pull/83))

## [3.4.1] - 2026-11-15
### Changed
- Manual patch release.

## [3.4.0] - 2026-11-15
### Changed
- feat: add panorama orientation correction ([#72](https://github.com/shturnev/ubuntu-360-player/pull/72))

## [3.3.0] - 2026-11-14
### Changed
- Support opening media directories from desktop ([#69](https://github.com/shturnev/ubuntu-360-player/pull/69))

## [3.2.0] - 2026-11-14
### Changed
- feat: save 360 panorama screenshots ([#66](https://github.com/shturnev/ubuntu-360-player/pull/66))

## [3.1.4] - 2026-11-13
### Changed
- style: format release validation files ([#63](https://github.com/shturnev/ubuntu-360-player/pull/63))

## [3.1.3] - 2026-11-13
### Changed
- fix\(ci\): synchronize electron\-builder lockfile ([#61](https://github.com/shturnev/ubuntu-360-player/pull/61))

## [3.1.2] - 2026-11-13
### Changed
- Manual patch release.

## [3.1.1] - 2026-11-13
### Changed
- Manual patch release.

## [3.1.0] - 2026-11-13
### Changed
- Update changelog and donation link ([#48](https://github.com/shturnev/ubuntu-360-player/pull/48))

## [3.0.2] - 2026-11-12
### Changed
- ci: automate SemVer releases from merged PRs ([#42](https://github.com/shturnev/ubuntu-360-player/pull/42))

## [3.0.1] - 2026-11-12
### Fixed
- Restored ESLint 9 compatibility with `eslint-plugin-react` so `npm ci` and
  the GitHub Actions release workflow can install dependencies successfully.

### Changed
- Defined the licensed work without a release version, so future releases do
  not require a LICENSE update.

## [3.0.0] - 2026-11-12
### Description
First public release of 360 Media Viewer for Linux, with refreshed branding,
packaging, and GitHub Releases updates.

### Added
- AppImage packaging alongside the Debian package.
- GitHub Actions release workflow that builds, tests, and publishes Linux
  release assets.
- GitHub Releases update flow for AppImage installations, including explicit
  download and install confirmation.
- Improved 360-degree viewer controls and navigation.
- ESLint and Prettier checks.

### Changed
- Renamed the application and Linux package from 360 Media Player to 360 Media
  Viewer.
- Updated the application icon, branding, and main interface.
- Changed the license from MIT to Business Source License 1.1.
- Preserved the selected folder when importing media and corrected media URL
  encoding for filenames.

### Breaking changes
- The Debian package name changed from `360-media-player` to
  `360-media-viewer`; existing `.deb` installations require a manual migration
  to the new package.


## [1.0.4] - 2020-03-07
### Description
Features for clearing and deletion items

### Added 
- Deletion media item in opened view
- Clearing selected media items (without deletion from disc)
- Changelog



## [1.0.3] - 2020-03-03
### Description
The application learned to check for a new version

### Added 
- Updater - module for check a new version

### Changed
- Reconfigure CI/CD



## [1.0.2] - 2020-01-20
### Description
Small changes. Basically repository settings and CI/CD configurations

### Added 
- License (MIT)

### Changed
- New app icon



## [1.0.1] - 2019-10-17
### Description
VR player birthday  🎉 
### Added 
- View directory as a gallery of media files
- Support VR photo (.jpg)
- Support VR video (.mp4 – up to 4K – limited capacity by Chrome)
- Easy to delete unnecessary media
- Capability to clear accumulated cache
