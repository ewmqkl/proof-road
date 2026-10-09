using System.Reflection;

namespace ProofRoad;

/// <summary>
/// 内嵌在 exe 里的网页资源。整个游戏就是 proof-road-standalone.html 这一个文件，
/// 它又被 tools/build-single.mjs 从 src/ 下的模块打包而成，所以这里不需要任何外部文件。
/// </summary>
internal static class AppContent
{
    private const string HtmlResource = "ProofRoad.Resources.app.html";
    private const string IconResource = "ProofRoad.Resources.app.ico";

    public static byte[] Html { get; } = Read(HtmlResource);

    public static byte[] Icon { get; } = Read(IconResource);

    /// <summary>本地服务暴露的路由表：路径 → (内容, MIME)。</summary>
    public static IReadOnlyDictionary<string, (byte[] Body, string ContentType)> Routes { get; } =
        new Dictionary<string, (byte[], string)>(StringComparer.OrdinalIgnoreCase)
        {
            ["/"] = (Html, "text/html; charset=utf-8"),
            ["/index.html"] = (Html, "text/html; charset=utf-8"),
            ["/app.html"] = (Html, "text/html; charset=utf-8"),
            ["/favicon.ico"] = (Icon, "image/x-icon"),
        };

    private static byte[] Read(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (stream is null) throw new InvalidOperationException("缺少内嵌资源：" + name);
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
