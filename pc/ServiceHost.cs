using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

sealed class KindleDeskService : ServiceBase {
    readonly string python;
    readonly string script;
    Process child;
    bool stopping;

    KindleDeskService(string pythonPath, string scriptPath) {
        ServiceName = "KindleDesk";
        CanStop = true;
        CanShutdown = true;
        python = pythonPath;
        script = scriptPath;
    }

    protected override void OnStart(string[] args) {
        stopping = false;
        var info = new ProcessStartInfo(python, "-u \"" + script + "\" serve");
        info.WorkingDirectory = Path.GetDirectoryName(script);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardError = true;
        info.EnvironmentVariables["PYTHONUTF8"] = "1";
        child = new Process { StartInfo = info, EnableRaisingEvents = true };
        child.ErrorDataReceived += (s, e) => { if (e.Data != null) EventLog.WriteEntry(e.Data, EventLogEntryType.Error); };
        child.Exited += (s, e) => { if (!stopping) { ExitCode = 1; Stop(); } };
        child.Start();
        child.BeginErrorReadLine();
    }

    protected override void OnStop() {
        stopping = true;
        if (child != null && !child.HasExited) {
            child.StandardInput.WriteLine("stop");
            child.StandardInput.Flush();
            if (!child.WaitForExit(8000)) child.Kill();
        }
    }
    protected override void OnShutdown() { OnStop(); }

    static void Main(string[] args) {
        if (args.Length != 2) throw new ArgumentException("Expected Python executable and collector script");
        ServiceBase.Run(new KindleDeskService(args[0], args[1]));
    }
}
