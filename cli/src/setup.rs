use crate::runtime::{Config, Installation, prerequisites, private};
use anyhow::{Context, Result, ensure};
use std::{fs, io::Read, net::TcpListener, path::Path, process::Command};

const PROXY_DIR: &str = "/etc/dotnaos/systems-machine-proxy/dynamic";

pub fn install(
    installation: &Installation,
    bundle: &Path,
    version: &str,
    public_url: Option<&str>,
    requested_port: u16,
) -> Result<()> {
    ensure!(valid_version(version), "invalid release version");
    ensure!(
        bundle.join("compose.yaml").is_file() && bundle.join("release.env").is_file(),
        "bundle lacks compose.yaml or release.env"
    );
    prerequisites()?;
    crate::runtime::check_proxy()?;
    ensure!(
        Path::new(PROXY_DIR).is_dir(),
        "Systems machine proxy is missing. Configure the machine's Tailnet-only proxy and wildcard DNS/TLS first (DotNaos/systems docs/machine-proxy.md), then rerun this installer"
    );
    let _lock = installation.lock()?;
    installation.check_ownership()?;
    let prior = if installation.home.join("installation.json").exists() {
        Some(installation.config()?)
    } else {
        None
    };
    let schema_version = bundle_schema(bundle)?;
    if let Some(old) = &prior {
        ensure!(
            old.schema_version == schema_version,
            "this release changes the database schema; automatic upgrade is blocked until a verified backup and migration path are available"
        );
    }
    let public_url = match (public_url, prior.as_ref()) {
        (Some(url), _) => url.trim_end_matches('/').to_string(),
        (None, Some(config)) => config.public_url.clone(),
        (None, None) => {
            let host = Command::new("hostname").arg("-s").output()?;
            ensure!(host.status.success(), "cannot determine machine hostname");
            format!(
                "https://study.{}.vpn.os-home.net",
                String::from_utf8(host.stdout)?.trim()
            )
        }
    };
    let hostname = validate_public_url(&public_url)?;
    let port = match &prior {
        Some(config) => config.port,
        None => free_port(requested_port)?,
    };
    let config = Config {
        version: version.to_string(),
        public_url,
        port,
        schema_version,
        release_base: std::env::var("STUDY_RELEASE_BASE").unwrap_or_else(|_| {
            "https://github.com/DotNaos/study-space/releases/latest/download".into()
        }),
    };
    // Privileged operations are limited to our own runtime directories and route.
    let secrets = installation.home.join("secrets");
    let data = installation.home.join("data");
    fs::create_dir_all(&secrets)?;
    private(&secrets, 0o700)?;
    fs::create_dir_all(&data)?;
    for path in [data.join("app"), secrets.join("app-private")] {
        sudo(&[
            "install",
            "-d",
            "-m",
            "0700",
            path.to_str().context("non-UTF8 path")?,
        ])?;
        sudo(&[
            "chown",
            "1654:1654",
            path.to_str().context("non-UTF8 path")?,
        ])?;
    }
    let password = secrets.join("postgres_password");
    if !password.exists() {
        let mut bytes = [0u8; 32];
        fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
        let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        atomic_write(&password, secret.as_bytes(), 0o600)?;
        sudo(&[
            "chown",
            "1654:1654",
            password.to_str().context("non-UTF8 path")?,
        ])?;
    }
    let release = installation.home.join("releases").join(version);
    if !release.exists() {
        let staging = installation
            .home
            .join("releases")
            .join(format!(".{version}.staging"));
        if staging.exists() {
            fs::remove_dir_all(&staging)?;
        }
        copy_bundle(bundle, &staging)?;
        fs::rename(&staging, &release)?;
    } else {
        for file in ["compose.yaml", "release.env"] {
            ensure!(
                fs::read(release.join(file))? == fs::read(bundle.join(file))?,
                "release {version} already exists with different contents; publish a new version"
            );
        }
    }
    let current = installation.home.join("current");
    let old_target = fs::read_link(&current).ok();
    let config_path = installation.home.join("installation.json");
    let env_path = installation.home.join("install.env");
    let old_config = fs::read(&config_path).ok();
    let old_env = fs::read(&env_path).ok();
    let route_path = Path::new(PROXY_DIR).join("study-space.yml");
    let old_route = fs::read(&route_path).ok();
    if let Some(bytes) = &old_route {
        ensure!(
            bytes.starts_with(b"# Managed by Study Space."),
            "study-space.yml already exists and is not owned by Study Space; preserve it and resolve the route collision first"
        );
    }
    let env = env_content(&config, &data, &secrets)?;
    let result = (|| -> Result<()> {
        atomic_write(&env_path, env.as_bytes(), 0o600)?;
        atomic_write(&config_path, &serde_json::to_vec_pretty(&config)?, 0o600)?;
        activate(&current, &release)?;
        installation.compose(&["config", "--quiet"])?;
        installation.compose(&["up", "-d", "--wait", "--wait-timeout", "120"])?;
        write_route(installation, proxy_route(&hostname, port).as_bytes())?;
        installation.verify_public()
    })();
    if let Err(error) = result {
        match &old_route {
            Some(bytes) => write_route(installation, bytes)?,
            None => sudo(&[
                "rm",
                "-f",
                "--",
                route_path.to_str().context("non-UTF8 route")?,
            ])?,
        }
        if let Some(previous) = old_target {
            eprintln!("Installation failed; restoring the previous application release.");
            if let Some(bytes) = old_config {
                atomic_write(&config_path, &bytes, 0o600)?;
            }
            if let Some(bytes) = old_env {
                atomic_write(&env_path, &bytes, 0o600)?;
            }
            activate(&current, &previous)?;
            installation.compose(&["up", "-d", "--wait", "--wait-timeout", "120"])
                .context("update failed and the prior application could not restart; data is preserved; run study doctor")?;
        }
        return Err(
            error.context("setup did not pass its health checks; persistent data was preserved")
        );
    }
    Ok(())
}

fn bundle_schema(bundle: &Path) -> Result<u32> {
    let content = fs::read_to_string(bundle.join("release.env"))?;
    let versions: Vec<_> = content
        .lines()
        .filter_map(|line| line.strip_prefix("STUDY_SCHEMA_VERSION="))
        .collect();
    ensure!(
        versions.len() == 1,
        "release.env must declare one STUDY_SCHEMA_VERSION"
    );
    versions[0].parse().context("invalid bundle schema version")
}

fn env_content(config: &Config, data: &Path, secrets: &Path) -> Result<String> {
    for path in [data, secrets] {
        let text = path.to_str().context("non-UTF8 installation path")?;
        ensure!(
            !text.contains(['\n', '\r', '\'', '$']),
            "installation path contains unsupported characters"
        );
    }
    Ok(format!(
        "STUDY_PUBLIC_URL='{}'\nSTUDY_HOST_PORT={}\nSTUDY_DATA_DIR='{}'\nSTUDY_SECRETS_DIR='{}'\nSTUDY_VERSION='{}'\nSTUDY_HOSTNAME='{}'\n",
        config.public_url,
        config.port,
        data.display(),
        secrets.display(),
        config.version,
        config
            .public_url
            .trim_start_matches("https://study.")
            .trim_end_matches(".vpn.os-home.net")
    ))
}

fn validate_public_url(url: &str) -> Result<String> {
    let host = url
        .strip_prefix("https://")
        .context("public URL must use HTTPS")?;
    ensure!(
        host.ends_with(".vpn.os-home.net")
            && host.starts_with("study.")
            && host.split('.').all(|label| !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
                && !label.starts_with('-')
                && !label.ends_with('-')),
        "public URL must be https://study.<machine>.vpn.os-home.net"
    );
    Ok(host.into())
}

fn free_port(preferred: u16) -> Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", preferred))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))?;
    Ok(listener.local_addr()?.port())
}

fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 100
        && version
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_'))
        && !version.starts_with('.')
}

fn copy_bundle(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        ensure!(!kind.is_symlink(), "bundle must not contain symlinks");
        let target = destination.join(entry.file_name());
        if kind.is_dir() {
            copy_bundle(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target)?;
        } else {
            anyhow::bail!("unsupported bundle entry");
        }
    }
    Ok(())
}

fn activate(link: &Path, target: &Path) -> Result<()> {
    let temp = link.with_extension(format!("next-{}", std::process::id()));
    if temp.exists() || temp.is_symlink() {
        fs::remove_file(&temp)?;
    }
    std::os::unix::fs::symlink(target, &temp)?;
    fs::rename(temp, link)?;
    Ok(())
}

pub fn atomic_write(path: &Path, bytes: &[u8], mode: u32) -> Result<()> {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(temp, path)?;
    Ok(())
}

fn sudo(args: &[&str]) -> Result<()> {
    ensure!(
        Command::new("sudo")
            .arg("--")
            .args(args)
            .status()
            .context("sudo is required to configure the machine proxy and private runtime files")?
            .success(),
        "administrator operation failed; ensure sudo access and rerun setup"
    );
    Ok(())
}

fn write_route(installation: &Installation, contents: &[u8]) -> Result<()> {
    let local = installation.home.join("proxy-route.next");
    atomic_write(&local, contents, 0o600)?;
    let remote = format!("{PROXY_DIR}/.study-space.yml.next");
    sudo(&[
        "install",
        "-m",
        "0644",
        local.to_str().context("non-UTF8 path")?,
        &remote,
    ])?;
    sudo(&["mv", "--", &remote, &format!("{PROXY_DIR}/study-space.yml")])?;
    fs::remove_file(local)?;
    Ok(())
}

fn proxy_route(hostname: &str, port: u16) -> String {
    format!(
        "# Managed by Study Space. Other service routes are independent.\nhttp:\n  routers:\n    study-space:\n      rule: 'Host(`{hostname}`)'\n      entryPoints: [websecure]\n      service: study-space\n      tls: {{}}\n    study-space-http:\n      rule: 'Host(`{hostname}`)'\n      entryPoints: [web]\n      middlewares: [https-redirect]\n      service: study-space\n  services:\n    study-space:\n      loadBalancer:\n        servers:\n          - url: 'http://127.0.0.1:{port}'\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_injected_routes_and_versions() {
        assert!(validate_public_url("https://study.os-pc.vpn.os-home.net").is_ok());
        for url in [
            "http://study.os-pc.vpn.os-home.net",
            "https://study.os-pc.vpn.os-home.net/path",
            "https://study.`x`.vpn.os-home.net",
            "https://study.os-pc.vpn.os-home.net:443",
        ] {
            assert!(validate_public_url(url).is_err());
        }
        for version in ["", "../oops", ".", "foo\nbar", "a/b"] {
            assert!(!valid_version(version));
        }
        assert!(valid_version("0.1.0-rc.1"));
    }
    #[test]
    fn occupied_preferred_port_uses_free_loopback_port() {
        let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = occupied.local_addr().unwrap().port();
        assert_ne!(free_port(port).unwrap(), port);
    }
    #[test]
    fn atomic_activation_and_files_preserve_existing_data() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("config");
        atomic_write(&file, b"old", 0o600).unwrap();
        atomic_write(&file, b"new", 0o600).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"new");
        let link = temp.path().join("current");
        activate(&link, Path::new("release-one")).unwrap();
        activate(&link, Path::new("release-two")).unwrap();
        assert_eq!(
            fs::read_link(link).unwrap(),
            std::path::PathBuf::from("release-two")
        );
    }
    #[test]
    fn bundle_rejects_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", source.join("secret")).unwrap();
        assert!(copy_bundle(&source, &temp.path().join("dest")).is_err());
    }
}
