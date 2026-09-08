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
        code, body = 200, {"status": "disconnected"}
        if self.path == "/api/providers/moodle/courses":
            body = [{"id": 42, "name": "Algebra 1", "shortName": "ALG1", "summary": "Linear equations"}]
        elif self.path == "/api/providers/moodle/courses/42/contents":
            body = [{"id": 7, "name": "Week 1", "summary": "Introduction", "modules": [
                {"id": 15, "name": "Practice", "type": "resource", "url": "https://moodle.example/mod/resource/view.php?id=15",
                 "description": "", "resources": [{"type": "file", "name": "Übung 1.pdf", "mimeType": "application/pdf",
                     "size": 2048, "modifiedAt": 1700000000, "url": "https://moodle.example/pluginfile.php/15/exercise.pdf"}]}]}]
        elif self.path == "/api/providers/moodle/courses/43/contents":
            body = []
        elif self.path == "/api/providers/moodle/courses/999/contents":
            code, body = 404, {"title": "Course unavailable", "detail": "This course is not available in your Moodle course list."}
        self.send_response(code)
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_PUT(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.seen.append((self.command, self.path, self.headers.get("Origin"), body))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"moodle": {"siteUrl": body["moodle"]["siteUrl"].rstrip("/")}}).encode())

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        body = json.loads(raw) if raw else None
        self.seen.append((self.command, self.path, self.headers.get("Origin"), body))
        if self.path.startswith(("/api/materials/", "/api/learning/")):
            self.send_response(202)
            self.end_headers()
            self.wfile.write(json.dumps({"job": {"status": "queued"}}).encode())
            return
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

    def test_lists_enrolled_courses(self):
        result = self.run_cli("moodle", "courses")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [{"id": 42, "name": "Algebra 1", "shortName": "ALG1", "summary": "Linear equations"}])
        self.assertEqual(Handler.seen[-1][1], "/api/providers/moodle/courses")

    def test_reads_course_materials(self):
        result = self.run_cli("moodle", "course", "42")
        self.assertEqual(result.returncode, 0, result.stderr)
        section = json.loads(result.stdout)[0]
        self.assertEqual(section["name"], "Week 1")
        self.assertEqual(section["modules"][0]["resources"][0]["name"], "Übung 1.pdf")
        self.assertEqual(Handler.seen[-1][1], "/api/providers/moodle/courses/42/contents")

    def test_empty_course_is_valid(self):
        result = self.run_cli("moodle", "course", "43")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [])

    def test_unavailable_course_has_clear_error(self):
        result = self.run_cli("moodle", "course", "999")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("This course is not available in your Moodle course list.", result.stderr)

    def test_invalid_course_identifier_never_reaches_api(self):
        before = len(Handler.seen)
        for value in ["0", "-1", "../42", "not-a-number", "9223372036854775808"]:
            result = self.run_cli("moodle", "course", value)
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(Handler.seen), before)

    def test_set_site_writes_project_configuration(self):
        result = self.run_cli("moodle", "set-site", "https://moodle.example/school/")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Handler.seen[-1], ("PUT", "/api/config", "https://study.os-pc.vpn.os-home.net",
            {"moodle": {"siteUrl": "https://moodle.example/school/"}}))
        self.assertEqual(json.loads(result.stdout), {"moodle": {"siteUrl": "https://moodle.example/school"}})

    def test_connect_points_to_web_login(self):
        result = self.run_cli("moodle", "connect")
        self.assertEqual(result.returncode, 0)
        self.assertIn("https://study.os-pc.vpn.os-home.net", result.stdout)

    def test_learning_prepare_only_enqueues_local_import(self):
        result = self.run_cli("learning", "prepare", "42")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["job"]["status"], "queued")
        self.assertEqual(Handler.seen[-1], ("POST", "/api/materials/courses/42/import", "https://study.os-pc.vpn.os-home.net", None))

    def test_generation_requires_explicit_transmission_flag_and_valid_snapshot(self):
        before = len(Handler.seen)
        result = self.run_cli("learning", "generate", "42", "--snapshot", "a" * 64)
        self.assertNotEqual(result.returncode, 0)
        result = self.run_cli("learning", "generate", "42", "--snapshot", "../secret", "--send-to-codex")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(Handler.seen), before)
        result = self.run_cli("learning", "generate", "42", "--snapshot", "a" * 64, "--send-to-codex", "--allow-partial")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Handler.seen[-1][3], {"snapshotId": "a" * 64, "consentToCodex": True, "allowPartial": True})

    def test_codex_connect_does_not_start_login_or_read_credentials(self):
        before = len(Handler.seen)
        result = self.run_cli("codex", "connect")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("https://study.os-pc.vpn.os-home.net/sources", result.stdout)
        self.assertEqual(len(Handler.seen), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
