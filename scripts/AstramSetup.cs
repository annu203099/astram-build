// Astram-Setup.exe - self-contained installer (C# 5 / .NET Framework 4, built by scripts/build-installer.mjs).
// payload.zip (embedded resource) = app/ (bundled daemon, proxy, CLI, dashboard UI, better-sqlite3),
// runtime/node.exe, Astram.exe (launcher). Installs per-user, no UAC.
//
// GUI:     Astram-Setup.exe
// Silent:  Astram-Setup.exe --silent [--dir <path>] [--scope global|project|both]
//                           [--agents antigravity,cursor,...] [--project <dir>] [--port 3080]
//                           [--no-autostart] [--no-shortcut] [--no-launch]
//          Log: %TEMP%\astram-setup.log   Exit code 0 = success.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AstramInstaller
{
    public class Options
    {
        public string InstallDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Astram");
        public string Scope = "global";
        public List<string> Agents = new List<string>();
        public string ProjectDir = "";
        public int Port = 3080;
        public bool Autostart = true;
        public bool Shortcut = true;
        public bool Launch = true;
    }

    public static class Installer
    {
        public static string Home { get { return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile); } }

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

        static void StopRunning(string dir, Action<string> log)
        {
            foreach (Process p in Process.GetProcessesByName("node"))
            {
                try
                {
                    string f = p.MainModule.FileName;
                    if (f.StartsWith(dir, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(3000);
                        log("Stopped running Astram process (PID " + p.Id + ").");
                    }
                }
                catch { }
            }
        }

        static void Extract(string dir, Action<string> log)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            string full = Path.GetFullPath(dir);
            int n = 0;
            using (Stream s = asm.GetManifestResourceStream("payload.zip"))
            {
                if (s == null) throw new InvalidOperationException("Installer payload is missing (rebuild with scripts/build-installer.mjs).");
                using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry e in zip.Entries)
                    {
                        string name = e.FullName.Replace('/', Path.DirectorySeparatorChar).TrimStart('.', Path.DirectorySeparatorChar);
                        if (name.Length == 0 || e.FullName.EndsWith("/")) continue;
                        string target = Path.GetFullPath(Path.Combine(full, name));
                        if (!target.StartsWith(full, StringComparison.OrdinalIgnoreCase)) continue; // zip-slip guard
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        using (Stream src = e.Open())
                        using (FileStream dst = File.Create(target))
                            src.CopyTo(dst);
                        n++;
                    }
                }
            }
            log("Extracted " + n + " files to " + full);
        }

        static void WriteHelpers(Options o)
        {
            File.WriteAllText(Path.Combine(o.InstallDir, "port.txt"), o.Port.ToString());
            string[] cli = new string[] {
                "@echo off",
                "\"%~dp0runtime\\node.exe\" \"%~dp0app\\cli-astram.mjs\" %*"
            };
            File.WriteAllLines(Path.Combine(o.InstallDir, "astram.cmd"), cli);
            string[] un = new string[] {
                "@echo off",
                "echo Restoring your original MCP configs...",
                "\"%~dp0runtime\\node.exe\" \"%~dp0app\\cli-astram.mjs\" unprotect",
                "powershell -NoProfile -Command \"Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '%~dp0*' } | Stop-Process -Force\"",
                "reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v Astram /f >nul 2>&1",
                "reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Astram /f >nul 2>&1",
                "del \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Astram Dashboard.lnk\" >nul 2>&1",
                "set \"D=%~dp0\"",
                "set \"D=%D:~0,-1%\"",
                "echo Removing %D% (your ledger in %USERPROFILE%\\.astram is kept)...",
                "cd /d \"%TEMP%\"",
                "start \"\" /b cmd /c \"ping -n 3 127.0.0.1 >nul & rmdir /s /q \"\"%D%\"\"\"",
                "echo Done. Original MCP configs restored; wrapped copies saved as *.astram-wrapped.bak."
            };
            File.WriteAllLines(Path.Combine(o.InstallDir, "uninstall.cmd"), un);
        }

        static int RunNode(Options o, string args, Action<string> log)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = Path.Combine(o.InstallDir, "runtime", "node.exe");
            psi.Arguments = args;
            psi.WorkingDirectory = o.InstallDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["ASTRAM_NODE"] = psi.FileName; // wrapped configs use the bundled node
            using (Process p = new Process())
            {
                p.StartInfo = psi;
                p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) log(e.Data); };
                p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) log(e.Data); };
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
                return p.ExitCode;
            }
        }

        static void CreateShortcut(string lnk, string target, string workDir, string desc)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object sh = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
            Type st = sc.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
            st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { desc });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        public static int Install(Options o, Action<string> log)
        {
            try
            {
                o.InstallDir = Path.GetFullPath(o.InstallDir);
                log("Installing to " + o.InstallDir);
                StopRunning(o.InstallDir, log);
                Directory.CreateDirectory(o.InstallDir);
                Extract(o.InstallDir, log);
                WriteHelpers(o);

                if (o.Agents.Count > 0)
                {
                    string dir = o.ProjectDir.Length > 0 ? o.ProjectDir : o.InstallDir;
                    string args = "\"" + Path.Combine(o.InstallDir, "app", "cli-astram.mjs") + "\" protect --dir \"" + dir.TrimEnd((char)92) + "\""
                        + " --scope " + o.Scope + " --agents " + string.Join(",", o.Agents.ToArray()) + " --port " + o.Port;
                    log("Applying protection (scope=" + o.Scope + ", agents=" + string.Join(",", o.Agents.ToArray()) + ")...");
                    int rc = RunNode(o, args, log);
                    if (rc != 0) { log("ERROR: astram protect failed (exit " + rc + ")."); return 3; }
                }
                else log("No agents selected - skipping config protection.");

                string launcher = Path.Combine(o.InstallDir, "Astram.exe");
                log("Starting the Astram daemon on port " + o.Port + "...");
                ProcessStartInfo lp = new ProcessStartInfo(launcher, "--background");
                lp.UseShellExecute = false; lp.CreateNoWindow = true; lp.WorkingDirectory = o.InstallDir;
                using (Process p = Process.Start(lp)) { p.WaitForExit(30000); }
                bool ok = false;
                for (int i = 0; i < 20 && !ok; i++) { ok = Healthy(o.Port); if (!ok) Thread.Sleep(500); }
                if (!ok) { log("ERROR: daemon did not become healthy on port " + o.Port + ". See " + Path.Combine(Home, ".astram") + "."); return 4; }
                log("Daemon healthy: http://127.0.0.1:" + o.Port);

                if (o.Shortcut)
                {
                    try
                    {
                        string lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Astram Dashboard.lnk");
                        CreateShortcut(lnk, launcher, o.InstallDir, "Astram security dashboard");
                        log("Start Menu shortcut created.");
                    }
                    catch (Exception ex) { log("Warning: could not create shortcut: " + ex.Message); }
                }
                using (RegistryKey run = Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run", true))
                {
                    if (o.Autostart) { run.SetValue("Astram", "\"" + launcher + "\" --background"); log("Autostart enabled."); }
                    else run.DeleteValue("Astram", false);
                }
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Astram"))
                {
                    k.SetValue("DisplayName", "Astram Zero-Trust Microkernel");
                    k.SetValue("DisplayVersion", "0.1.0");
                    k.SetValue("Publisher", "Astram");
                    k.SetValue("InstallLocation", o.InstallDir);
                    k.SetValue("UninstallString", "\"" + Path.Combine(o.InstallDir, "uninstall.cmd") + "\"");
                }
                if (o.Launch) { Process.Start(launcher); log("Opening the dashboard..."); }
                log("SUCCESS. CLI: \"" + Path.Combine(o.InstallDir, "astram.cmd") + "\"   Uninstall: \"" + Path.Combine(o.InstallDir, "uninstall.cmd") + "\"");
                return 0;
            }
            catch (Exception ex)
            {
                log("ERROR: " + ex.Message);
                return 1;
            }
        }
    }

    public class SetupForm : Form
    {
        CheckedListBox chkAgents; RadioButton radGlobal, radProject; TextBox txtProject, txtLog; Button btnBrowse, btnInstall, btnExit;
        CheckBox chkAuto, chkLaunch; Label lblHardware;
        List<string> keys = new List<string>();
        Options opt = new Options();

        public SetupForm(Options preset)
        {
            opt = preset;
            Text = "Astram Zero-Trust Microkernel - Setup";
            Size = new Size(690, 640);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
            BackColor = Color.FromArgb(10, 10, 12); ForeColor = Color.FromArgb(230, 230, 235);
            Font = new Font("Segoe UI", 9.5f);

            Controls.Add(new Label { Text = "ASTRAM  ZERO-TRUST  SETUP", Font = new Font("Segoe UI", 13f, FontStyle.Bold), ForeColor = Color.FromArgb(56, 189, 248), Location = new Point(20, 14), AutoSize = true });
            Controls.Add(new Label { Text = "MCP firewall for AI coding agents. Installs for the current user only (no admin rights).", ForeColor = Color.FromArgb(160, 160, 170), Location = new Point(22, 42), AutoSize = true });

            lblHardware = new Label { Location = new Point(22, 68), Size = new Size(630, 20), ForeColor = Color.FromArgb(160, 220, 180) };
            Controls.Add(lblHardware);

            GroupBox g = new GroupBox { Text = "Protect these agents (detected ones are pre-selected)", ForeColor = Color.FromArgb(56, 189, 248), Location = new Point(20, 95), Size = new Size(640, 215) };
            chkAgents = new CheckedListBox { Location = new Point(15, 25), Size = new Size(610, 110), BackColor = Color.FromArgb(20, 20, 24), ForeColor = Color.FromArgb(240, 240, 245), BorderStyle = BorderStyle.FixedSingle, CheckOnClick = true };
            g.Controls.Add(chkAgents);
            radGlobal = new RadioButton { Text = "Global - all projects (user-level configs)", Checked = true, Location = new Point(15, 145), AutoSize = true, ForeColor = Color.FromArgb(220, 220, 230) };
            radProject = new RadioButton { Text = "Project only:", Location = new Point(15, 172), AutoSize = true, ForeColor = Color.FromArgb(220, 220, 230) };
            txtProject = new TextBox { Location = new Point(135, 170), Size = new Size(400, 24), Enabled = false, BackColor = Color.FromArgb(24, 24, 28), ForeColor = Color.White };
            btnBrowse = new Button { Text = "Browse...", Location = new Point(545, 168), Size = new Size(80, 27), Enabled = false, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 30, 36) };
            radProject.CheckedChanged += delegate { txtProject.Enabled = btnBrowse.Enabled = radProject.Checked; };
            btnBrowse.Click += delegate { using (FolderBrowserDialog d = new FolderBrowserDialog()) { d.Description = "Select the project folder to protect"; if (d.ShowDialog() == DialogResult.OK) txtProject.Text = d.SelectedPath; } };
            g.Controls.AddRange(new Control[] { radGlobal, radProject, txtProject, btnBrowse });
            Controls.Add(g);

            chkAuto = new CheckBox { Text = "Start Astram when I sign in", Checked = true, Location = new Point(22, 320), AutoSize = true };
            chkLaunch = new CheckBox { Text = "Open the dashboard when finished", Checked = true, Location = new Point(290, 320), AutoSize = true };
            Controls.AddRange(new Control[] { chkAuto, chkLaunch });
            Controls.Add(new Label { Text = "Install location: " + opt.InstallDir, ForeColor = Color.FromArgb(140, 140, 150), Location = new Point(22, 348), Size = new Size(630, 20) });

            txtLog = new TextBox { Location = new Point(20, 375), Size = new Size(640, 165), Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.FromArgb(16, 16, 20), ForeColor = Color.FromArgb(140, 220, 160), Font = new Font("Consolas", 8.5f), BorderStyle = BorderStyle.FixedSingle };
            Controls.Add(txtLog);

            btnInstall = new Button { Text = "Install && Protect", Location = new Point(440, 555), Size = new Size(220, 36), BackColor = Color.FromArgb(14, 116, 144), ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) };
            btnInstall.FlatAppearance.BorderSize = 0; btnInstall.Click += OnInstall;
            btnExit = new Button { Text = "Exit", Location = new Point(340, 555), Size = new Size(90, 36), BackColor = Color.FromArgb(30, 30, 36), ForeColor = Color.FromArgb(200, 200, 210), FlatStyle = FlatStyle.Flat };
            btnExit.Click += delegate { Close(); };
            Controls.AddRange(new Control[] { btnInstall, btnExit });

            DetectHardware(); DetectAgents();
        }

        void Log(string m)
        {
            if (InvokeRequired) { BeginInvoke((Action)delegate { Log(m); }); return; }
            txtLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + m + Environment.NewLine);
        }

        void DetectHardware()
        {
            string gpu = "CPU engine (bit-parallel POPCOUNT + loop-unrolled FWHT)";
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("nvidia-smi", "--query-gpu=name --format=csv,noheader");
                psi.UseShellExecute = false; psi.RedirectStandardOutput = true; psi.CreateNoWindow = true;
                using (Process p = Process.Start(psi)) { string o = p.StandardOutput.ReadToEnd().Trim(); p.WaitForExit(2000); if (o.Length > 0) gpu = "NVIDIA GPU: " + o; }
            }
            catch { }
            lblHardware.Text = "Accelerator: " + gpu;
        }

        void Add(string key, string label, params string[] paths)
        {
            bool found = false;
            foreach (string p in paths) if (File.Exists(p) || Directory.Exists(p)) found = true;
            keys.Add(key);
            chkAgents.Items.Add(label + (found ? "   [detected]" : "   [not detected]"), found);
        }

        void DetectAgents()
        {
            string h = Installer.Home;
            string app = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            Add("antigravity", "Google Antigravity", Path.Combine(h, ".gemini", "antigravity"), Path.Combine(h, ".gemini", "config"));
            Add("claude-code", "Claude Code & Claude Desktop", Path.Combine(h, ".claude.json"), Path.Combine(h, ".claude"), Path.Combine(app, "Claude"));
            Add("cursor", "Cursor", Path.Combine(h, ".cursor"));
            Add("codex", "OpenAI Codex CLI", Path.Combine(h, ".codex"));
            Add("quill", "Quill-Agent", Path.Combine(h, ".quill"));
            Add("dsh", "DeepSeek Harness", Path.Combine(h, ".dsh"));
        }

        void OnInstall(object s, EventArgs e)
        {
            opt.Scope = radGlobal.Checked ? "global" : "project";
            opt.ProjectDir = radGlobal.Checked ? "" : txtProject.Text.Trim();
            if (!radGlobal.Checked && !Directory.Exists(opt.ProjectDir)) { MessageBox.Show("Choose an existing project folder."); return; }
            opt.Agents.Clear();
            for (int i = 0; i < chkAgents.Items.Count; i++) if (chkAgents.GetItemChecked(i)) opt.Agents.Add(keys[i]);
            if (opt.Agents.Count == 0 && MessageBox.Show("No agents selected - install the dashboard only?", "Astram", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
            opt.Autostart = chkAuto.Checked; opt.Launch = chkLaunch.Checked;
            btnInstall.Enabled = false;
            Thread t = new Thread(delegate ()
            {
                int rc = Installer.Install(opt, Log);
                BeginInvoke((Action)delegate
                {
                    btnInstall.Enabled = true;
                    if (rc == 0) { btnInstall.Text = "Done"; btnInstall.Enabled = false; btnExit.Text = "Close"; }
                    else Log("Setup FAILED (code " + rc + "). You can fix the issue and press Install again.");
                });
            });
            t.IsBackground = true; t.Start();
        }
    }

    public static class Program
    {
        static string Arg(string[] a, string name)
        {
            for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
            return null;
        }

        [STAThread]
        public static int Main(string[] args)
        {
            Options o = new Options();
            string v;
            if ((v = Arg(args, "--dir")) != null) o.InstallDir = v;
            if ((v = Arg(args, "--scope")) != null) o.Scope = v;
            if ((v = Arg(args, "--agents")) != null) foreach (string a in v.Split(',')) if (a.Trim().Length > 0) o.Agents.Add(a.Trim());
            if ((v = Arg(args, "--project")) != null) o.ProjectDir = v;
            if ((v = Arg(args, "--port")) != null) o.Port = int.Parse(v);
            if (Array.IndexOf(args, "--no-autostart") >= 0) o.Autostart = false;
            if (Array.IndexOf(args, "--no-shortcut") >= 0) o.Shortcut = false;
            if (Array.IndexOf(args, "--no-launch") >= 0) o.Launch = false;

            if (Array.IndexOf(args, "--silent") >= 0)
            {
                string logFile = Path.Combine(Path.GetTempPath(), "astram-setup.log");
                File.WriteAllText(logFile, "");
                return Installer.Install(o, delegate (string m) { File.AppendAllText(logFile, m + Environment.NewLine); });
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(o));
            return 0;
        }
    }
}
