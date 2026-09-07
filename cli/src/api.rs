use crate::runtime::Installation;
use anyhow::{Context, Result, ensure};
use serde_json::Value;
use std::{
    io::Write,
    process::{Command, Stdio},
};

pub fn print(
    installation: &Installation,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<()> {
    let config = installation.config()?;
    let mut command = Command::new("curl");
    command
        .args([
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--connect-timeout",
            "3",
            "--max-time",
            "30",
            "--request",
            method,
            "--header",
            &format!("Origin: {}", config.public_url),
            "--header",
            "Content-Type: application/json",
        ])
        .arg(format!("http://127.0.0.1:{}{path}", config.port))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if body.is_some() {
        command.args(["--data-binary", "@-"]).stdin(Stdio::piped());
    }
    let mut child = command
        .spawn()
        .context("cannot call the local Study Space API")?;
    if let Some(value) = body {
        child
            .stdin
            .take()
            .context("request input unavailable")?
            .write_all(value.to_string().as_bytes())?;
    }
    let result = child.wait_with_output()?;
    let json: Value = serde_json::from_slice(&result.stdout)
        .context("Study Space did not return JSON; run study doctor")?;
    if !result.status.success() {
        let title = json
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Request failed");
        let detail = json
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or("Check study doctor and retry.");
        anyhow::bail!("{title}: {detail}");
    }
    ensure!(result.status.success(), "request failed");
    println!("{}", serde_json::to_string_pretty(&json)?);
    Ok(())
}
