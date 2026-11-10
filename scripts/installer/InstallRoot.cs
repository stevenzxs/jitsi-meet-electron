using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32;
using Microsoft.Deployment.WindowsInstaller;

public static class InstallRootActions
{
    public static string CompareInstalledVersions(string current, string[] installed)
    {
        Version target = new Version(current);
        string result = "fresh";
        foreach (string value in installed)
        {
            int comparison = new Version(value).CompareTo(target);
            if (comparison > 0) return "downgrade";
            if (comparison == 0) result = "same";
            else if (result == "fresh") result = "upgrade";
        }
        return result;
    }
    [CustomAction]
    public static ActionResult CheckInstallVersion(Session session)
    {
        try
        {
            var versions = new System.Collections.Generic.List<string>();
            foreach (ProductInstallation product in ProductInstallation.GetRelatedProducts("{CF24C64F-7B2E-43DE-92E9-581984AD2437}"))
            {
                if (product.IsInstalled) versions.Add(product.ProductVersion.ToString());
            }
            string policy = CompareInstalledVersions(session["ProductVersion"], versions.ToArray());
            session.Log("CloudMeet install policy: " + policy);
            if (policy == "downgrade")
            {
                using (Record record = new Record(0))
                {
                    record[0] = "已安装更高版本的 CloudMeet，请使用新版安装包。";
                    session.Message(InstallMessage.Error, record);
                }
                return ActionResult.Failure;
            }
            if (policy != "same") return ActionResult.Success;
            if (session["CLOUDMEET_REINSTALL"] != "1")
            {
                int level;
                if (!Int32.TryParse(session["UILevel"], out level) || level < 4)
                {
                    session.Log("Same-version silent reinstall requires CLOUDMEET_REINSTALL=1.");
                    return ActionResult.UserExit;
                }
                using (Record record = new Record(0))
                {
                    record[0] = "已安装相同版本的 CloudMeet，是否重新安装？程序文件将被替换，用户配置和文件将保留。";
                    // MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2: default to No.
                    if (session.Message((InstallMessage)((int)InstallMessage.User | 0x124), record) != MessageResult.Yes)
                        return ActionResult.UserExit;
                }
                session["CLOUDMEET_REINSTALL"] = "1";
            }
            // Same ProductCode (running this exact MSI again) is maintenance,
            // whereas a rebuilt MSI has a new ProductCode and uses MajorUpgrade.
            if (!String.IsNullOrEmpty(session["Installed"]))
            {
                session["REINSTALL"] = "ALL";
                session["REINSTALLMODE"] = "amus";
            }
            return ActionResult.Success;
        }
        catch (Exception e)
        {
            session.Log("CloudMeet version check failed: " + e.Message);
            return ActionResult.Failure;
        }
    }
    static bool Trusted(string sid)
    {
        return sid == "S-1-5-18" || sid == "S-1-5-32-544" ||
            sid == "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    }
    static void Check(string path, bool ancestor)
    {
        if ((File.GetAttributes(path) & System.IO.FileAttributes.ReparsePoint) != 0)
            throw new Exception("不支持使用目录链接：" + path);
        FileSystemSecurity acl = Directory.Exists(path)
            ? (FileSystemSecurity)Directory.GetAccessControl(path)
            : File.GetAccessControl(path);
        if (!Trusted(acl.GetOwner(typeof(SecurityIdentifier)).Value))
            throw new Exception("目录或文件的所有者不受信任：" + path);
        FileSystemRights dangerous = ancestor
            ? FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership
            : FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
              FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (ancestor && (rule.PropagationFlags & PropagationFlags.InheritOnly) != 0) continue;
            if (rule.AccessControlType == AccessControlType.Allow &&
                !Trusted(rule.IdentityReference.Value) && (rule.FileSystemRights & dangerous) != 0)
                throw new Exception("安装路径允许非受信任用户写入，无法使用：" + path);
        }
    }
    static void CheckTree(string path)
    {
        Check(path, false);
        if (Directory.Exists(path))
            foreach (string child in Directory.GetFileSystemEntries(path)) CheckTree(child);
    }
    static string Canonical(string path)
    {
        if (String.IsNullOrWhiteSpace(path) || path.Length > 180 || path.IndexOf(';') >= 0 ||
            path.StartsWith(@"\\") || path.Length < 4 || path[1] != ':' || path[2] != '\\')
            throw new Exception("请选择本地 NTFS 应用目录（最多 180 个字符）。");
        string full = Path.GetFullPath(path).TrimEnd('\\');
        if (!String.Equals(full, path.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) ||
            full == Path.GetPathRoot(full).TrimEnd('\\'))
            throw new Exception("请选择独立的应用目录，不能使用磁盘根目录。");
        DriveInfo drive = new DriveInfo(Path.GetPathRoot(full));
        if (drive.DriveType != DriveType.Fixed || drive.DriveFormat != "NTFS")
            throw new Exception("仅支持本地固定 NTFS 磁盘。");
        return full;
    }
    [CustomAction]
    public static ActionResult ProtectInstallRoot(Session session)
    {
        try
        {
            string root = Canonical(session.CustomActionData["Root"]);
            if (!String.Equals(root, Canonical(session.CustomActionData["Default"]), StringComparison.OrdinalIgnoreCase))
                throw new Exception("仅支持系统默认安装目录，请重新运行完整集成安装包。");
            string saved = session.CustomActionData["Previous"];
            if (!String.IsNullOrEmpty(saved) && !String.Equals(Canonical(saved), root, StringComparison.OrdinalIgnoreCase))
                throw new Exception("检测到旧版自定义安装目录，请先卸载旧集成包，再安装默认目录版本。");
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"Software\OpenVPN-CloudMeet"))
            {
                string previous = key == null ? null : key.GetValue("InstallRoot") as string;
                if (!String.IsNullOrEmpty(previous) &&
                    !String.Equals(Canonical(previous), root, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("更改安装目录前，请先卸载旧版集成包。");
                if (key != null && String.IsNullOrEmpty(previous) && key.GetValue("exe_path") != null)
                    throw new Exception("请先卸载旧版专用 VPN 集成包，再安装此版本。");
            }
            string parent = Path.GetDirectoryName(root);
            if (!Directory.Exists(parent)) throw new Exception("请先创建或选择已存在的安全父目录。");
            for (string p = parent; p != null; p = Path.GetDirectoryName(p)) Check(p, true);
            if (Directory.Exists(root)) CheckTree(root);
            else
            {
                DirectorySecurity acl = new DirectorySecurity();
                acl.SetAccessRuleProtection(true, false);
                acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
                foreach (string sid in new [] { "S-1-5-18", "S-1-5-32-544", "S-1-5-32-545" })
                    acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),
                        sid == "S-1-5-32-545" ? FileSystemRights.ReadAndExecute : FileSystemRights.FullControl,
                        InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                        PropagationFlags.None, AccessControlType.Allow));
                Directory.CreateDirectory(root, acl);
                CheckTree(root);
            }
            return ActionResult.Success;
        }
        catch (Exception e)
        {
            session.Log("CloudMeet install directory rejected: " + e.Message);
            using (Record record = new Record(1))
            {
                record[0] = "CloudMeet: [1]";
                record[1] = e.Message;
                session.Message(InstallMessage.Error, record);
            }
            return ActionResult.Failure;
        }
    }
}
