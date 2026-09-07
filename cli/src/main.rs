mod api;
mod bundle;
mod runtime;
mod setup;

use anyhow::Result;
use clap::{Parser, Subcommand};
use runtime::Installation;
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "study",
    version,
    about = "Your private Study Space installation"
)]
struct Cli {
    /// Installation directory (defaults to ~/.local/share/study-space)
    #[arg(long, global = true, env = "STUDY_HOME")]
    home: Option<PathBuf>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Install or repair a verified application bundle
    Setup {
        #[arg(long)]
        bundle: PathBuf,
        #[arg(long)]
        version: String,
        #[arg(long)]
        public_url: Option<String>,
        #[arg(long, default_value_t = 18081)]
        port: u16,
    },
    /// Show the running application's status
    Status,
    /// Check installation requirements and application health
    Doctor,
    /// Start the application and wait for readiness
    Start,
    /// Stop containers, preserving all persistent data
    Stop,
    /// Show recent container logs
    Logs {
        #[arg(short, long)]
        follow: bool,
        #[arg(long, default_value_t = 100)]
        tail: u32,
    },
    /// Download and install the latest verified release
    Update,
    /// Manage the Moodle material provider
    Moodle {
        #[command(subcommand)]
        command: MoodleCommands,
    },
}

#[derive(Subcommand)]
enum MoodleCommands {
    /// Show connection status without exposing credentials
    Status,
    /// Discover supported browser/mobile login for a Moodle site
    Discover { site_url: String },
    /// Open the web connection experience without asking for a password
    Connect,
    /// List enrolled courses after connecting
    Courses,
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let installation = Installation::new(cli.home)?;
    match cli.command {
        Commands::Setup {
            bundle,
            version,
            public_url,
            port,
        } => setup::install(
            &installation,
            &bundle,
            &version,
            public_url.as_deref(),
            port,
        ),
        Commands::Doctor => installation.doctor(),
        Commands::Status => api::print(&installation, "GET", "/api/status", None),
        Commands::Start => {
            let _lock = installation.lock()?;
            installation.compose(&["up", "-d", "--wait", "--wait-timeout", "120"])?;
            installation.verify_public()
        }
        Commands::Stop => {
            let _lock = installation.lock()?;
            installation.compose(&["stop"])
        }
        Commands::Logs { follow, tail } => {
            let count = tail.to_string();
            let mut args = vec!["logs", "--tail", &count];
            if follow {
                args.push("--follow");
            }
            installation.compose(&args)
        }
        Commands::Update => installation.update(),
        Commands::Moodle { command } => match command {
            MoodleCommands::Status => {
                api::print(&installation, "GET", "/api/providers/moodle", None)
            }
            MoodleCommands::Discover { site_url } => api::print(
                &installation,
                "POST",
                "/api/providers/moodle/discover",
                Some(serde_json::json!({"siteUrl":site_url})),
            ),
            MoodleCommands::Courses => {
                api::print(&installation, "GET", "/api/providers/moodle/courses", None)
            }
            MoodleCommands::Connect => {
                println!(
                    "Connect Moodle in your browser: {}",
                    installation.config()?.public_url
                );
                println!(
                    "Study Space never asks for your Moodle password. Complete your school's login in its own browser page."
                );
                Ok(())
            }
        },
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Study Space: {error:#}");
        std::process::exit(1);
    }
}
