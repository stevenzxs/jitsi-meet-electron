using System;
using System.IO;
using System.Reflection;

public static class InstallRootTests
{
    static int count;
    static object Call(string method, params object[] args)
    {
        return typeof(InstallRootActions).GetMethod(method, BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, args);
    }
    static void Reject(string path)
    {
        try { Call("Canonical", path); }
        catch (TargetInvocationException) { count++; return; }
        throw new Exception("Accepted invalid path: " + path);
    }
    public static void Main()
    {
        foreach (string path in new [] { @"\\server\share\CloudMeet", @"C:\", @"C:\Software\..\CloudMeet",
            @"C:\Software;test\CloudMeet", "relative", "", @"C:\" + new string('x', 180) }) Reject(path);
        string drive = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
        string valid = drive + @"CloudMeet-Validation-Only";
        if ((string)Call("Canonical", valid) != valid) throw new Exception("Valid local path rejected.");
        count++;
        foreach (string sid in new [] { "S-1-5-18", "S-1-5-32-544" })
        {
            if (!(bool)Call("Trusted", sid)) throw new Exception("Trusted principal rejected.");
            count++;
        }
        foreach (string sid in new [] { "S-1-1-0", "S-1-5-32-545", "S-1-5-11" })
        {
            if ((bool)Call("Trusted", sid)) throw new Exception("Unprivileged principal trusted.");
            count++;
        }
        Console.WriteLine(count + " install-root validation assertions passed (no directory permissions changed).");
    }
}
