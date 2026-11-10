# Debug / Release package implementation plan

**Goal:** Add `package:debug` with F12 and multiple instances; keep `package` and `make` Release-only with DevTools disabled and a single-instance lock.

**Architecture:** Forge reads a build-time mode, writes `cloudmeetBuildMode` into the copied package.json before ASAR creation, and isolates Debug output under `out/debug`. Runtime trusts only the packaged metadata, not environment variables. Unpackaged development remains Debug; absent or invalid packaged metadata defaults to Release.

**Tech stack:** Electron 43, Electron Forge 7, CommonJS, node:test.

## Steps
1. Add failing tests in `scripts/build-mode.test.cjs` and update `scripts/single-instance.test.cjs`: verify packaged Debug policy, fail-closed Release policy, build stamping/output isolation, F12/menu gating, and all BrowserWindow preferences.
2. Implement policy in `src/build-mode.js`; add explicit build-mode scripts to `package.json`. Configure `forge.config.js` `packageAfterCopy` to stamp only copied metadata.
3. Wire policy into `src/main.js` and `src/share-controller.js`: gate DevTools, menu and F12; preserve Release protocol/second-instance behavior.
4. Run targeted tests, then `node --test scripts/*.test.cjs` and `git diff --check`. Build Debug and Release packages when output directories are not in use, inspect ASAR metadata and policy. Never stop a running user client without authorization.
5. Document commands/output in README. Do not install, commit, push, or deploy for this task.

## Acceptance
- Debug executable works without launch environment variables; F12 enabled, no app single-instance lock.
- Release cannot enable DevTools through F12/menu or runtime build-mode environment; app single-instance lock honored.
- Debug packaging does not overwrite Release output or source package metadata; ordinary `make` retains its installer/bundle hooks.
