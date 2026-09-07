use anyhow::{Context, Result, bail, ensure};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    path::PathBuf,
    process::{Command, Stdio},
};

#[derive(Serialize, Deserialize)]
pub struct Config {
    pub version: String,
    pub schema_version: u32,
    pub public_url: String,
    pub port: u16,
    pub release_base: String,
}

pub struct Installation {
    pub home: PathBuf,
}

impl Installation {
    pub fn new(home: Option<PathBuf>) -> Result<Self> {
        let home = match home {
            Some(path) => path,
            None => PathBuf::from(std::env::var_os("HOME").context("HOME is unset; use --home")?)
                .join(".local/share/study-space"),
        };
        ensure!(
            home.is_absolute(),
            "installation directory must be an absolute path"
        );
        Ok(Self { home })
    }

    pub fn lock(&self) -> Result<File> {
        fs::create_dir_all(&self.home)?;
        private(&self.home, 0o700)?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.home.join("operation.lock"))?;
        file.try_lock_exclusive()
            .context("another Study Space operation is running; wait for it to finish")?;
        Ok(file)
    }

    pub fn config(&self) -> Result<Config> {
        let bytes = fs::read(self.home.join("installation.json"))
            .context("installation is missing; run the README installer first")?;
        serde_json::from_slice(&bytes).context("invalid installation configuration")
    }

    pub fn compose(&self, args: &[&str]) -> Result<()> {
        self.check_ownership()?;
        let release = self.home.join("current");
        ensure!(
            release.join("compose.yaml").is_file(),
            "application bundle is missing; run the installer again"
        );
        let mut command = Command::new("docker");
        command
            .arg("compose")
            .arg("--project-name")
            .arg("study-space")
            .arg("--env-file")
            .arg(release.join("release.env"))
            .arg("--env-file")
            .arg(self.home.join("install.env"))
            .arg("--file")
            .arg(release.join("compose.yaml"));
        command.args(args);
        ensure!(
            command
                .status()
                .context("cannot run Docker Compose")?
                .success(),
            "Docker Compose failed; see the output above"
        );
        Ok(())
    }

    pub fn check_ownership(&self) -> Result<()> {
        let output = Command::new("docker")
            .args([
                "ps",
                "--all",
                "--quiet",
                "--filter",
                "label=com.docker.compose.project=study-space",
            ])
            .output()?;
        ensure!(
            output.status.success(),
            "cannot inspect existing Study Space containers"
        );
        for id in String::from_utf8(output.stdout)?.lines() {
            let result = Command::new("docker")
                .args([
                    "inspect",
                    "--format",
                    "{{index .Config.Labels \"com.docker.compose.project.config_files\"}}",
                    id,
                ])
                .output()?;
            ensure!(
                result.status.success(),
                "cannot verify existing installation ownership"
            );
            let files = String::from_utf8(result.stdout)?;
            ensure!(
                owns_compose_files(&self.home, files.trim()),
                "another Study Space installation owns the existing containers; use its original --home. No containers were changed"
            );
        }
        Ok(())
    }

    pub fn verify_public(&self) -> Result<()> {
        let config = self.config()?;
        for base in [
            format!("http://127.0.0.1:{}", config.port),
            config.public_url.clone(),
        ] {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
            let mut verified = false;
            while std::time::Instant::now() < deadline {
                if let (Ok(ready), Ok(status)) = (
                    fetch_json(&format!("{base}/health/ready")),
                    fetch_json(&format!("{base}/api/status")),
                ) {
                    verified = !ready.is_null() && matches_installation(&status, &config);
                    if verified {
                        break;
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
            ensure!(
                verified,
                "health/version verification failed for {base}; run study doctor. Installation data is preserved"
            );
        }
        println!(
            "Study Space is ready.\n\nWeb UI: {}\nCLI:    study --help",
            config.public_url
        );
        Ok(())
    }

    pub fn doctor(&self) -> Result<()> {
        prerequisites()?;
        println!("Docker and Docker Compose: ready");
        ensure!(
            std::path::Path::new("/etc/dotnaos/systems-machine-proxy/dynamic").is_dir(),
            "Systems machine proxy is missing; install the Systems machine proxy and its Tailnet DNS/TLS prerequisites first"
        );
        check_proxy()?;
        println!("Systems machine proxy: running on this machine’s Tailnet address");
        let config = self.config()?;
        println!(
            "Installation: {}\nVersion: {}\nWeb UI: {}",
            self.home.display(),
            config.version,
            config.public_url
        );
        self.verify_public()
    }

    pub fn update(&self) -> Result<()> {
        let config = self.config()?;
        let staging = tempfile::Builder::new()
            .prefix(".update-")
            .tempdir_in(&self.home)?;
        let temp = staging.path().join("install.sh");
        let url = format!("{}/install.sh", config.release_base.trim_end_matches('/'));
        ensure!(
            Command::new("curl")
                .args([
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--location",
                    "--proto",
                    "=https",
                    "--tlsv1.2",
                    "--output"
                ])
                .arg(&temp)
                .arg(url)
                .status()?
                .success(),
            "cannot download the installer; existing installation is unchanged"
        );
        let result = Command::new("sh")
            .arg(&temp)
            .env("STUDY_HOME", &self.home)
            .env("STUDY_RELEASE_BASE", config.release_base)
            .status();
        ensure!(result?.success(), "update failed; inspect the output above");
        Ok(())
    }
}

pub fn private(path: &std::path::Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}

pub fn prerequisites() -> Result<()> {
    ensure!(
        cfg!(target_os = "linux") && cfg!(target_arch = "x86_64"),
        "this release supports Linux x86_64 only"
    );
    for (program, args) in [
        ("docker", vec!["info"]),
        ("docker", vec!["compose", "version"]),
        ("curl", vec!["--version"]),
    ] {
        if !Command::new(program)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            bail!(
                "{program} is unavailable or inaccessible; install Docker Engine, its Compose plugin, and curl, then grant this user Docker access"
            );
        }
    }
    Ok(())
}

/// Verify the actual Systems runtime and its private listeners, not just installed files.
pub fn check_proxy() -> Result<()> {
    let output = Command::new("docker")
        .args(["inspect", "systems-machine-proxy", "--format", "{{json .}}"])
        .output()
        .context("cannot inspect Systems machine proxy")?;
    ensure!(
        output.status.success(),
        "Systems machine proxy container is missing"
    );
    let state: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    ensure!(
        state["State"]["Running"] == true && state["HostConfig"]["NetworkMode"] == "host",
        "Systems machine proxy must be running with its supported host network configuration"
    );
    let output = Command::new("tailscale")
        .args(["ip", "-4"])
        .output()
        .context(
            "Tailscale is missing or disconnected; sign this machine into your Tailnet first",
        )?;
    ensure!(output.status.success(), "Tailscale is disconnected");
    let ip = String::from_utf8(output.stdout)?
        .trim()
        .parse::<std::net::Ipv4Addr>()
        .context("Tailscale did not return one IPv4 address")?;
    let octets = ip.octets();
    ensure!(
        octets[0] == 100 && (64..=127).contains(&octets[1]),
        "Tailscale returned an unexpected address"
    );
    let config = fs::read_to_string("/etc/dotnaos/systems-machine-proxy/traefik.yml")?;
    let addresses: Vec<_> = config
        .lines()
        .filter_map(|line| line.trim().strip_prefix("address:"))
        .map(|address| address.trim().trim_matches('"').trim_matches('\''))
        .collect();
    for port in [80, 443] {
        let expected = format!("{ip}:{port}");
        let suffix = format!(":{port}");
        let listeners: Vec<_> = addresses
            .iter()
            .filter(|address| address.ends_with(&suffix))
            .collect();
        ensure!(
            listeners == vec![&expected.as_str()],
            "Systems port {port} must listen exclusively on this machine's Tailnet address"
        );
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from((ip, port)),
            std::time::Duration::from_secs(3),
        )
        .with_context(|| format!("Systems port {port} is not reachable on the Tailnet address"))?;
    }
    Ok(())
}

fn owns_compose_files(home: &std::path::Path, files: &str) -> bool {
    !files.is_empty()
        && files.split(',').all(|file| {
            let path = std::path::Path::new(file);
            path.file_name().is_some_and(|name| name == "compose.yaml")
                && (path.starts_with(home.join("current"))
                    || path.starts_with(home.join("releases")))
                && !path
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir))
        })
}

fn fetch_json(url: &str) -> Result<serde_json::Value> {
    let output = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "3",
            "--max-time",
            "5",
            url,
        ])
        .output()?;
    ensure!(output.status.success(), "endpoint unavailable");
    serde_json::from_slice(&output.stdout).context("endpoint returned invalid JSON")
}

fn matches_installation(status: &serde_json::Value, config: &Config) -> bool {
    status["app"] == "study-space"
        && status["version"]
            .as_str()
            .map(|value| value.trim_start_matches('v'))
            == Some(config.version.trim_start_matches('v'))
        && status["database"] == "ready"
        && status["publicUrl"] == config.public_url
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_second_home_cannot_take_over_containers() {
        let home = std::path::Path::new("/home/oli/.local/share/study-space");
        assert!(owns_compose_files(
            home,
            "/home/oli/.local/share/study-space/current/compose.yaml"
        ));
        assert!(owns_compose_files(
            home,
            "/home/oli/.local/share/study-space/releases/0.1.0/compose.yaml"
        ));
        for path in [
            "",
            "/tmp/other/current/compose.yaml",
            "/home/oli/.local/share/study-space/current/../../elsewhere/compose.yaml",
        ] {
            assert!(!owns_compose_files(home, path));
        }
    }

    #[test]
    fn wrong_application_or_release_does_not_pass_health() {
        let config = Config {
            version: "0.1.0".into(),
            schema_version: 1,
            public_url: "https://study.os-pc.vpn.os-home.net".into(),
            port: 18081,
            release_base: "https://example.test".into(),
        };
        let good = serde_json::json!({"app":"study-space","version":"v0.1.0","database":"ready","publicUrl":config.public_url});
        assert!(matches_installation(&good, &config));
        for (field, value) in [
            ("app", "other-app"),
            ("version", "0.2.0"),
            ("database", "unavailable"),
            ("publicUrl", "https://wrong.example"),
        ] {
            let mut bad = good.clone();
            bad[field] = value.into();
            assert!(!matches_installation(&bad, &config));
        }
    }
}
