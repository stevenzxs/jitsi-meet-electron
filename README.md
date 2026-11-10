# 云会议 Electron iframe 壳

## 集成 OpenVPN（Windows x64 安装版）

2026-10-22 公网入口迁移为 `https://118.193.36.35:8443/cm/desktop`，由 FRP 转发至 202，与测试 VPN 无依赖。精确匹配旧官方工作台的持久化地址会自动迁移，其他自定义地址保留。官方自签证书按完整 HTTPS/WSS 来源、SHA-256 指纹及有效期校验，不再全局忽略证书错误。普通浏览器仍需手动信任该自签证书；其他自签服务需系统信任。证书于 2027-10-22 到期，换证必须同步更新客户端指纹。运行 `node --test scripts/server-trust.test.cjs` 检查信任规则，使用 Electron 执行 `scripts/verify-server-trust.cjs` 验证真实 HTTPS、Jitsi iframe 和 WSS。

桌面端使用单一本地设置面板：个人信息、录制、视频和 VPN，不展示服务器地址。`/cm/desktop` 的纯图标入口悬停显示“客户端偏好”，直接请求打开同一面板，不再弹出第二套网页设置。新版 Web 需配套新版客户端；旧客户端无响应时明确提示升级。VPN 在固定标题下使用独立垂直滚动的长页面，仅保留集成 OpenVPN，分为连接状态、配置与分流、连接测试。

内网首次启动无需先打开服务器首页：标题栏“设置”始终可用；首页未就绪时显示本地“VPN 设置 / 重新加载”引导，10 秒后提示检查网络或先连 VPN。连接成功后只重试尚未就绪的原页面，不自动刷新已正常打开的首页或会议，不自动拨号，也不改变服务器地址。

录制模式支持多选：主持人视频、共享屏幕、主持人视频＋共享屏幕。每项独立生成视频（文件名分别带“主持人 / 共享屏幕 / 合成”），合成以共享为主、主持人在右下角；合成音频取主持人和共享者麦克风，同一人自动去重，不含电脑共享声音。勾选额外音频时每种输出另存一份音频。共享相关模式要求启动时已有共享；共享结束只保存共享和合成输出，独立主持人输出继续。录制期间锁定模式选择，旧单选设置自动兼容。底部及共享悬浮工具栏均仅主持人可见录屏入口，主持权撤销后停止并保存。此功能需配套更新 Web 会议页和 Electron。

VPN 面板显示独立的连接状态，支持保存本地测试地址并在连接后点击“测试 VPN”。测试地址须为已保存分流范围内的 IPv4 HTTP/HTTPS URL；5 秒超时，不跟随重定向，不绕过 TLS 校验，HTTP 2xx 表示通过。测试结果仅代表目标服务可达，与 VPN 连接状态分开显示。118 PoC 可填写 `http://10.8.0.1/vpn-probe`（先保存 `10.8.0.1/32` 分流）。

集成安装器采用浅色品牌主题，使用客户端图标与中文安装说明，固定安装到系统默认 Program Files 下的 CloudMeet，不提供更改位置功能；保留原生系统按钮和管理员授权。中文说明源文件为 `vendor/openvpn/installer-license.txt`，构建时生成 Unicode RTF，第三方完整许可证仍随运行库分发。

**设置 → VPN** 可导入 `.ovpn`、编辑 IPv4/IP 网段、连接和断开。不需要单独打开 OpenVPN GUI。Windows 系统 VPN 面板及调用接口已移除，不会删除或改动电脑上已有的系统 VPN 配置。

用户名、分流列表和测试地址无需单独点击保存：关闭设置（关闭按钮、Esc 或遮罩）时自动保存修改，校验或写入失败时保留页面并提示。连接前先保存待处理的 VPN 配置；密码不持久保存。录制与视频继续使用原有即时保存规则。

`/cm/desktop` 页内设置新增 **VPN → 打开本地 VPN 配置** 入口，仅 Electron 环境显示。Web 页面只请求打开本地面板，不接触 VPN 凭据或原生操作。该入口需同时更新 Web 静态资源和 Electron 客户端；仅重装客户端不会更新服务器上的首页。旧客户端无响应时会提示升级。来源校验使用客户端实际配置的服务器 origin，不把内网和公网地址视为同一来源。

1. 使用 `out/make/openvpn/x64/CloudMeet-1.0.0-with-OpenVPN-x64.exe` 集成安装器。它离线包含 CloudMeet 私有无界面运行库和 CloudMeet MSI，**不执行官方 OpenVPN MSI、不安装 OpenVPN GUI、不创建其桌面/开始菜单图标或文件关联**。私有内核来自 OpenVPN 2.7.8-I001，配套官方 Wintun 0.14.1；安装需管理员授权，运行 Electron 不要求管理员权限。Wintun 仍需部署 Windows 驱动，不是零系统改动。
2. 导入内联证书 `.ovpn`：必须有 `remote`、`remote-cert-tls server`、`<ca>`；证书/私钥使用 `<cert>`、`<key>` 等块。第一版不支持外部文件、脚本、插件、代理、加密私钥交互、MFA/SSO，以及配置中自带的路由/DNS/management 指令；遇到不支持项明确拒绝，不会原样执行。
3. 在目标列表每行输入一个 IPv4 或 CIDR，点击 **保存分流列表**。单 IP 归一化为 `/32`，网段归一化并去重；支持 `/8` 至 `/32`，最多 128 条，禁止默认路由、localhost、多播和链路本地地址。不支持 IPv6。
4. 根据配置填写用户名/密码，点击连接。显示 **已连接** 必须收到 OpenVPN 的 `CONNECTED` 状态，而非仅启动成功。认证密码不保存；导入的证书配置使用 Windows/Electron safeStorage 加密保存。
5. 修改配置/分流需先断开再保存、连接。退出客户端请求终止自身 OpenVPN。私有运行库安装在 Program Files，服务名 `CloudMeetVPN`，使用 `Software\OpenVPN-CloudMeet` 和 `openvpn-CloudMeet\service`，与共享 OpenVPN 隔离。卸载集成包会移除私有服务和运行库，不删除其他产品的 OpenVPN 或共享驱动。

分流按**系统目标地址**生效，不是应用独占；其他程序访问同一目标也走 VPN。非指定目标保持原有路由；不设置全局代理，不接收服务器推送的默认路由、额外路由和 DNS。隧道自己的地址/必要直连网段仍由 OpenVPN 建立，已有企业路由冲突需实际验证。本功能不是 kill switch：断开后按系统原路由处理。

私有 Interactive Service 对用户权限有自己的限制：当前用户需是管理员组或获授权的 `CloudMeet VPN Administrators` 成员，才能使用用户目录中的配置。CloudMeet 不自动创建该组或扩大用户组权限；公司受管电脑请由管理员创建并授权。组件安装不等于每位标准用户已获授权。

构建：`npm run verify:openvpn` 校验作为构建输入的官方 MSI；`npm run make` 仅解包其白名单文件，校验 Wintun 归档哈希/签名，再编译私有运行库 MSI 和离线集成 EXE。`out/make/wix/x64/CloudMeet.msi` 和 `out/make/private-vpn/x64/CloudMeetVPN.msi` 是中间产物，应分发集成 EXE。`npm run package` 仍仅生成应用目录。免安装版连接时提权流程尚未实现，不能将应用目录当作完整便携 VPN。第三方许可及源码提供义务见 `vendor/openvpn/README.md`。

旧测试版已安装的 OpenVPN GUI/图标不会自动删除，以免破坏其他软件依赖；确认无人使用后由用户自行卸载。新安装包不再创建它们。

集成 EXE 固定向两个 MSI 传入 `[ProgramFiles64Folder]CloudMeet`（常规系统为 `C:\Program Files\CloudMeet`），私有运行库位于其 `vpn` 子目录。不恢复历史自定义路径，不展示路径/服务摘要，内部应用 MSI 也关闭目录选择。私有 MSI 在写入前检查系统默认路径、目录链接、所有者和权限；只保护新建应用根目录，不修改 D 盘或共享父目录权限。已有非默认目录安装需先卸载旧集成包，不自动迁移。

旧的分离目录版必须先通过原集成包卸载，再安装统一目录版；已有统一目录安装不支持原地更换位置。卸载不递归删除整个根目录，失败后可能保留空的受保护根目录，需管理员确认后手动清理。配置和加密凭据仍在用户数据目录，不随程序目录移动。本地 VPN 面板继续显示从私有注册表读取的实际内核路径和文件版本；缺失时提示未检测到，不将默认路径当作已安装证据。构建需 .NET Framework C# 编译器和 WiX DTF SDK（可用 `WIX_SDK` 指定）。

验证：`npm run test:vpn`；只读 Electron 验证仍使用 `scripts/verify-vpn-electron.cjs`。真实安装、权限、TCP/UDP 分流和路由恢复必须在专用测试机验收，详见 `docs/openvpn-acceptance.md`；单元测试通过不代表已连接真实 VPN。

这是一个极简桌面程序：只提供一个可配置的 iframe URL，点击“加载”后在 Electron 窗口中显示该地址。

现在同时支持 `cloudmeet://join?room=123456789&subject=xxx` 桌面唤起协议：

- Web 分享页会优先尝试唤起桌面端；
- 桌面端收到协议后会弹出“加入会议”窗口；
- 用户填写昵称和密码后，桌面端加载 Web 会议页并加入会议。

## 使用

```bash
npm install
npm start
```

默认 URL 是桌面端工作台：

```text
https://192.168.199.203/cm/desktop
```

在输入框中改成实际 Web 项目根地址即可，例如：

```text
http://localhost:5173/cm/desktop
```

应用会把最近一次加载的 URL 保存在本机 `localStorage` 中。

首次运行桌面端时，应用会向系统注册 `cloudmeet://` 协议；如果换了安装路径或开发入口，重新启动一次桌面端即可刷新注册。
