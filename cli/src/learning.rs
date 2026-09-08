use crate::{api, runtime::Installation};
use anyhow::Result;
use clap::Subcommand;

#[derive(Subcommand)]
pub enum LearningCommands {
    /// Show prepared materials and coverage
    Materials {
        #[arg(value_parser = clap::value_parser!(i64).range(1..))]
        course: i64,
    },
    /// Import and extract a course locally in the background
    Prepare {
        #[arg(value_parser = clap::value_parser!(i64).range(1..))]
        course: i64,
    },
    /// Cancel material preparation, preserving completed results
    CancelImport {
        #[arg(value_parser = clap::value_parser!(i64).range(1..))]
        course: i64,
        job: String,
    },
    /// Show saved script, exercises, versions and job status
    Status {
        #[arg(value_parser = clap::value_parser!(i64).range(1..))]
        course: i64,
    },
    /// Generate a script and exercises from an explicitly approved snapshot
    Generate {
        #[arg(value_parser = clap::value_parser!(i64).range(1..))]
        course: i64,
        /// Exact snapshot ID shown by learning materials
        #[arg(long)]
        snapshot: String,
        /// Explicitly allow an incomplete course version
        #[arg(long)]
        allow_partial: bool,
        /// Consent to send readable course content to OpenAI through Codex
        #[arg(long, required = true)]
        send_to_codex: bool,
    },
    /// Cancel generation, preserving completed chapters and saved versions
    Cancel {
        #[arg(value_parser = clap::value_parser!(i64).range(1..))]
        course: i64,
        job: String,
    },
}

#[derive(Subcommand)]
pub enum CodexCommands {
    /// Show connection status without revealing credentials
    Status,
    /// Show the browser address for Codex sign-in
    Connect,
}

pub fn run(installation: &Installation, command: LearningCommands) -> Result<()> {
    match command {
        LearningCommands::Materials { course } => api::print(
            installation,
            "GET",
            &format!("/api/materials/courses/{course}"),
            None,
        ),
        LearningCommands::Prepare { course } => api::print(
            installation,
            "POST",
            &format!("/api/materials/courses/{course}/import"),
            None,
        ),
        LearningCommands::CancelImport { course, job } => {
            validate_id(&job)?;
            api::print(
                installation,
                "DELETE",
                &format!("/api/materials/courses/{course}/jobs/{job}"),
                None,
            )
        }
        LearningCommands::Status { course } => api::print(
            installation,
            "GET",
            &format!("/api/learning/courses/{course}"),
            None,
        ),
        LearningCommands::Generate {
            course,
            snapshot,
            allow_partial,
            send_to_codex,
        } => {
            validate_id(&snapshot)?;
            api::print(
                installation,
                "POST",
                &format!("/api/learning/courses/{course}/generate"),
                Some(serde_json::json!({
                    "snapshotId":snapshot, "allowPartial":allow_partial, "consentToCodex":send_to_codex
                })),
            )
        }
        LearningCommands::Cancel { course, job } => {
            validate_id(&job)?;
            api::print(
                installation,
                "POST",
                &format!("/api/learning/courses/{course}/cancel"),
                Some(serde_json::json!({"jobId":job})),
            )
        }
    }
}

pub fn codex(installation: &Installation, command: CodexCommands) -> Result<()> {
    match command {
        CodexCommands::Status => api::print(installation, "GET", "/api/codex", None),
        CodexCommands::Connect => {
            println!(
                "Connect Codex in your browser: {}/sources",
                installation.config()?.public_url.trim_end_matches('/')
            );
            println!("Use your existing ChatGPT/Codex account. No API key is required.");
            Ok(())
        }
    }
}

fn validate_id(id: &str) -> Result<()> {
    anyhow::ensure!(
        (32..=64).contains(&id.len())
            && id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
        "use the exact ID shown by Study Space"
    );
    Ok(())
}
