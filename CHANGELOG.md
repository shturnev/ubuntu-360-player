# CHANGELOG
All notable changes to this project will be documented in this file.

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
