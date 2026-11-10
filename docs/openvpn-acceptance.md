# OpenVPN acceptance and release gates

## Implemented scope

Windows x64 offline installer chaining a CloudMeet-owned private runtime MSI and CloudMeet MSI. Vendor MSI is a build-only input, not installed. Isolated CloudMeetVPN service / OpenVPN-CloudMeet registry / openvpn-CloudMeet pipe, headless OpenVPN binaries, Wintun. No OpenVPN GUI, shortcuts or file association. Local-shell import, IPv4 route editor, encryption and management control retained. Existing system VPN controls and meeting URLs remain unchanged. Portable elevation workflow is deferred.

## Automated / read-only checks

- `npm run test:vpn`: route/config rejection, management framing/authentication/credentials, lifecycle/timeout/shutdown, persistence, VM UI, existing Windows VPN authorization/regressions and installer XML.
- `npm run verify:openvpn`: pinned vendor SHA-256 and Authenticode signature.
- `npm run make`: application MSI and offline Burn EXE compilation; does not install anything.
- Clear `ELECTRON_RUN_AS_NODE`, then run `node_modules/.bin/electron scripts/verify-vpn-electron.cjs`: blocks external HTTP(S), inspects real component status, loads local UI, captures screenshot. No dialing or host network changes.

## Mandatory native acceptance (not established by automated mocks)

Use a disposable Windows 10/11 x64 test machine, authorized installation and a real test OpenVPN server/profile. Do not use production user credentials.

| Gate | Expected evidence |
|---|---|
| Clean install | One EXE installs private runtime under Program Files and CloudMeet; no OpenVPN GUI/shortcuts/association, isolated service starts, Wintun creates adapter on connection; handles UAC/reboot/cancellation |
| Standard-user policy | Authorized OpenVPN user can connect without elevating Electron; unauthorized user gets explicit failure |
| Import | Compatible inline cert-only and username/password profiles connect; unsupported directives fail before native launch |
| Explicit IPv4 host/subnet | `Get-NetRoute` / `Find-NetRoute` shows desired selected route, packet capture proves TCP and UDP traverse VPN |
| Nonselected traffic | Public test address retains previous route/egress; global proxy and DNS settings unchanged |
| Server takeover push | Redirect/default/extra routes and DNS pushes do not change global policy; legitimate tunnel setup still works |
| Credentials | No credentials/private keys in argv, UI status or logs; encrypted profile at rest; temporary profile owner-only ACL |
| Authentication failures | Wrong credentials, private-key password, unavailable server and expired cert never show connected |
| Reconnect | Network changes/rekey/reconnect do not leave hold stuck; username/password remains memory-only for reauthentication |
| Disconnect / exit | Only this tunnel exits; selected routes and temporary config removed; other VPN products stay connected |
| Crash | Kill Electron/bridge/OpenVPN separately; record cleanup behavior and orphan handling; no unsupported guarantee of zero residue |
| Upgrade/uninstall | Private service stops/removes with private runtime; unrelated OpenVPN and its shortcuts remain untouched; no orphan CloudMeet route; do not remove shared Wintun driver used by others |
| Existing VPN | Test other VPN/TAP adapters and overlapping local subnets; do not modify other product settings |
| Release | License notices, corresponding source availability and code signing reviewed; bundled OpenVPN security version still appropriate |

## Explicit limitations

Not per-process isolation, no direct-connection kill switch, no IPv6 destinations, MFA/SSO/encrypted-key prompt support or external cert file import. Existing system routes/VPN policies and interface-connected routes may affect path selection. Route presence is not proof of traffic traversal. Runtime plaintext is necessary for OpenVPN and can survive an OS/power crash; investigate user profile ACLs and stale files on test machines before release. Do not claim production readiness until native gates pass.
# 默认目录安装补充验收（取代先前自选目录要求）

- 完整集成 EXE 不显示更改位置按钮、目录输入框或浏览按钮；不恢复旧的 Burn 自定义路径。
- 应用固定使用系统 `ProgramFiles64Folder\CloudMeet`，VPN 位于其 `vpn`；旧非默认目录安装需先卸载，不静默迁移。
- 不修改 `D:\`、`D:\Program Files` 或其他共享父目录权限。
- 下面旧自选目录检查项只作历史记录，不再作为当前交付要求；默认路径的权限、安装、修复、卸载和缩放检查仍需执行。

- 使用完整集成 EXE，只选择一个目录；确认应用位于根目录，VPN 文件位于 `vpn`，不显示额外路径/服务摘要。
- 100%/125%/150%/200% 缩放检查首页及目录页按钮完全处于客户区。
- 本地 NTFS 安全父目录下的新目录安装成功，服务路径和私有注册表均指向 `vpn`。
- 标准用户不能替换根目录、VPN EXE/DLL、子目录或通过父目录删除/替换安装树；管理员维护正常。
- 网络盘、可移动盘、非 NTFS、重解析点、普通用户所有/可写目录、父目录可替换路径应拒绝安装，不能先落地特权二进制。
- 升级沿用根目录；更换目录应拒绝。旧分离目录版要求先卸载，不自动迁移。
- 安装中止/失败、修复、卸载后检查服务和文件归属；不得删除用户额外文件。空的受保护根目录可能保留。
- 当前 C# 自检只验证路径格式和信任 SID，不等于实际 MSI 提权、ACL 对抗及回滚验收通过。
