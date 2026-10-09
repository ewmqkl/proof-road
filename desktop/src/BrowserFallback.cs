using System.Diagnostics;
using Microsoft.Win32;

namespace ProofRoad;

/// <summary>
/// 万一目标机器上没有 WebView2 运行时（Windows 10 早期版本、被精简过的系统镜像、
/// 或者 ARM64 上缺少 x86 运行时），就退回到系统里已有的 Chromium 内核浏览器，
/// 用 --app 模式开一个没有地址栏的窗口——观感几乎一样，进度照样存在独立配置目录里。
/// </summary>
internal static class BrowserFallback
{
    /// <summary>按 Edge → Chrome 的顺序找一个可用的浏览器可执行文件。</summary>
    public static string? FindChromium()
    {
        var candidates = new List<string>();

        void AddFrom(string? root, string relative)
        {
            if (!string.IsNullOrEmpty(root)) candidates.Add(Path.Combine(root, relative));
        }

        var programFiles = SafeFolder(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = SafeFolder(Environment.SpecialFolder.ProgramFilesX86);
        var localAppData = SafeFolder(Environment.SpecialFolder.LocalApplicationData);

        foreach (var root in new[] { programFilesX86, programFiles, localAppData })
        {
            AddFrom(root, @"Microsoft\Edge\Application\msedge.exe");
            AddFrom(root, @"Google\Chrome\Application\chrome.exe");
        }

        foreach (var key in new[]
                 {
                     @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
                     @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                 })
        {
            try
            {
                using var sub = Registry.LocalMachine.OpenSubKey(key) ?? Registry.CurrentUser.OpenSubKey(key);
                if (sub?.GetValue(null) is string path && path.Length > 0) candidates.Add(path);
            }
            catch { }
        }

        foreach (var candidate in candidates)
        {
            try { if (File.Exists(candidate)) return candidate; }
            catch { }
        }
        return null;
    }

    private static string? SafeFolder(Environment.SpecialFolder folder)
    {
        try { return Environment.GetFolderPath(folder); } catch { return null; }
    }

    /// <summary>开一个"应用窗口"。成功时通过 <paramref name="process"/> 返回进程，供调用方等待退出。</summary>
    public static bool TryOpenAppWindow(string browser, string url, string profileDirectory, out Process? process)
    {
        process = null;
        try
        {
            var startInfo = new ProcessStartInfo(browser) { UseShellExecute = false };
            startInfo.ArgumentList.Add("--app=" + url);
            startInfo.ArgumentList.Add("--user-data-dir=" + profileDirectory);
            startInfo.ArgumentList.Add("--no-first-run");
            startInfo.ArgumentList.Add("--no-default-browser-check");
            startInfo.ArgumentList.Add("--disable-features=Translate,msEdgeIdentityFeature,msEdgeSidebarV2");
            startInfo.ArgumentList.Add("--window-size=1280,860");
            process = Process.Start(startInfo);
            return process is not null;
        }
        catch (Exception ex)
        {
            AppPaths.Log("启动备用浏览器失败：" + ex);
            return false;
        }
    }

    public static void OpenInDefaultBrowser(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { AppPaths.Log("打开默认浏览器失败：" + ex); }
    }
}
