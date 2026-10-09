# 证明之路 · Windows 桌面外壳

把仓库里的网页游戏（`proof-road-standalone.html`）套进一个原生窗口，打包成
**自包含单文件 exe**：目标机器不需要装 .NET、不需要装 Visual Studio、不需要联网、
不需要管理员权限。

    desktop/
        ProofRoad.csproj      .NET 9 + WinForms 工程（唯一的依赖是 Microsoft.Web.WebView2）
        app.manifest          asInvoker / 声明 Windows 10-11 / PerMonitorV2 高 DPI
        assets/app.ico        图标：深色圆角方块 + 蓝色的 ∃（存在量词）。
                              16/24/32/48/64/128/256 七档，全部 32bpp DIB 条目
                              （不用 PNG 压缩条目，确保 System.Drawing.Icon 和各版本 Windows 都读得动）
        assets/icon-preview.png  尺寸梯预览：16/24/32/48/64 放大 8 倍 + 256 原图（构建副产物）
        src/Program.cs        入口：单实例、DPI、全局异常兜底
        src/MainForm.cs       窗口、WebView2 宿主、快捷键、窗口位置记忆、退路
        src/LocalServer.cs    回环 HTTP 服务（TcpListener 手写，不用 http.sys）
        src/AppContent.cs     内嵌网页资源 + 路由表
        src/BrowserFallback.cs 没有 WebView2 时改用 Edge/Chrome 应用窗口
        src/AppPaths.cs       统一的落盘位置与日志（绝不往 exe 目录写）
        src/CrashGuard.cs     未处理异常 → 提示 + 日志
        使用说明.txt           随发布包一起发给最终用户

## 构建

    node tools/build-desktop.mjs                    # 默认 win-x86 + win-x64 单文件 exe
    node tools/build-desktop.mjs --rid win-x86      # 只出一个架构
    node tools/build-desktop.mjs --no-single-file   # 目录版（见下）
    node tools/build-desktop.mjs --icon             # 强制重画图标（改了 tools/make-icon.mjs 之后）
    node tools/build-desktop.mjs --zip              # 顺手打一个可以直接发给别人的 zip

或直接用 dotnet：

    dotnet publish desktop/ProofRoad.csproj -c Release -r win-x86 --self-contained true \
      -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true \
      -p:EnableCompressionInSingleFile=true -p:DebugType=none -o release/win-x86

要求：.NET 9 SDK（`dotnet --version`）。不需要 Visual Studio，也不需要 Windows SDK。

## 为什么这么设计

**为什么用 WebView2 而不是自绘 / Electron。**
WebView2 就是系统里的 Edge 内核，Windows 11 自带、Windows 10 只要 Edge 更新过就有，
不用随包分发一个 Chromium。Electron 方案要背 150 MB 以上，而且它最后用的还是同一个内核。

**为什么要开一个本地 HTTP 服务，而不是直接 `file://` 打开。**
Chromium 把 `file://` 当成不透明源，`localStorage` 直接抛异常，游戏进度就存不下来。
挂到 `http://127.0.0.1:<port>/` 之后，localStorage、模块加载、严格模式全部正常。

**为什么端口是固定的 47100-47103。**
localStorage 按「协议 + 主机 + 端口」隔离，端口一变就等于换了存档位置。
选 47xxx 是因为 Windows 的动态端口范围默认从 49152 起，这个区间不会被系统随机占用。
万一四个端口都被占了才退回随机端口——那一局看进度像清零，下次拿回固定端口存档就又回来了。

**为什么用 TcpListener 手写 HTTP，而不是 HttpListener。**
HttpListener 走 http.sys，非管理员绑定前缀需要预先注册 URL ACL，还会牵扯防火墙。
自己开一个只监听 `127.0.0.1` 的 socket 没有这些前置条件，也不会触发防火墙弹窗。

**为什么编译成 x86（32 位）。**
32 位进程在 32 位、64 位、ARM64 的 Windows 上都能跑，覆盖面最大。
x64 版本一起发布，是为了 ARM64 这种「系统里只有 64 位 WebView2 运行时」的少数情况。

**为什么用 PublishSingleFile + IncludeNativeLibrariesForSelfExtract。**
WebView2 的托管层要 P/Invoke 一个原生 DLL（`WebView2Loader.dll`），
单文件发布必须允许把原生库自解包出来。实测只解出约 0.3 MB 到
`%TEMP%\\.net\\ProofRoad`，托管程序集是在内存里解压的，冷启动约 0.5 秒。

**为什么保留 app.manifest 里的高 DPI 设置，而不是只用 `Application.SetHighDpiMode`。**
清单在进程启动前就生效，WebView2 的子窗口从一开始就按 PerMonitorV2 处理。
WinForms 分析器（WFO0003）建议反过来做，这里刻意不采纳，已在 csproj 里注明。

**为什么什么都不往 exe 目录写。**
存档、缓存、日志全部落在 `%LOCALAPPDATA%\\ProofRoad`（不可写时退回 `%TEMP%`）。
这样 exe 可以放在 U 盘、只读目录、网络共享上直接运行。

## 兼容性

| 场景 | 行为 |
|---|---|
| Windows 10 1607+ / Windows 11，x86 / x64 | 正常，内嵌 WebView2 |
| Windows 10 / 11 ARM64 | x86 版走 x86 模拟；若没有 x86 版 WebView2 运行时，自动改用 Edge 应用窗口 |
| 有 Edge/Chrome 但没有 WebView2 运行时 | 自动改用 `msedge.exe --app=...`（独立配置目录，进度同样保存） |
| 既没有 WebView2 也没有 Edge/Chrome | 窗口里给出下载按钮，可一键打开系统默认浏览器 |
| 只读目录 / U 盘 / 网络共享 | 正常，所有写入都在用户目录 |
| 高 DPI（125% / 150% / 200%） | PerMonitorV2，多显示器之间拖动不糊 |
| 屏幕只有 1366×768 | 初始窗口按工作区收缩，不会开出比屏幕还大的窗口 |

## 已知限制

- 没有代码签名证书，首次运行会看到 SmartScreen 提示（右键属性可「解除锁定」）。
- .NET 9 最低要求 Windows 10 1607；更早的 Windows 10（1507 / 1511）不受支持。
- 单实例：重复双击只会把已有窗口叫到前台。
- 目录版（`--no-single-file`）完全不解包到 TEMP，适合对 %TEMP% 下执行有管控的环境，
  代价是一个约 100 MB 的文件夹而不是一个 exe。
## 后续更新流程

**唯一的事实来源是 `src/`、`index.html`、`styles.css`。** exe 里装的是这些文件的一份**快照**
（`proof-road-standalone.html`）。所以改完源码**必须重新打包**才会生效——
反过来，手改 `proof-road-standalone.html` 或直接改 exe 都没用，前者会被下一次构建覆盖。

### 标准流程：两条命令

    node tests/run.mjs              # 1. 内核 / 规则 / 关卡 / 界面 / 引导 / 成就 / 史话 / 存档，155 项必须全绿
    node tools/build-desktop.mjs --zip   # 2. 打包，顺便产出可以直接发给别人的 zip

`build-desktop.mjs` 内部依次做四件事，所以**不需要单独跑** `build-single.mjs`：

1. 重新生成 `proof-road-standalone.html`（把 `src/` 下 16 个模块按依赖顺序内联）
2. 跑 `check-standalone.mjs` 校验这个单文件真的能在 Node 里启动并推完一关
3. 对每个架构执行 `dotnet publish`（自包含 + 单文件 + 压缩）
4. 把 exe 组装进 `release/`，并同步 `使用说明.txt`

### 按改动类型对照

| 你改了什么 | 命令 |
|---|---|
| `src/**`（关卡、公理、规则、内核、界面逻辑） | `node tools/build-desktop.mjs --zip` |
| `index.html` / `styles.css` | 同上 |
| `desktop/src/*.cs`（窗口、快捷键、退路、DPI） | 同上 |
| `tools/make-icon.mjs`（图标形状 / 配色） | `node tools/build-desktop.mjs --icon --zip` |
| 只想换个版本号 | 改 csproj 的 `<Version>`，再走上面任一条 |
| 只改文档（`README.md` / `使用说明.txt`） | `node tools/build-desktop.mjs --skip-web --rid win-x86`（只为同步 `使用说明.txt`） |

### 版本号

`desktop/ProofRoad.csproj` 里的 `<Version>` 决定 exe 属性页和 F1「关于」里显示的版本。
**每次对外发之前往上加一位**，否则朋友分不清手里的是哪一版：

    <Version>0.2</Version>
    <FileVersion>0.2.0.0</FileVersion>
    <AssemblyVersion>0.1.0.0</AssemblyVersion>   <!-- 这个别动 -->
    <InformationalVersion>0.2</InformationalVersion>

F1「关于」显示的是 `InformationalVersion`（也就是 `<Version>`），不是 `AssemblyVersion`。

### 打包完自己过一遍（30 秒）

1. `release\ProofRoad.exe` 双击能开，窗口标题、任务栏图标正确；
2. 随便推完一关 → 关掉 → 再开，进度还在；
3. `%LOCALAPPDATA%\ProofRoad\proof-road.log` 里没有异常堆栈。

改了图标的话，先看 `desktop/assets/icon-preview.png`——那是各档尺寸放大后的样子，
4 笔的 ∃ 最容易在 16px 下粘成一坨。

### 四个会绊人的地方

- **程序开着的时候打包会失败。** `release\ProofRoad.exe` 被占用，复制不过去
  （脚本会重试 12 次再报错）。先关掉程序。
- **别用 `Get-Process ProofRoad` 去杀 x64 版。** `ProofRoad-x64.exe` 的进程名是 `ProofRoad-x64`，
  这个名字匹配不到它。用
  `Get-Process | Where-Object { $_.ProcessName -like 'ProofRoad*' } | Stop-Process -Force`。
- **改了图标但资源管理器还显示旧的。** Windows 按路径缓存图标。把 exe 换个文件名，
  或者跑一次 `ie4uinit.exe -show` 刷新图标缓存。
- **存档格式变了要留神。** 进度存在 `%LOCALAPPDATA%\ProofRoad\WebView2` 的 localStorage 里，
  键是 `lpg.done`（一个关卡 id 的 JSON 数组）。如果哪天改了这个键或结构，
  老用户的进度会"清零"——要么兼容读旧键，要么在说明里写清楚。

### 发布签名（可选）

现在没有代码签名证书，所以每发一个新版本，SmartScreen 都会照样拦一次。
买了证书之后，在 csproj 里加 `<SignAssembly>` / 用 `signtool` 签 `release\ProofRoad.exe` 即可，
不需要改任何代码。
