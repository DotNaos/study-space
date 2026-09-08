using Microsoft.AspNetCore.DataProtection;
using Npgsql;
namespace StudySpace.Api.Infrastructure;

public static class RuntimeConfiguration
{
    public static string DataDirectory(IConfiguration config) => config["STUDY_DATA_DIR"] ?? "/var/lib/study-space";

    public static IDataProtectionProvider DataProtection(IConfiguration config)
    {
        var path = Path.Combine(config["STUDY_PRIVATE_DIR"] ?? "/var/lib/study-space-private", "keys");
        var certificate = PrivateFiles.Certificate(path);
        return DataProtectionProvider.Create(new DirectoryInfo(path), builder =>
            builder.SetApplicationName("StudySpace").ProtectKeysWithCertificate(certificate));
    }
    public static string Database(IConfiguration config)
    {
        var configured = config.GetConnectionString("Database");
        if (configured is not null) return configured;
        var passwordFile = config["PGPASSWORD_FILE"] ?? "/run/secrets/postgres_password";
        return new NpgsqlConnectionStringBuilder
        {
            Host = config["PGHOST"] ?? "db", Port = int.Parse(config["PGPORT"] ?? "5432"),
            Database = config["PGDATABASE"] ?? "study_space", Username = config["PGUSER"] ?? "study",
            Password = File.Exists(passwordFile) ? File.ReadAllText(passwordFile).TrimEnd('\r', '\n') : "",
            IncludeErrorDetail = false, Timeout = 5, CommandTimeout = 15
        }.ConnectionString;
    }
}
