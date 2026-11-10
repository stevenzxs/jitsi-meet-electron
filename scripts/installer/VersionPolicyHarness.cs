// Test-only DTF boundary. No MSI sessions, registry writes or services are started.
using System;
using System.Collections.Generic;
namespace Microsoft.Deployment.WindowsInstaller
{
    public class CustomActionAttribute : Attribute { }
    public enum ActionResult { Success, Failure, UserExit }
    public enum MessageResult { No, Yes }
    public enum InstallMessage { Error = 0x01000000, User = 0x03000000 }
    public class Record : IDisposable
    {
        public Record(int count) { }
        public object this[int index] { get { return null; } set { } }
        public void Dispose() { }
    }
    public class Session
    {
        readonly Dictionary<string, string> properties = new Dictionary<string, string>();
        public Dictionary<string, string> CustomActionData = new Dictionary<string, string>();
        public MessageResult Answer = MessageResult.No;
        public int Prompts;
        public string this[string key] { get { return properties.ContainsKey(key) ? properties[key] : ""; } set { properties[key] = value; } }
        public void Log(string message) { }
        public MessageResult Message(InstallMessage type, Record record) { Prompts++; return Answer; }
    }
    public class ProductInstallation
    {
        public static string[] Versions = new string[0];
        public bool IsInstalled { get { return true; } }
        public Version ProductVersion;
        public static IEnumerable<ProductInstallation> GetRelatedProducts(string code)
        {
            if (code != "{CF24C64F-7B2E-43DE-92E9-581984AD2437}") throw new Exception("Wrong product family");
            foreach (string version in Versions) yield return new ProductInstallation { ProductVersion = new Version(version) };
        }
    }
}
class VersionPolicyHarness
{
    static void Check(bool value) { if (!value) throw new Exception("Version action assertion failed"); }
    static Microsoft.Deployment.WindowsInstaller.Session Run(string target, string installed, string ui, Microsoft.Deployment.WindowsInstaller.MessageResult answer, string expected, bool maintenance, bool approved)
    {
        var session = new Microsoft.Deployment.WindowsInstaller.Session();
        Microsoft.Deployment.WindowsInstaller.ProductInstallation.Versions = installed == null ? new string[0] : new [] { installed };
        session["ProductVersion"] = target;
        session["UILevel"] = ui;
        session["Installed"] = maintenance ? "1" : "";
        session["CLOUDMEET_REINSTALL"] = approved ? "1" : "";
        session.Answer = answer;
        Check(InstallRootActions.CheckInstallVersion(session).ToString() == expected);
        return session;
    }
    static void Main()
    {
        var no = Microsoft.Deployment.WindowsInstaller.MessageResult.No;
        var yes = Microsoft.Deployment.WindowsInstaller.MessageResult.Yes;
        Check(Run("1.0.0", null, "5", no, "Success", false, false).Prompts == 0);
        Check(Run("1.1.0", "1.0.0", "5", no, "Success", false, false).Prompts == 0);
        Run("1.0.0", "1.1.0", "5", yes, "Failure", false, false);
        var cancelled = Run("1.0.0", "1.0.0", "5", no, "UserExit", true, false);
        Check(cancelled["REINSTALL"] == "" && cancelled["CLOUDMEET_REINSTALL"] == "");
        var accepted = Run("1.0.0", "1.0.0", "5", yes, "Success", true, false);
        Check(accepted.Prompts == 1 && accepted["REINSTALL"] == "ALL" && accepted["REINSTALLMODE"] == "amus");
        var rebuilt = Run("1.0.0", "1.0.0", "5", yes, "Success", false, false);
        Check(rebuilt["REINSTALL"] == "" && rebuilt["CLOUDMEET_REINSTALL"] == "1");
        Check(Run("1.0.0", "1.0.0", "2", yes, "UserExit", true, false).Prompts == 0);
        Check(Run("1.0.0", "1.0.0", "2", no, "Success", true, true).Prompts == 0);
        Console.WriteLine("PASS action decisions");
    }
}
