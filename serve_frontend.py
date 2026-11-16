"""Static file server for the frontend with no-store caching.

Ensures every browser reload fetches the latest files (no stale UI).
Usage: python serve_frontend.py [port]
"""
import functools
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    handler = functools.partial(NoCacheHandler, directory="frontend")
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"Serving ./frontend at http://localhost:{PORT} (no-cache)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
