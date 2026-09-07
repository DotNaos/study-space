#!/usr/bin/env python3
"""Exercise the real bootstrap with local, synthetic release assets; no host setup."""
import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

INSTALLER = Path(__file__).resolve().parents[2] / "install.sh"


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.release = self.root / "release"
        self.release.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.mock = self.root / "mock"
        self.mock.mkdir()
        self.write_mock("uname", '#!/bin/sh\n[ "$1" = -s ] && echo Linux || echo "${TEST_ARCH:-x86_64}"\n')
        self.write_mock("id", "#!/bin/sh\necho 1000\n")
        self.write_mock("curl", """#!/usr/bin/env python3
import os,sys,shutil
from pathlib import Path
args=sys.argv[1:]
url=next(arg for arg in args if arg.startswith('https://'))
name=url.rsplit('/',1)[1]
source=Path(os.environ['TEST_RELEASE'])/name
try: shutil.copyfile(source,args[args.index('--output')+1])
except FileNotFoundError: sys.exit(22)
""")
        cli = b'#!/bin/sh\nif [ "$1" = --version ]; then echo "study 0.1.0"; exit; fi\nprintf "%s\\n" "$@" > "$TEST_INVOCATION"\nexit "${TEST_SETUP_EXIT:-0}"\n'
        self.archive("study-linux-x86_64.tar.gz", {"bin/study": cli})
        self.archive("study-space-bundle.tar.gz", {"compose.yaml": b"services: {}\n", "release.env": b"STUDY_SCHEMA_VERSION=1\n", "source/Dockerfile": b"FROM scratch\n", "source/.dockerignore": b".git\n", "source/server/app.cs": b"// fixture\n", "source/web/app.ts": b"// fixture\n"})
        (self.release / "VERSION").write_text("0.1.0\n")
        self.checksums()
        self.env = {**os.environ, "PATH": f"{self.mock}:{os.environ['PATH']}",
                    "STUDY_HOME": str(self.root / "state"), "STUDY_BIN_DIR": str(self.bin),
                    "STUDY_RELEASE_BASE": "https://example.test/releases/latest/download",
                    "TEST_RELEASE": str(self.release), "TEST_INVOCATION": str(self.root / "invocation")}

    def tearDown(self):
        self.temp.cleanup()

    def write_mock(self, name, script):
        path = self.mock / name
        path.write_text(script)
        path.chmod(0o755)

    def archive(self, name, files):
        with tarfile.open(self.release / name, "w:gz") as archive:
            for path, content in files.items():
                info = tarfile.TarInfo(path)
                info.size = len(content)
                info.mode = 0o755
                archive.addfile(info, io.BytesIO(content))

    def checksums(self):
        lines = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                 for path in sorted(self.release.glob("*.tar.gz"))]
        (self.release / "SHA256SUMS").write_text("".join(lines))

    def run_installer(self, **env):
        return subprocess.run(["sh", str(INSTALLER)], env={**self.env, **env},
                              text=True, capture_output=True, timeout=20)

    def test_success_and_repeat_preserve_data(self):
        state = self.root / "state"
        state.mkdir()
        (state / "precious-data").write_text("keep")
        for _ in range(2):
            result = self.run_installer()
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.bin / "study").is_file())
        self.assertIn("setup\n--bundle\n", (self.root / "invocation").read_text())
        self.assertEqual((state / "precious-data").read_text(), "keep")
        self.assertFalse(list(state.glob(".install.*")))

    def test_checksum_failure_keeps_existing_cli(self):
        (self.bin / "study").write_text("old-cli")
        (self.release / "study-space-bundle.tar.gz").write_bytes(b"corrupt")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Checksum verification failed", result.stderr)
        self.assertEqual((self.bin / "study").read_text(), "old-cli")
        self.assertFalse((self.root / "invocation").exists())

    def test_setup_failure_rolls_back_cli(self):
        (self.bin / "study").write_text("old-cli")
        result = self.run_installer(TEST_SETUP_EXIT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.bin / "study").read_text(), "old-cli")

    def test_path_traversal_rejected(self):
        self.archive("study-space-bundle.tar.gz", {"../escape": b"bad"})
        self.checksums()
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unsafe archive paths", result.stderr)
        self.assertFalse((self.root / "escape").exists())

    def test_archive_symlink_rejected(self):
        with tarfile.open(self.release / "study-space-bundle.tar.gz", "w:gz") as archive:
            info = tarfile.TarInfo("link")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            archive.addfile(info)
        self.checksums()
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unsupported links", result.stderr)

    def test_unsupported_architecture_fails_before_changes(self):
        result = self.run_installer(TEST_ARCH="aarch64")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "state").exists())

    def test_missing_source_keeps_existing_cli(self):
        (self.bin / "study").write_text("old-cli")
        self.archive("study-space-bundle.tar.gz", {"compose.yaml": b"services: {}\n", "release.env": b"STUDY_SCHEMA_VERSION=1\n"})
        self.checksums()
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("released Dockerfile", result.stderr)
        self.assertEqual((self.bin / "study").read_text(), "old-cli")

    def test_manifest_duplicates_rejected(self):
        manifest = self.release / "SHA256SUMS"
        manifest.write_text(manifest.read_text() * 2)
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unique checksum", result.stderr)

    def test_install_lock_blocks_concurrent_install(self):
        import fcntl
        state = self.root / "state"
        state.mkdir()
        with (state / "installer.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already running", result.stderr)
        self.assertFalse((self.root / "invocation").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
