use anyhow::{Context, Result, ensure};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

pub struct Release {
    pub schema: u32,
    pub commit: String,
}

pub fn validate(bundle: &Path, version: &str) -> Result<Release> {
    for file in [
        "compose.yaml",
        "release.env",
        "source/Dockerfile",
        "source/.dockerignore",
    ] {
        ensure!(
            bundle.join(file).is_file(),
            "release bundle is missing {file}"
        );
    }
    for directory in ["source/server", "source/web"] {
        ensure!(
            bundle.join(directory).is_dir(),
            "release bundle is missing {directory}"
        );
    }
    let content = fs::read_to_string(bundle.join("release.env"))?;
    let values = |name: &str| -> Result<String> {
        let prefix = format!("{name}=");
        let matches: Vec<_> = content
            .lines()
            .filter_map(|line| line.strip_prefix(&prefix))
            .collect();
        ensure!(
            matches.len() == 1,
            "release.env must declare exactly one {name}"
        );
        Ok(matches[0].to_string())
    };
    let commit = values("STUDY_COMMIT")?;
    ensure!(
        commit.len() == 40
            && commit
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        "release commit must be 40 lowercase hexadecimal characters"
    );
    let release_version = format!("v{}", version.trim_start_matches('v'));
    ensure!(
        values("STUDY_VERSION")? == release_version,
        "release version does not match the installer version"
    );
    ensure!(
        values("STUDY_IMAGE")? == format!("study-space-local:{release_version}-{commit}"),
        "application image must be the local image for this exact released source"
    );
    let schema = values("STUDY_SCHEMA_VERSION")?
        .parse()
        .context("invalid bundle schema version")?;
    Ok(Release { schema, commit })
}

pub fn retain(source: &Path, destination: &Path) -> Result<()> {
    if destination.exists() {
        ensure!(
            inventory(source)? == inventory(destination)?,
            "this release already exists with different contents; publish a new version. Existing application is unchanged"
        );
        return Ok(());
    }
    let staging = destination.with_extension("staging");
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    copy(source, &staging)?;
    fs::rename(staging, destination)?;
    Ok(())
}

fn inventory(directory: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    fn collect(
        base: &Path,
        directory: &Path,
        files: &mut BTreeMap<PathBuf, Vec<u8>>,
    ) -> Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            ensure!(!kind.is_symlink(), "bundle must not contain symlinks");
            if kind.is_dir() {
                collect(base, &entry.path(), files)?;
            } else {
                ensure!(kind.is_file(), "unsupported bundle entry");
                files.insert(
                    entry.path().strip_prefix(base)?.to_path_buf(),
                    fs::read(entry.path())?,
                );
            }
        }
        Ok(())
    }
    let mut files = BTreeMap::new();
    collect(directory, directory, &mut files)?;
    Ok(files)
}

fn copy(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        ensure!(!kind.is_symlink(), "bundle must not contain symlinks");
        let target = destination.join(entry.file_name());
        if kind.is_dir() {
            copy(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target)?;
        } else {
            anyhow::bail!("unsupported bundle entry");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changed_source_cannot_reuse_release_version() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        fs::create_dir_all(source.join("server")).unwrap();
        fs::write(source.join("server/program.cs"), "original").unwrap();
        let retained = root.path().join("release");
        retain(&source, &retained).unwrap();
        retain(&source, &retained).unwrap();
        fs::write(source.join("server/program.cs"), "changed").unwrap();
        assert!(retain(&source, &retained).is_err());
        assert_eq!(
            fs::read_to_string(retained.join("server/program.cs")).unwrap(),
            "original"
        );
    }
    #[test]
    fn bundle_rejects_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        fs::create_dir(&source).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", source.join("secret")).unwrap();
        assert!(retain(&source, &root.path().join("dest")).is_err());
    }
}
