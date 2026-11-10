# Electron 回归测试入口与覆盖清单

## 迭代门禁

```sh
npm ci
npm run verify
```

`npm test` 自动收集 scripts/ 内 `*.test.cjs` 和 `test-*.cjs`；原来的 test:vpn 仅为子集，不可当全部回归。`verify` 再校验主进程/renderer 语法。不会启动主程序、连接 VPN、改系统证书或安装 MSI。需要本地 ffmpeg-static（npm 安装的既有依赖）执行真实转码；依赖不可用应报告失败，不能静默跳过。

本仓库尚未接入实际 CI 服务，CI 安装依赖后应执行上述命令。当前测试需完整相邻 Web 工作区，若干已有跨项目契约用例会读取 ../jitsi-meet-web；独立 clone 的 CI 须以此目录结构同时检出两仓库，不能把文件缺失当成功或跳过。

## 2026-11-07 覆盖盘点

| 领域 | 用例 | 限制 |
| --- | --- | --- |
| 部署入口/端口、构建模式、单实例 | deployment-config、deployment-port、build-mode、single-instance | 配置/逻辑验证，不代表 MSI 安装 |
| TLS 信任边界 | private-ca、server-trust | 本地证书正反例；verify-server-trust 为显式在线校验，不并入离线门禁 |
| 全屏事件链（新增） | fullscreen-lifecycle.test.cjs | 执行 main 事件绑定与 renderer 真函数；六轮状态/标签/控件、RAF 取消、重复尺寸去重、同尺寸最大化/全屏、隐藏/断开 iframe；不代替真实窗口视觉 |
| 日志断管 | stdio-guard.test.cjs | 同步/异步 EPIPE、真实父进程关闭管道、非 EPIPE 不吞掉 |
| 共享控制、轨道替换、失败/结束 | share-controller、share-capture、share-floater-recording | 行为状态机；原生 Chromium 独立专项见下 |
| 录制/设置/保存/转码 | multi-recording-*、settings-*、test-recording-* | 本次统一入口补入原先遗漏的 3 个录制脚本，包括真实 FFmpeg VP8/Opus→MP4、损坏输入、原片保留 |
| VPN、离线引导、系统隔离 | offline-entry、openvpn-*、windows-vpn、vpn-*、no-system-vpn | 以替身隔离系统操作，不证明驱动、提权或真实隧道 |
| 安装器与版本 | installer-*、unified-msi | 多数为配置/构造约束；不是实际安装/升级/卸载 |

部分旧用例为源码文本约束/VM 函数提取，不是完整 UI 挂载。新增用例优先执行实际函数、计时任务与事件，不以“代码有某字符串”代替用户结果。Node 的旧脚本文件计数不能当成覆盖率。

## 可显式执行的本地原生专项

```sh
npm run test:native-share
```

现有 verify-share-electron.cjs 使用隔离 profile、本地合成视频和真实 Chromium/WebRTC，不用真实摄像头、麦克风或会议；仍需可运行 Electron 的桌面会话。与 npm test 分列结果，执行失败不得用离线单测代替成功。verify-vpn-electron/verify-openvpn-live 涉及系统/网络，须明确授权和配置，不自动运行。

本轮实测：`npm run verify` 128/128 通过；原生专项首次发现旧“7 个按钮”断言失败，改为验证 8 个控件身份、无权限隐藏录制、有权限显示停止录屏/pressed 状态、防重复点击及真实 IPC 后重跑全部通过。原生专项同时通过嵌套 sandbox preload 隔离、WebRTC 暂停/恢复/换源像素及稳定 sender track、失败换源保留画面、Windows 隐藏窗口边界探测。`docs/share-toolbar-preview.png` 为本地合成专项更新的截图，不是真实会议或摄像头图像。

## 发布前仍须人工/设备验收

- 实际 Windows 窗口/多屏 DPI/最大化/原生与 HTML 全屏反复切换；标题栏/iframe 几何一致。
- 父终端退出后真实应用继续入会/共享，无 EPIPE 弹窗；Node 真管道测试是自动化证据，不能冒充整机测试。
- 真实摄像头/麦克风/JVB 双向媒体，屏幕/窗口共享切换与录制播放；断网/退会清理。
- MSI 新装/同版本重装/升级/卸载、安装目录、签名、VPN 提权/服务/真实连接。
- Release 禁用 DevTools 和单实例行为；私有 CA 正反例和非目标 origin 无全局放宽。

目前没有完整的自动化桌面 E2E/截图差异门禁；将其列为缺口，不将全部功能标为自动回归覆盖。新增功能应随修复附带红→绿测试，并更新本表及人工验收证据。
