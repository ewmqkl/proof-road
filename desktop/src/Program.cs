using System.Diagnostics;
using System.Runtime.InteropServices;

namespace ProofRoad;

internal static class Program
{
    private const string AppUserModelId = "ProofRoad.NaturalDeduction.Desktop";
    private const string MutexName = @"Local\ProofRoad.SingleInstance.v1";

    private const int SW_RESTORE = 9;

    [STAThread]
    private static void Main()
    {
        TrySetAppUserModelId();

        // 单实例：第二次双击时把已经开着的窗口叫到前台，而不是再开一个窗口
        using var mutex = new Mutex(true, MutexName, out var isFirstInstance);
        if (!isFirstInstance && TryActivateRunningInstance()) return;

        CrashGuard.Install();

        try
        {
            using var server = new LocalServer(AppContent.Routes);
            Application.Run(new MainForm(server));
        }
        catch (Exception ex)
        {
            CrashGuard.Report(ex);
        }
    }

    private static void TrySetAppUserModelId()
    {
        try { SetCurrentProcessExplicitAppUserModelID(AppUserModelId); }
        catch { /* 只是影响任务栏图标分组，失败无所谓 */ }
    }

    private static bool TryActivateRunningInstance()
    {
        try
        {
            var self = Environment.ProcessId;
            var name = Path.GetFileNameWithoutExtension(Environment.ProcessPath) ?? "ProofRoad";
            foreach (var process in Process.GetProcessesByName(name))
            {
                using (process)
                {
                    if (process.Id == self) continue;
                    var handle = process.MainWindowHandle;
                    if (handle == IntPtr.Zero) continue;
                    if (IsIconic(handle)) ShowWindow(handle, SW_RESTORE);
                    SetForegroundWindow(handle);
                    return true;
                }
            }
        }
        catch { }
        return false;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string appId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hWnd);
}
