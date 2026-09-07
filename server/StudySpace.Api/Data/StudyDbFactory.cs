using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
namespace StudySpace.Api.Data;

// Migrations are generated without starting the host or reading runtime credentials.
public sealed class StudyDbFactory : IDesignTimeDbContextFactory<StudyDb>
{
    public StudyDb CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<StudyDb>()
        .UseNpgsql("Host=localhost;Database=study_space;Username=study").Options);
}
