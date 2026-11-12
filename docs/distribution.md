# Distribution guide

This guide is for maintainers. It describes future distribution work; it does
not mean the application is currently ready for Snap strict confinement or
hosted APT installation.

## Snap Store checklist

1. Create a Snap Store developer account and register the intended snap name.
2. Add and maintain a `snapcraft.yaml` with accurate app metadata, the
   Electron application launch command, supported architectures, a suitable
   base, and an explicit confinement mode.
3. Configure the Electron desktop extension where appropriate, required plugs,
   and desktop/GUI integration. Test confinement thoroughly; do not claim
   strict confinement support until it has been verified.
4. Verify the app can access user media files (for example through the `home`
   interface or an appropriate file-access design), use the network for update
   checks and its local media server, and integrate with the desktop GUI.
5. Ensure required media utilities are available in the snap or bundled:
   `ffmpeg` and GraphicsMagick or ImageMagick.
6. Build and test the package locally:

   ```bash
   snapcraft
   sudo snap install --dangerous <package>.snap
   ```

7. Publish only after testing with `snapcraft upload <package>.snap`, select
   the intended track and channel, and complete the store review requirements.

See the [Snapcraft documentation](https://documentation.ubuntu.com/snapcraft/)
for current schema, extension, interface, and publishing guidance.

## Hosted APT repository checklist

`sudo apt install ./<package>.deb` installs a local package. Supporting
`sudo apt install <package-name>` from any machine requires a signed APT
repository served over HTTPS; publishing a single `.deb` is not enough.

Before publishing, provide:

- a stable package name;
- repository metadata and layout, including `Packages`, `Release`, and their
  signatures;
- a GPG signing key and a distributable keyring;
- HTTPS hosting;
- suites, components, and architectures as required by the release policy.

For each release, CI or the release maintainer should:

1. Build the `.deb` and AppImage with `npm run electron:build`.
2. Test the `.deb` metadata, declared dependencies, and installation in a
   clean Debian or Ubuntu environment.
3. Publish package artifacts and generated repository metadata.
4. Sign repository metadata with the release GPG key.
5. Update the HTTPS repository, then verify installation from a clean system.

The user-facing setup must use real values only after the repository exists.
Before installing a downloaded keyring, verify that its fingerprint matches
`<GPG-fingerprint>`. For example:

```bash
curl -fsSL https://<repository-domain>/keys/<repository-keyring>.gpg \
  | sudo tee /usr/share/keyrings/<repository-keyring>.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/<repository-keyring>.gpg] \
https://<repository-domain>/apt <suite> <component>" \
  | sudo tee /etc/apt/sources.list.d/<repository-name>.list
sudo apt update
sudo apt install <package-name>
```

Replace every placeholder with the published repository domain, GPG key
fingerprint/keyring, suite, component, and stable package name. Follow the
[Debian repository documentation](https://wiki.debian.org/DebianRepository/Setup)
for current repository publishing and signing practices.
