using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ProofRoad;

/// <summary>
/// 极小的回环 HTTP 服务，用来把内嵌网页交给 WebView2 或外部浏览器。
///
/// 为什么非要一个服务，而不是直接 file:// 打开？
///   Chromium 把 file:// 当成不透明源，localStorage 会直接抛异常，游戏进度就存不下来。
///   挂到 127.0.0.1 上的 http 源之后，localStorage、严格模式、模块加载全部正常。
///
/// 为什么不用 HttpListener？
///   HttpListener 走 http.sys，非管理员绑定前缀需要预先注册 URL ACL，还会牵扯防火墙。
///   直接开 TcpListener 端口就没有这些前情提要。
///
/// 安全边界：只监听回环地址、端口由系统随机分配、只回应询路由表里那几条路径，退出即消失。
/// </summary>
internal sealed class LocalServer : IDisposable
{
    private const int HeaderLimit = 16 * 1024;

    /// <summary>
    /// localStorage 是按"源"（协议 + 主机 + 端口）隔离的：端口一变，玩家存档就找不回来了。
    /// 所以优先绑一组固定的高位端口——选 47xxx 是因为 Windows 的动态端口范围默认从 49152 起，
    /// 这个区间不会被系统随机分配出去。万一全被占用，才退回系统随机端口：
    /// 那一局看进度像清零，下次拿回固定端口存档就又回来了。
    /// </summary>
    private static readonly int[] PreferredPorts = { 47100, 47101, 47102, 47103 };

    private static readonly byte[] Crlf = "\r\n"u8.ToArray();

    private readonly TcpListener _listener;
    private readonly Dictionary<string, (byte[] Body, string ContentType)> _routes;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _acceptLoop;

    public int Port { get; }

    public string Url { get; }

    public LocalServer(IReadOnlyDictionary<string, (byte[] Body, string ContentType)> routes)
    {
        _routes = new Dictionary<string, (byte[], string)>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in routes) _routes[pair.Key] = pair.Value;

        _listener = Bind(out var port, out var preferred);
        Port = port;
        Url = "http://127.0.0.1:" + Port + "/";
        _acceptLoop = Task.Run(AcceptLoopAsync);
        AppPaths.Log("本地服务已启动：" + Url + (preferred ? "（固定端口）" : "（固定端口被占用，已退回随机端口）"));
    }

    private static TcpListener Bind(out int port, out bool preferred)
    {
        foreach (var candidate in PreferredPorts)
        {
            TcpListener listener;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, candidate);
                listener.Start(64);
            }
            catch (SocketException)
            {
                continue;
            }
            port = candidate;
            preferred = true;
            return listener;
        }

        var fallback = new TcpListener(IPAddress.Loopback, 0);
        fallback.Start(64);
        port = ((IPEndPoint)fallback.LocalEndpoint).Port;
        preferred = false;
        return fallback;
    }

    private async Task AcceptLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (SocketException) when (_cts.IsCancellationRequested) { break; }
            catch (SocketException ex)
            {
                AppPaths.Log("接受连接失败：" + ex.Message);
                continue;
            }

            _ = Task.Run(() => HandleAsync(client));
        }
    }

    private async Task HandleAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.NoDelay = true;
                using var stream = client.GetStream();
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                var token = timeout.Token;

                var header = await ReadHeaderAsync(stream, token).ConfigureAwait(false);
                if (header is null) return;

                var requestLine = header.Split('\n', 2)[0].Trim();
                var parts = requestLine.Split(' ');
                var method = parts.Length > 0 ? parts[0].ToUpperInvariant() : "GET";
                var path = NormalizePath(parts.Length > 1 ? parts[1] : "/");

                if (method is not ("GET" or "HEAD"))
                {
                    await WriteAsync(stream, 405, "Method Not Allowed", "text/plain; charset=utf-8",
                        "405 Method Not Allowed"u8.ToArray(), false, token).ConfigureAwait(false);
                    return;
                }

                if (_routes.TryGetValue(path, out var route))
                {
                    await WriteAsync(stream, 200, "OK", route.ContentType, route.Body, method == "HEAD", token)
                        .ConfigureAwait(false);
                }
                else
                {
                    await WriteAsync(stream, 404, "Not Found", "text/plain; charset=utf-8",
                        "404 Not Found"u8.ToArray(), method == "HEAD", token).ConfigureAwait(false);
                }
            }
            catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException)
            {
                // 浏览器换页 / 关窗口时提前断开连接属于常态，不记录
            }
            catch (Exception ex)
            {
                AppPaths.Log("处理请求出错：" + ex);
            }
        }
    }

    private static string NormalizePath(string raw)
    {
        var path = raw;
        var cut = path.IndexOfAny(new[] { '?', '#' });
        if (cut >= 0) path = path[..cut];
        if (path.Length == 0) return "/";
        try { path = Uri.UnescapeDataString(path); } catch { /* 保底用原串 */ }
        if (!path.StartsWith('/')) path = "/" + path;
        if (path.Length > 1) path = path.TrimEnd('/');
        return path.Length == 0 ? "/" : path;
    }

    private static async Task<string?> ReadHeaderAsync(NetworkStream stream, CancellationToken token)
    {
        var buffer = new byte[2048];
        var received = new List<byte>(2048);
        while (received.Count < HeaderLimit)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(), token).ConfigureAwait(false);
            if (read <= 0) return null;
            for (var i = 0; i < read; i++)
            {
                received.Add(buffer[i]);
                var n = received.Count;
                if (n >= 4 && received[n - 4] == 13 && received[n - 3] == 10 &&
                    received[n - 2] == 13 && received[n - 1] == 10)
                {
                    return Encoding.ASCII.GetString(received.ToArray());
                }
            }
        }
        return null;
    }

    private static async Task WriteAsync(NetworkStream stream, int status, string reason, string contentType,
        byte[] body, bool headOnly, CancellationToken token)
    {
        var header = new StringBuilder()
            .Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n")
            .Append("Content-Type: ").Append(contentType).Append("\r\n")
            .Append("Content-Length: ").Append(body.Length).Append("\r\n")
            .Append("Cache-Control: no-store, must-revalidate\r\n")
            .Append("X-Content-Type-Options: nosniff\r\n")
            .Append("Connection: close\r\n")
            .Append("\r\n")
            .ToString();

        await stream.WriteAsync(Encoding.ASCII.GetBytes(header).AsMemory(), token).ConfigureAwait(false);
        if (!headOnly) await stream.WriteAsync(body.AsMemory(), token).ConfigureAwait(false);
        await stream.FlushAsync(token).ConfigureAwait(false);
    }

    public void Dispose()
    {
        try { _cts.Cancel(); } catch { }
        try { _listener.Stop(); } catch { }
        try { _acceptLoop.Wait(TimeSpan.FromSeconds(2)); } catch { }
        try { _cts.Dispose(); } catch { }
        AppPaths.Log("本地服务已停止");
    }
}
