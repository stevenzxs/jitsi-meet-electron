const path = require('path');
const fs = require('node:fs/promises');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { verifyPayload } = require('./scripts/build-openvpn-bundle.cjs');

// 桌面端统一使用 zhsz 图标；Forge 会按平台读取对应扩展名资源。
const iconPath = path.resolve(__dirname, 'assets', 'icons', 'zhsz');
const pngIconPath = `${iconPath}.png`;
const windowsIconPath = `${iconPath}.ico`;
const buildMode = process.env.CLOUDMEET_BUILD_MODE === 'debug' ? 'debug' : 'release';

// Authenticode signing is enabled only when the release PFX is provided via env;
// builds without it stay unsigned (dev/check machines).
const codeSignPfx = process.env.CLOUDMEET_CODESIGN_PFX;
const codeSignPassword = process.env.CLOUDMEET_CODESIGN_PASSWORD || '';

module.exports = {
  outDir: buildMode === 'debug' ? 'out/debug' : 'out',
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const file = path.join(buildPath, 'package.json');
      const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
      metadata.cloudmeetBuildMode = buildMode;
      await fs.writeFile(file, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    },
    preMake: async () => {
      if (process.platform === 'win32') await verifyPayload();
    },
    postMake: async (_config, results) => process.platform === 'win32'
      ? require('./scripts/unified-msi.cjs').buildUnifiedMsi(results, require('./package.json').version, await verifyPayload())
      : results,
  },
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/ffmpeg-static/ffmpeg*',
    },
    icon: iconPath,
    ignore: [/^\/(?:docs|scripts|out|vendor|\.codegraph|\.omo)(?:\/|$)/],
    ...(codeSignPfx ? {
      windowsSign: {
        certificateFile: codeSignPfx,
        certificatePassword: codeSignPassword,
        signWithParams: '/fd sha256 /td sha256 /tr http://timestamp.digicert.com',
      },
    } : {}),
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-wix',
      platforms: ['win32'],
      config: {
        name: 'CloudMeet',
        manufacturer: 'CloudMeet',
        description: 'CloudMeet desktop meeting client',
        exe: 'cloudmeet',
        icon: windowsIconPath,
        language: 2052,
        cultures: 'zh-CN',
        ui: {
          chooseDirectory: false,
        },
        features: {
          autoLaunch: false,
          autoUpdate: false,
        },
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: pngIconPath,
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          icon: pngIconPath,
        },
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
