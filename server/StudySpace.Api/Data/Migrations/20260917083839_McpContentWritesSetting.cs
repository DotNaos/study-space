using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudySpace.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class McpContentWritesSetting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "McpContentWritesEnabled",
                table: "Settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "McpContentWritesEnabled",
                table: "Settings");
        }
    }
}
