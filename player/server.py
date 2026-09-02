#!/usr/bin/env python3
"""KinoLink local server: serves the player and proxies Kinobox API.

Run from the player/ directory:
    python3 server.py
"""

import json
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

KINOBOX_REMOTE = 'https://api.kinobox.tv/api/players'
PORT = 8080
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0'


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/kinobox'):
            self._kinobox_proxy()
            return
        if self.path.startswith('/cover'):
            self._cover_proxy()
            return
        super().do_GET()

    def _cover_proxy(self):
        """Fetch a poster image through the local server so strict browser
        privacy settings cannot block cross-origin CDN requests."""
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        target = (params.get('url') or [''])[0]
        scheme = urllib.parse.urlparse(target).scheme.lower()
        if scheme not in ('http', 'https'):
            self._blank()
            return
        try:
            request = urllib.request.Request(target, headers={
                'User-Agent': BROWSER_UA,
                'Accept': 'image/*,*/*;q=0.8',
            })
            with urllib.request.urlopen(request, timeout=12) as response:
                body = response.read()
                content_type = response.headers.get('Content-Type') or 'image/jpeg'
                if not content_type.startswith('image/'):
                    content_type = 'image/jpeg'
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.end_headers()
            self.wfile.write(body)
        except Exception:  # noqa: BLE001
            self._blank()

    def _blank(self):
        self.send_response(404)
        self.send_header('Content-Type', 'image/gif')
        self.send_header('Content-Length', '43')
        self.end_headers()
        self.wfile.write(b'GIF89a\x01\x00\x01\x00\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x01D\x00;')

    def _kinobox_proxy(self):
        try:
            query = urllib.parse.urlparse(self.path).query
            url = KINOBOX_REMOTE + (('?' + query) if query else '')
            request = urllib.request.Request(url, headers={
                'Origin': 'https://tapeop.dev',
                'Referer': 'https://tapeop.dev/',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0',
                'Accept': 'application/json',
            })
            with urllib.request.urlopen(request, timeout=12) as response:
                body = response.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('X-Kinobox-Proxied', '1')
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001
            body = json.dumps({'error': str(exc)}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'KinoLink server on http://127.0.0.1:{PORT}')
    server.serve_forever()