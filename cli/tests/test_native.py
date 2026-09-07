#!/usr/bin/env python3
"""Black-box API tests for the built native executable using a local fake service."""
import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

BINARY = os.environ.get("STUDY_TEST_BINARY", str(Path(__file__).resolve().parents[1] / "target/release/study"))


class Handler(http.server.BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.seen.append((self.command, self.path, self.headers.get("Origin"), None))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"status": "disconnected"}).encode())

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.seen.append((self.command, self.path, self.headers.get("Origin"), body))
        bad = body["siteUrl"] == "https://invalid.example"
        self.send_response(400 if bad else 200)
        self.end_headers()
        self.wfile.write(json.dumps({"title": "Site unavailable", "detail": "Check the address."} if bad else {"methods": ["qr"]}).encode())


class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        (self.home / "installation.json").write_text(json.dumps({"version": "0.1.0", "schema_version": 1,
            "public_url": "https://study.os-pc.vpn.os-home.net", "port": self.server.server_port,
            "release_base": "https://example.test/releases/latest/download"}))

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, *args):
        return subprocess.run([BINARY, "--home", str(self.home), *args], text=True, capture_output=True, timeout=10)

    def test_moodle_status_uses_local_api(self):
        result = self.run_cli("moodle", "status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "disconnected")
        self.assertEqual(Handler.seen[-1][1], "/api/providers/moodle")

    def test_discover_passes_origin_and_json(self):
        result = self.run_cli("moodle", "discover", "https://moodle.example")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Handler.seen[-1], ("POST", "/api/providers/moodle/discover",
            "https://study.os-pc.vpn.os-home.net", {"siteUrl": "https://moodle.example"}))

    def test_error_is_actionable(self):
        result = self.run_cli("moodle", "discover", "https://invalid.example")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Site unavailable: Check the address.", result.stderr)

    def test_missing_installation_does_not_crash(self):
        (self.home / "installation.json").unlink()
        result = self.run_cli("status")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("run the README installer first", result.stderr)

    def test_connect_points_to_web_login(self):
        result = self.run_cli("moodle", "connect")
        self.assertEqual(result.returncode, 0)
        self.assertIn("https://study.os-pc.vpn.os-home.net", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
