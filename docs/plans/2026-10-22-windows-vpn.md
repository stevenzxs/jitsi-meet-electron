# Windows System VPN Implementation Plan

**Goal:** 在 Electron 本地设置中管理已有 Windows 系统 VPN：列表、原生拨号、断开、状态和错误。仅步骤 1，不部署服务器。

**Architecture:** renderer → main-frame preload → 校验本地壳来源的 IPC → 独立 VPN 管理器。PowerShell Get-VpnConnection 查询用户/全局配置；rasphone 原生窗口处理凭据；rasdial 断开指定连接。进程参数不经 shell，配置路径由系统范围推导，不接收网页提供的命令或路径。退出应用不自动断开 VPN。

**Tech Stack:** Electron、Node node:test、Windows PowerShell VPN cmdlets、rasphone/rasdial。

## Tasks
1. 为配置列表规范化、平台限制、连接配置白名单、进程调用参数、并发锁、失败和取消后的实际状态编写测试；运行确认失败。
2. 实现独立 windows-vpn.js 与固定查询脚本，运行单元测试。
3. 加入本地壳专用 IPC/preload 和设置 VPN 面板。查询真实状态，不把命令退出成功当作隧道建立成功。
4. 补充 IPC 边界与 UI 接入测试；运行已有回归测试和语法检查。
5. 执行只读系统列表查询、Electron 运行时检查；不创建配置、不连接/断开现有网络。记录环境未配置 VPN 时的测试边界。

## Acceptance
- 可选择用户级/全局系统 VPN；无配置时明确引导 Windows 设置。
- 原生拨号窗口处理认证，客户端不接触密码；仅断开明确选中的配置。
- 状态来自系统查询；异常显示错误，连接结果仍以系统状态为准。
- 禁止 iframe 和非本地壳调用 VPN IPC；禁止并发拨号/断开。
- 真实隧道成功与连通性测试在步骤 2 服务端准备后进行。
