using Microsoft.EntityFrameworkCore;
namespace StudySpace.Api.Data;

public sealed class StudyDb(DbContextOptions<StudyDb> options) : DbContext(options)
{
    public DbSet<AppSettings> Settings => Set<AppSettings>();
    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<AppSettings>().HasKey(x => x.Id);
        model.Entity<AppSettings>().Property(x => x.DisplayName).HasMaxLength(100);
        model.Entity<AppSettings>().Property(x => x.Locale).HasMaxLength(10);
    }
}
public sealed class AppSettings
{
    public int Id { get; set; } = 1;
    public string DisplayName { get; set; } = "Study Space";
    public string Locale { get; set; } = "de";
}
