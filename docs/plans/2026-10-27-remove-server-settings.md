# Remove Server Settings Implementation Plan

**Goal:** 删除 Electron 设置页的服务器分类，不再展示服务器地址。

**Architecture:** 删除菜单、面板、标题映射和打开设置时的地址赋值；保留服务器存储、IPC、来源校验和连接行为。保留个人信息、录制、视频和 VPN 设置。

**Tech Stack:** Electron、HTML、JavaScript、Node.js test runner。

## Approved design

用户已确认直接移除界面而非隐藏，底层连接配置不变。不修改 Web 或部署地址。

## Implementation

1. 在 `scripts/settings-panel.test.cjs` 添加设置分类、打开设置和未知分类回退测试，运行 `node --test scripts/settings-panel.test.cjs` 确认失败。
2. 删除 `src/index.html` 的服务器菜单和面板，删除 `src/renderer.js` 的服务器标题映射和 `preferencesServer` 赋值。
3. 更新 `README.md` 的设置分类说明。
4. 运行新增测试、`npm run test:vpn`、`node --check src/renderer.js` 和 `git diff --check`。仅修改源码，不打包或部署。
