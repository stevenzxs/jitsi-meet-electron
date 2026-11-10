# Windows MSI 安装与升级

最终交付包由 `scripts/unified-msi.cjs` 生成，包含桌面应用和专用 VPN 服务。Forge maker 的中间 MSI 不是统一安装包。

## 用户行为

- 新装：使用系统默认 CloudMeet 安装目录。
- 同系列高版本安装包：通过 MSI 升级机制替换低版本，不要求手动卸载。
- 同版本：完整交互界面询问是否重新安装，默认“否”。否退出，是重新安装。支持重复运行同一 MSI 以及同版本重新构建的 MSI。
- 低版本：检测到更高版本时禁止安装。
- 卸载和升级过程中移除旧产品时不出现重装确认。
- 无完整交互界面的同版本安装默认退出；管理员可明确指定 `CLOUDMEET_REINSTALL=1`。

固定产品系列 UpgradeCode 为 `CF24C64F-7B2E-43DE-92E9-581984AD2437`，检测不限制语言，支持英文旧包到中文包。发布更高版本时递增 package.json 中的三段数字版本。

## 边界

保留历史分体安装包、未知产品系列及旧自定义目录的安全拦截，不自动卸载其他 OpenVPN。安装程序不主动清理用户数据目录；设置、VPN 配置及用户文件保留仍须在实际升级验收中确认。运行中的会议应先退出。

最终 MSI 语言为简体中文，Windows UAC 跟随系统语言；未签名包仍会显示未知发布者，中文化不等于代码签名。

## 构建与验证

使用 `deploy/build-clients.cjs --target electron --env-file <明确的客户端配置>` 构建，避免使用与目标实例不符的默认入口。构建器暂存配置并恢复，最终产物及哈希记录在 deploy/client-builds 的新批次。

自动测试：`node --test scripts/unified-msi.test.cjs scripts/installer-version.test.cjs scripts/private-openvpn.test.cjs`。C# 版本策略测试执行真实比较逻辑；动作测试以 DTF 边界替身覆盖确认和退出，不运行 Windows Installer 事务。

发布验收还需覆盖：新装、高版本替换、英文到中文同版、同版点是/否、同一 MSI 再运行、降级、文件占用、失败回滚、设置保留及 VPN 服务状态。编译和 MSI 数据库核验不能替代实际安装测试。
