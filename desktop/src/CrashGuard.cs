namespace ProofRoad;

/// <summary>
/// 兜底：任何没被接住的异常都要变成一条能看懂的提示 + 一份日志，而不是无声无息地消失。
/// 对"装到别人电脑上"的场景来说，这一点比多一个功能重要得多。
/// </summary>
internal static class CrashGuard
{
    private static bool _installed;

    public static void Install()
    {
        if (_installed) return;
        _installed = true;

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Application.ThreadException += (_, e) => Report(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Report(e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            AppPaths.Log("未观察到的任务异常：" + e.Exception);
            e.SetObserved();
        };
    }

    public static void Report(Exception? exception)
    {
        if (exception is null) return;
        string logPath;
        try { logPath = AppPaths.WriteCrashLog(exception); }
        catch { logPath = AppPaths.LogFile; }

        try
        {
            MessageBox.Show(
                "程序遇到了一个没预料到的错误。\n\n" +
                exception.GetType().Name + "：" + exception.Message + "\n\n" +
                "详细信息已经写进日志：\n" + logPath,
                "证明之路 · 出错了",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        catch { }
    }
}
