// electron-builder settings. The app ships with the same version as the server release it was built
// from, so the version is read from the root package.json instead of being kept in sync by hand.
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const config = {
  appId: 'com.spotless.desktop',
  productName: 'Spotless',
  copyright: 'Spotless contributors, MIT licensed',
  extraMetadata: { version },
  directories: { output: 'dist' },
  files: ['main.js', 'preload.cjs', 'setup.html', 'setup.js', 'icon.png'],
  icon: 'icon.png',
  artifactName: 'Spotless-${version}-${os}-${arch}.${ext}',
  // Releases are attached by CI (.github/workflows/docker.yml), never published from here.
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    artifactName: 'Spotless-Setup-${version}.${ext}',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    category: 'public.app-category.music',
    // No Apple Developer certificate: ad-hoc sign so the app runs on Apple Silicon at all. Gatekeeper
    // still asks the user to allow it once (System Settings -> Privacy & Security -> Open Anyway).
    identity: '-',
    // Hardened runtime with an ad-hoc signature fails library validation at launch.
    hardenedRuntime: false,
    target: [{ target: 'dmg', arch: ['universal'] }],
  },
  linux: {
    category: 'Audio',
    maintainer: 'Spotless contributors <https://github.com/Dj2Swagittarius/spotless>',
    synopsis: 'Desktop app for a self-hosted Spotless music server',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
  },
};

export default config;
