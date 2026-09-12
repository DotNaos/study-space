#!/usr/bin/env python3
"""Upload a generated/local course image to Study Space without changing Moodle."""
import argparse
import json
import mimetypes
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

LIMIT = 4 * 1024 * 1024

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("course_id", type=int)
    parser.add_argument("image", nargs="?", type=Path)
    parser.add_argument("--base-url", required=True, help="This Study Space installation, e.g. https://study.example.test")
    parser.add_argument("--reset", action="store_true", help="Restore the upstream course image or missing-image fallback")
    args = parser.parse_args()
    url = urlsplit(args.base_url)
    if args.course_id <= 0 or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        parser.error("Use a positive course ID and a bare Study Space origin.")
    if url.scheme != "https" and not (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1")):
        parser.error("Use HTTPS, or HTTP on loopback only.")
    if bool(args.image) == args.reset:
        parser.error("Provide either an image file or --reset.")
    headers = {"Origin": args.base_url.rstrip("/")} if url.scheme == "https" else {}
    data = None
    if args.image:
        mime = mimetypes.guess_type(args.image.name)[0]
        if mime not in ("image/png", "image/jpeg", "image/webp"):
            parser.error("The image must be PNG, JPEG or WebP.")
        with args.image.open("rb") as image:
            data = image.read(LIMIT + 1)
        if len(data) > LIMIT:
            parser.error("The image exceeds 4 MiB.")
        headers["Content-Type"] = mime
    request = Request(f"{args.base_url.rstrip('/')}/api/providers/moodle/courses/{args.course_id}/artwork",
                      data=data, headers=headers, method="DELETE" if args.reset else "PUT")
    try:
        with build_opener(NoRedirect).open(request, timeout=30) as response:
            course = json.load(response)
    except HTTPError as error:
        print(f"Study Space returned HTTP {error.code}. The image was not confirmed saved.", file=sys.stderr)
        return 1
    except URLError as error:
        print(f"Study Space is unreachable: {error.reason}", file=sys.stderr)
        return 1
    if course.get("id") != args.course_id or not isinstance(course.get("hasCustomImage"), bool):
        print("Study Space did not confirm this course image update.", file=sys.stderr)
        return 1
    print(json.dumps({key: course.get(key) for key in ("id", "name", "hasCustomImage", "imageVersion")}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except OSError as error:
        print(f"Cannot read image: {error}", file=sys.stderr)
        raise SystemExit(1)
