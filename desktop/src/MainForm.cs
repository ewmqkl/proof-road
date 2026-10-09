using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ProofRoad;

/// <summary>
/// 主窗口。结构很简单：一个深色 WinForms 窗体，里面铺满 WebView2，指向 <see cref="LocalServer"/>。
/// 所有"正经功能"都在网页里；这一层只负责窗口、快捷键、和"没有 WebView2 时怎么办"。
/// </summary>
internal sealed class MainForm : Form, IMessageFilter
{
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private const string WindowTitle = "证明之路 · 从命题逻辑到代数定理";
    private const string WebView2DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    private static readonly Color CanvasColor = Color.FromArgb(17, 19, 21);
    private static readonly Color TextColor = Color.FromArgb(248, 248, 245);
    private static readonly Color MutedColor = Color.FromArgb(154, 160, 168);
    private static readonly Color AccentColor = Color.FromArgb(63, 247, 255);

    /// <summary>Icon(Stream) 要求流在图标生命周期内保持打开，所以这里存一份静态引用。</summary>
    private static Stream? _iconStream;

    private readonly LocalServer _server;

    private WebView2? _webView;
    private Label? _splash;
    private bool _started;
    private bool _placementRestored;
    private bool _webViewUnavailable;
    private bool _runningInFallback;
    private bool _fullScreen;
    private FormBorderStyle _restoreBorderStyle;
    private FormWindowState _restoreWindowState;
    private Rectangle _restoreBounds;

    public MainForm(LocalServer server)
    {
        _server = server;

        Text = WindowTitle;
        BackColor = CanvasColor;
        ForeColor = TextColor;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(720, 520);
        KeyPreview = true;
        DoubleBuffered = true;
        try { Icon = LoadAppIcon(); } catch (Exception ex) { AppPaths.Log("载入图标失败：" + ex.Message); }

        _placementRestored = RestorePlacement();
        Application.AddMessageFilter(this);
    }

    /// <summary>把屏幕上的物理像素换算成缩放比（100% → 1.0，200% → 2.0）。</summary>
    private static double ScaleFor(int dpi) => dpi <= 0 ? 1.0 : Math.Max(dpi, 96) / 96.0;

    /// <summary>
    /// 默认窗口尺寸。
    ///
    /// 关键：要给的是**逻辑尺寸**，不是物理尺寸。WebView2 里的 CSS 视口 = 物理像素 ÷ 缩放比，
    /// 所以在一台 200% 缩放的笔记本上，直接按物理像素开 1360×880 的窗口，
    /// 网页只会拿到 680×440 的视口——三栏界面会被挤成一团。反过来，屏幕只有 1366×768 时，
    /// 又要老老实实收进工作区，不能开出比屏幕还大的窗口。
    /// </summary>
    private void ApplyInitialSize(int dpi)
    {
        var work = (Screen.PrimaryScreen ?? Screen.AllScreens[0]).WorkingArea;
        var scale = ScaleFor(dpi);

        const double targetWidth = 1320;    // 逻辑像素
        const double targetHeight = 860;

        var width = (int)Math.Round(Math.Min(targetWidth * scale, work.Width * 0.94));
        var height = (int)Math.Round(Math.Min(targetHeight * scale, work.Height * 0.94));
        ClientSize = new Size(Math.Max(width, 480), Math.Max(height, 360));

        MinimumSize = new Size(
            Math.Min((int)Math.Round(760 * scale), Math.Max(work.Width / 2, 480)),
            Math.Min((int)Math.Round(560 * scale), Math.Max(work.Height / 2, 360)));
    }

    // ------------------------------------------------------------------ 启动

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        // 到这一步才有真实窗口，DeviceDpi 才是这台显示器上的真实缩放比
        if (!_placementRestored) ApplyInitialSize(DeviceDpi);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (_started) return;
        _started = true;
        await StartWebViewAsync();
    }

    private async Task StartWebViewAsync()
    {
        ShowSplash("正在启动证明台……");
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: AppPaths.WebViewData,
                options: null);

            var webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = CanvasColor,
            };
            webView.CoreWebView2InitializationCompleted += OnWebViewInitialized;
            SuspendLayout();
            Controls.Add(webView);
            webView.BringToFront();
            ResumeLayout(true);
            _webView = webView;

            var initialization = webView.EnsureCoreWebView2Async(environment);
            var finished = await Task.WhenAny(initialization, Task.Delay(TimeSpan.FromSeconds(30)));
            if (finished != initialization)
            {
                AbandonWebView(new TimeoutException("WebView2 初始化超过 30 秒"));
                return;
            }
            await initialization;
        }
        catch (Exception ex)
        {
            AbandonWebView(ex);
        }
    }

    private void OnWebViewInitialized(object? sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        if (!e.IsSuccess || _webView?.CoreWebView2 is null)
        {
            AbandonWebView(e.InitializationException ?? new InvalidOperationException("WebView2 初始化失败"));
            return;
        }

        var core = _webView.CoreWebView2;
        var settings = core.Settings;
        settings.AreDefaultContextMenusEnabled = false;   // 游戏里不需要右键菜单
        settings.AreDevToolsEnabled = true;               // F12 留个后门，排障用
        settings.AreBrowserAcceleratorKeysEnabled = false; // Ctrl+P / Ctrl+F 之类交给宿主自己管
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = true;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsBuiltInErrorPageEnabled = true;

        core.NewWindowRequested += OnNewWindowRequested;
        core.NavigationStarting += OnNavigationStarting;
        core.ProcessFailed += OnProcessFailed;

        core.Navigate(_server.Url);
        AppPaths.Log("WebView2 已就绪，内核版本 " + SafeBrowserVersion());
        HideSplash();
    }

    private string SafeBrowserVersion()
    {
        try { return _webView?.CoreWebView2?.Environment.BrowserVersionString ?? "未知"; }
        catch { return "未知"; }
    }

    // ------------------------------------------------------------------ WebView2 不可用时的退路

    private void AbandonWebView(Exception error)
    {
        if (_webViewUnavailable) return;
        _webViewUnavailable = true;
        AppPaths.Log("WebView2 不可用：" + error);

        var broken = _webView;
        _webView = null;
        if (broken is not null)
        {
            try { broken.CoreWebView2InitializationCompleted -= OnWebViewInitialized; } catch { }
            try { Controls.Remove(broken); } catch { }
            try { broken.Dispose(); } catch { }
        }

        var browser = BrowserFallback.FindChromium();
        if (browser is not null &&
            BrowserFallback.TryOpenAppWindow(browser, _server.Url, AppPaths.BrowserProfile, out var process) &&
            process is not null)
        {
            AppPaths.Log("已改用备用浏览器：" + browser);
            _runningInFallback = true;
            HideSplash();
            Hide();
            ShowInTaskbar = false;

            var child = process;
            _ = Task.Run(() =>
            {
                try { child.WaitForExit(); } catch { }
            }).ContinueWith(_ =>
            {
                try
                {
                    if (!IsDisposed && IsHandleCreated) BeginInvoke(Close);
                }
                catch { }
            });
            return;
        }

        ShowMissingEngineScreen(error);
    }

    private void ShowMissingEngineScreen(Exception error)
    {
        _runningInFallback = false;
        ShowInTaskbar = true;
        Text = "证明之路 · 缺少浏览器内核";
        HideSplash();

        var stack = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 6,
            Padding = new Padding(36, 32, 36, 28),
            BackColor = CanvasColor,
        };
        stack.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        for (var i = 0; i < 4; i++) stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        stack.Controls.Add(new Label
        {
            Text = "需要 Microsoft Edge WebView2 运行时",
            ForeColor = TextColor,
            Font = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold),
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 12),
        });
        stack.Controls.Add(new Label
        {
            Text = "这台电脑上既没有找到 WebView2 运行时，也没有找到 Edge / Chrome。\n" +
                   "装一次 WebView2 运行时就能正常使用（免费，约 2 MB，装完本程序即可直接运行）。",
            ForeColor = MutedColor,
            Font = new Font("Microsoft YaHei UI", 10F),
            AutoSize = true,
            MaximumSize = new Size(720, 0),
            Margin = new Padding(0, 0, 0, 20),
        });
        stack.Controls.Add(new Label
        {
            Text = "诊断信息：" + error.GetType().Name + " — " + error.Message,
            ForeColor = Color.FromArgb(120, 126, 134),
            Font = new Font("Consolas", 8.5F),
            AutoSize = true,
            MaximumSize = new Size(720, 0),
            Margin = new Padding(0, 0, 0, 20),
        });

        var buttons = new FlowLayoutPanel { AutoSize = true, WrapContents = true, Margin = new Padding(0) };
        buttons.Controls.Add(MakeButton("下载 WebView2 运行时", () =>
            BrowserFallback.OpenInDefaultBrowser(WebView2DownloadUrl)));
        buttons.Controls.Add(MakeButton("用系统默认浏览器打开游戏", OpenInBrowser));
        buttons.Controls.Add(MakeButton("退出", Close));
        stack.Controls.Add(buttons);
        stack.Controls.Add(new Label { Text = string.Empty, AutoSize = true });

        Controls.Add(stack);
        stack.BringToFront();
    }

    private Button MakeButton(string text, Action onClick)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Padding = new Padding(18, 8, 18, 8),
            Margin = new Padding(0, 0, 12, 0),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(36, 42, 50),
            ForeColor = TextColor,
            Font = new Font("Microsoft YaHei UI", 10F),
            Cursor = Cursors.Hand,
        };
        button.FlatAppearance.BorderColor = AccentColor;
        button.Click += (_, _) => onClick();
        return button;
    }

    private void OpenInBrowser()
    {
        BrowserFallback.OpenInDefaultBrowser(_server.Url);
        _runningInFallback = true;
        Text = "证明之路 · 游戏已在浏览器里打开（别关这个窗口）";
    }

    // ------------------------------------------------------------------ 网页事件

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        OpenExternally(e.Uri);
    }

    /// <summary>游戏是单页应用，除了本地服务自己的地址，别的导航一律丢给系统浏览器。</summary>
    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (e.Uri.StartsWith(_server.Url, StringComparison.OrdinalIgnoreCase)) return;
        if (e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) return;
        if (e.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return;
        e.Cancel = true;
        OpenExternally(e.Uri);
    }

    private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        AppPaths.Log("WebView2 进程异常：" + e.ProcessFailedKind + " / " + e.Reason);
        if (_webViewUnavailable || IsDisposed) return;

        if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            _webViewUnavailable = true;
            BeginInvoke(() =>
            {
                MessageBox.Show(this,
                    "显示引擎（WebView2）意外退出了。请关掉本窗口后重新打开程序。",
                    "证明之路", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Close();
            });
        }
    }

    private static void OpenExternally(string uri)
    {
        try
        {
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed)) return;
            if (parsed.Scheme is not ("http" or "https" or "mailto")) return;
            Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            AppPaths.Log("打开外部链接失败：" + ex.Message);
        }
    }

    // ------------------------------------------------------------------ 启动提示

    private void ShowSplash(string message)
    {
        if (_splash is not null) return;
        _splash = new Label
        {
            Text = "证明之路\n" + message,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = MutedColor,
            BackColor = CanvasColor,
            Font = new Font("Microsoft YaHei UI", 12F),
        };
        Controls.Add(_splash);
        _splash.BringToFront();
    }

    private void HideSplash()
    {
        if (_splash is null) return;
        var splash = _splash;
        _splash = null;
        try { Controls.Remove(splash); } catch { }
        splash.Dispose();
    }

    // ------------------------------------------------------------------ 快捷键
    // WebView2 的子窗口有自己的 HWND，WinForms 的 ProcessCmdKey 未必收得到键，
    // 所以用消息过滤器在更靠前的位置截。（网页里只用到 Enter，不会打架。）

    public bool PreFilterMessage(ref Message m)
    {
        if (m.Msg is not (WM_KEYDOWN or WM_SYSKEYDOWN)) return false;
        var key = (Keys)((int)m.WParam & 0xFFFF);
        return HandleShortcut(key | Control.ModifierKeys);
    }

    private bool HandleShortcut(Keys keyData)
    {
        switch (keyData)
        {
            case Keys.F11:
            case Keys.Alt | Keys.Enter:
                ToggleFullScreen();
                return true;

            case Keys.Escape when _fullScreen:
                ToggleFullScreen();
                return true;

            case Keys.F5:
            case Keys.Control | Keys.R:
                Reload();
                return true;

            case Keys.F12:
            case Keys.Control | Keys.Shift | Keys.I:
                OpenDevTools();
                return true;

            case Keys.Control | Keys.D0:
            case Keys.Control | Keys.NumPad0:
                SetZoom(1.0);
                return true;

            case Keys.Control | Keys.Oemplus:
            case Keys.Control | Keys.Add:
                ZoomBy(0.1);
                return true;

            case Keys.Control | Keys.OemMinus:
            case Keys.Control | Keys.Subtract:
                ZoomBy(-0.1);
                return true;

            case Keys.F1:
                ShowAbout();
                return true;
        }
        return false;
    }

    private void Reload()
    {
        try { _webView?.CoreWebView2?.Reload(); }
        catch (Exception ex) { AppPaths.Log("重新载入失败：" + ex.Message); }
    }

    private void OpenDevTools()
    {
        try { _webView?.CoreWebView2?.OpenDevToolsWindow(); }
        catch (Exception ex) { AppPaths.Log("打开开发者工具失败：" + ex.Message); }
    }

    private void SetZoom(double factor)
    {
        try { if (_webView is not null) _webView.ZoomFactor = factor; }
        catch { }
    }

    private void ZoomBy(double delta)
    {
        try
        {
            if (_webView is null) return;
            var next = Math.Round(_webView.ZoomFactor + delta, 2);
            _webView.ZoomFactor = Math.Clamp(next, 0.5, 3.0);
        }
        catch { }
    }

    private void ToggleFullScreen()
    {
        if (_fullScreen)
        {
            _fullScreen = false;
            FormBorderStyle = _restoreBorderStyle;
            Bounds = _restoreBounds;
            WindowState = _restoreWindowState;
            return;
        }

        _restoreBorderStyle = FormBorderStyle;
        _restoreWindowState = WindowState;
        _restoreBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        _fullScreen = true;
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Normal;
        Bounds = (Screen.FromControl(this) ?? Screen.PrimaryScreen ?? Screen.AllScreens[0]).Bounds;
    }

    /// <summary>
    /// 对外显示的版本号读 InformationalVersion（即 csproj 的 &lt;Version&gt;）。
    /// 不能读 AssemblyVersion——那个按项目约定固定不动，否则每发一版都要动程序集标识。
    /// </summary>
    private static string DisplayVersion()
    {
        var asm = typeof(MainForm).Assembly;
        var attrs = asm.GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false);
        if (attrs.Length > 0
            && attrs[0] is System.Reflection.AssemblyInformationalVersionAttribute info
            && !string.IsNullOrWhiteSpace(info.InformationalVersion))
        {
            return info.InformationalVersion;
        }
        return asm.GetName().Version?.ToString(2) ?? "0.2";
    }

    private void ShowAbout()
    {
        var version = DisplayVersion();
        var engine = _runningInFallback
            ? "外部浏览器（备用方案）"
            : "Microsoft Edge WebView2 " + SafeBrowserVersion();
        MessageBox.Show(this,
            "证明之路 · 从命题逻辑到代数定理\n" +
            "桌面版 " + version + "\n\n" +
            "32 个关卡 · 155 项自动化测试 · 零外部依赖\n" +
            "网页内核：" + engine + "\n\n" +
            "快捷键：\n" +
            "  F11 / Alt+Enter   全屏\n" +
            "  F5 / Ctrl+R       重新载入\n" +
            "  Ctrl+加号 / 减号  缩放（Ctrl+0 复原）\n" +
            "  F12               开发者工具\n" +
            "  F1                本对话框\n\n" +
            "存档目录：" + AppPaths.DataRoot,
            "关于证明之路", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    // ------------------------------------------------------------------ 窗口位置记忆

    private sealed class Placement
    {
        public int X { get; set; }
        public int Y { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public bool Maximized { get; set; }
    }

    private bool RestorePlacement()
    {
        try
        {
            if (!File.Exists(AppPaths.WindowPlacementFile)) return false;
            var placement = JsonSerializer.Deserialize<Placement>(File.ReadAllText(AppPaths.WindowPlacementFile));
            if (placement is null || placement.Width < 640 || placement.Height < 480) return false;

            var bounds = new Rectangle(placement.X, placement.Y, placement.Width, placement.Height);
            // 上次用的显示器可能已经拔掉了，这时就老老实实用默认位置
            var visible = Screen.AllScreens.Any(screen => screen.WorkingArea.IntersectsWith(bounds));
            if (!visible) return false;

            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
            if (placement.Maximized) WindowState = FormWindowState.Maximized;
            return true;
        }
        catch (Exception ex)
        {
            AppPaths.Log("恢复窗口位置失败：" + ex.Message);
            return false;
        }
    }

    private void SavePlacement()
    {
        try
        {
            var bounds = _fullScreen
                ? _restoreBounds
                : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var placement = new Placement
            {
                X = bounds.X,
                Y = bounds.Y,
                Width = bounds.Width,
                Height = bounds.Height,
                Maximized = !_fullScreen && WindowState == FormWindowState.Maximized,
            };
            File.WriteAllText(AppPaths.WindowPlacementFile, JsonSerializer.Serialize(placement));
        }
        catch (Exception ex)
        {
            AppPaths.Log("保存窗口位置失败：" + ex.Message);
        }
    }

    // ------------------------------------------------------------------ 窗口生命周期

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyDarkTitleBar();
    }

    /// <summary>Windows 10 1809+ / Windows 11 支持把标题栏画成深色；不支持就当没这回事。</summary>
    private void ApplyDarkTitleBar()
    {
        try
        {
            var enabled = 1;
            const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
            const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
            if (DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref enabled, sizeof(int)) != 0)
            {
                DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref enabled, sizeof(int));
            }
        }
        catch { }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        SavePlacement();
        try { Application.RemoveMessageFilter(this); } catch { }

        var webView = _webView;
        _webView = null;
        if (webView is not null)
        {
            try { webView.Dispose(); } catch { }
        }
        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            try { Application.RemoveMessageFilter(this); } catch { }
        }
        base.Dispose(disposing);
    }

    private static Icon? LoadAppIcon()
    {
        _iconStream ??= typeof(MainForm).Assembly.GetManifestResourceStream("ProofRoad.Resources.app.ico");
        if (_iconStream is null) return null;
        _iconStream.Position = 0;
        return new Icon(_iconStream, new Size(32, 32));
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
