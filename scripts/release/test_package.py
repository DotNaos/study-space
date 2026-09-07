#!/usr/bin/env python3
"""Verify release packaging uses its selected commit, not dirty/generated files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

PACKAGE = Path(__file__).with_name("package.sh").resolve()


class ReleaseSourceTests(unittest.TestCase):
    def test_bundle_is_from_selected_commit(self):
        with tempfile.TemporaryDirectory(prefix="study-release-test-") as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

            git("init", "-q")
            git("config", "user.email", "release-fixture@example.invalid")
            git("config", "user.name", "Release fixture")
            committed = {
                "Dockerfile": "FROM scratch\nCOPY web/source.txt /source.txt\n",
                ".dockerignore": "**/dist\n**/bin\n",
                "server/source.txt": "committed server\n",
                "web/source.txt": "committed web\n",
                "web/bun.lock": "committed lock\n",
                "compose.yaml": "services:\n  app:\n    build: ./source\n",
                "install.sh": "#!/bin/sh\necho committed installer\n",
                "unrelated.txt": "not an app build input\n",
            }
            for name, content in committed.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            git("add", ".")
            git("commit", "-qm", "Release fixture")
            release_commit = git("rev-parse", "HEAD")

            # A newer checkout, dirty files and local output must not change a
            # bundle requested for the earlier immutable release commit.
            (root / "web/source.txt").write_text("newer committed web\n")
            git("commit", "-qam", "Unreleased change")
            (root / "Dockerfile").write_text("dirty Dockerfile\n")
            (root / "compose.yaml").write_text("dirty compose\n")
            (root / "install.sh").write_text("dirty installer\n")
            for name in ["web/dist/generated.js", "server/bin/generated.dll", "web/.env.local"]:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("untracked fixture must not ship\n")
            binary = root / "cli/target/release/study"
            binary.parent.mkdir(parents=True)
            binary.write_text("#!/bin/sh\necho synthetic-cli\n")
            binary.chmod(0o755)
            output = root / "release output"
            result = subprocess.run(
                ["bash", str(PACKAGE), "0.1.1", release_commit], cwd=root,
                env={**os.environ, "STUDY_ARTIFACTS_DIR": str(output)},
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            with tarfile.open(output / "study-space-bundle.tar.gz") as bundle:
                files = {member.name: bundle.extractfile(member).read().decode()
                         for member in bundle.getmembers() if member.isfile()}
            expected_source = {f"source/{name}": content for name, content in committed.items()
                               if name in {"Dockerfile", ".dockerignore"} or name.startswith(("server/", "web/"))}
            self.assertEqual({name: value for name, value in files.items() if name.startswith("source/")}, expected_source)
            self.assertEqual(files["compose.yaml"], committed["compose.yaml"])
            self.assertEqual((output / "install.sh").read_text(), committed["install.sh"])
            image = f"study-space-local:v0.1.1-{release_commit}"
            self.assertEqual(files["release.env"], f"STUDY_IMAGE={image}\nSTUDY_VERSION=v0.1.1\nSTUDY_COMMIT={release_commit}\nSTUDY_SCHEMA_VERSION=1\n")
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertEqual(manifest, {"version": "0.1.1", "commit": release_commit, "image": image, "schemaVersion": 1})
            self.assertEqual((output / "VERSION").read_text(), "0.1.1\n")
            for line in (output / "SHA256SUMS").read_text().splitlines():
                digest, name = line.split(maxsplit=1)
                self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), digest)
            with tarfile.open(output / "study-linux-x86_64.tar.gz") as cli:
                self.assertEqual(cli.extractfile("bin/study").read(), binary.read_bytes())
                self.assertTrue(cli.getmember("bin/study").mode & 0o111)
            self.assertNotIn("ghcr.io", (output / "manifest.json").read_text())


if __name__ == "__main__":
    unittest.main()
