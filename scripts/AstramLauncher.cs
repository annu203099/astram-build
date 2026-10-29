// Astram.exe - tiny windowless launcher (C# 5 / .NET Framework 4, built by build-installer.mjs).
//   Astram.exe               start the daemon if it is not running, then open the dashboard
//   Astram.exe --background  start the daemon only (used by Windows autostart)
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

namespace AstramLauncher
{
    public static class Program
    {
        static bool Healthy(int port)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                req.Timeout = 1500;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                    return (int)res.StatusCode == 200;
            }
            catch { return false; }
        }

        public static int Main(string[] args)
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            int port = 3080;
            try
            {
                string pf = Path.Combine(dir, "port.txt");
                if (File.Exists(pf)) port = int.Parse(File.ReadAllText(pf).Trim());
            }
            catch { }

            if (!Healthy(port))
            {
                string home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".astram");
                Directory.CreateDirectory(home);
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = Path.Combine(dir, "runtime", "node.exe");
                psi.Arguments = "\"" + Path.Combine(dir, "app", "daemon.mjs") + "\"";
                psi.WorkingDirectory = dir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.EnvironmentVariables["AEGIS_PORT"] = port.ToString();
                try { Process.Start(psi); } catch { return 2; }
                for (int i = 0; i < 40 && !Healthy(port); i++) Thread.Sleep(500);
            }

            bool background = Array.IndexOf(args, "--background") >= 0;
            if (!background)
            {
                string url = "http://127.0.0.1:" + port;
                string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe");
                if (!File.Exists(edge)) edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe");
                try
                {
                    if (File.Exists(edge)) Process.Start(edge, "--app=" + url + " --window-size=1280,820");
                    else Process.Start(url);
                }
                catch { Process.Start(url); }
            }
            return Healthy(port) ? 0 : 1;
        }
    }
}
