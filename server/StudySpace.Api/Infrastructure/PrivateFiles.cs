using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
namespace StudySpace.Api.Infrastructure;

public static class PrivateFiles
{
    public static void Directory(string path)
    {
        System.IO.Directory.CreateDirectory(path);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }
    public static async Task WriteAsync(string path, byte[] bytes)
    {
        Directory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        try
        {
            await using (var file = new FileStream(temporary, options))
            { await file.WriteAsync(bytes); file.Flush(true); }
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public static X509Certificate2 Certificate(string directory)
    {
        Directory(directory);
        var path = Path.Combine(directory, "data-protection.pfx");
        if (!File.Exists(path))
        {
            using var rsa = RSA.Create(3072);
            var request = new CertificateRequest("CN=Study Space local data protection", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(20));
            WriteAsync(path, certificate.Export(X509ContentType.Pfx)).GetAwaiter().GetResult();
        }
        return X509CertificateLoader.LoadPkcs12FromFile(path, null);
    }
}
