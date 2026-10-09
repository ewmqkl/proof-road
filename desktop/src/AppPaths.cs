using System.Text;

namespace ProofRoad;

/// <summary>
/// 运行期需要写入的东西全部集中在这里。
/// 关键点：绝不往 exe 所在目录写文件——这样程序可以放在只读目录、U 盘、共享盘上直接运行。
/// </summary>
internal static class AppPaths
{
    private const string FolderName = "ProofRoad";
    private const long LogSizeLimit = 256 * 1024;

    private static readonly object LogLock = new();

    /// <summary>数据根目录：%LOCALAPPDATA%\ProofRoad；万一不可写就退到临时目录。</summary>
    public static readonly string DataRoot;

    /// <summary>WebView2 的用户数据目录（缓存、Cookie、localStorage 都在这里）。</summary>
    public static readonly string WebViewData;

    /// <summary>备用方案（Edge/Chrome 应用窗口）使用的独立配置文件目录。</summary>
    public static readonly string BrowserProfile;

    public static readonly string WindowPlacementFile;
    public static readonly string LogFile;

    static AppPaths()
    {
        DataRoot = ResolveDataRoot();
        WebViewData = Sub("WebView2");
        BrowserProfile = Sub("BrowserProfile");
        WindowPlacementFile = Path.Combine(DataRoot, "window.json");
        LogFile = Path.Combine(DataRoot, "proof-road.log");
    }

    private static string Sub(string name)
    {
        var dir = Path.Combine(DataRoot, name);
        try { Directory.CreateDirectory(dir); } catch { /* 用不了就算了 */ }
        return dir;
    }

    private static string ResolveDataRoot()
    {
        var candidates = new List<string>();
        try
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!string.IsNullOrEmpty(local)) candidates.Add(Path.Combine(local, FolderName));
        }
        catch { }
        try { candidates.Add(Path.Combine(Path.GetTempPath(), FolderName)); } catch { }

        foreach (var dir in candidates)
        {
            try
            {
                Directory.CreateDirectory(dir);
                var probe = Path.Combine(dir, ".writable-probe");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return dir;
            }
            catch { }
        }

        try { return Path.GetTempPath(); } catch { return "."; }
    }

    public static void Log(string message)
    {
        try
        {
            lock (LogLock)
            {
                var info = new FileInfo(LogFile);
                if (info.Exists && info.Length > LogSizeLimit) File.Delete(LogFile);
                File.AppendAllText(LogFile,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine,
                    Encoding.UTF8);
            }
        }
        catch { /* 日志写不了不能影响游戏本身 */ }
    }

    public static string WriteCrashLog(Exception exception)
    {
        var text = new StringBuilder()
            .AppendLine("时间：" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"))
            .AppendLine("版本：" + (typeof(AppPaths).Assembly.GetName().Version?.ToString() ?? "?"))
            .AppendLine("系统：" + Environment.OSVersion.VersionString + " / " + (Environment.Is64BitOperatingSystem ? "64 位" : "32 位"))
            .AppendLine("进程：" + (Environment.Is64BitProcess ? "64 位" : "32 位"))
            .AppendLine(".NET：" + Environment.Version)
            .AppendLine()
            .AppendLine(exception.ToString())
            .ToString();
        Log("未处理异常：" + exception.GetType().Name + " - " + exception.Message);
        Log(text);
        return LogFile;
    }
}
