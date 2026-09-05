#!/usr/bin/env python3
import json
import os
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

KINOBOX_REMOTE = 'https://api.kinobox.tv/api/players'
PORT = 8080
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0'

KP_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.kp-info-cache.json')
MAX_CACHE_SIZE = 1024 * 1024


def _load_kp_cache():
    try:
        with open(KP_CACHE_FILE, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_kp_cache(data):
    try:
        with open(KP_CACHE_FILE, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False)
    except Exception:
        pass


class Handler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        super().send_response(code, message)
        if not self.path.startswith('/api/kinobox') and not self.path.startswith('/cover'):
            self.send_header('Cache-Control', 'no-store, max-age=0')

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/kinobox'):
            self._kinobox_proxy()
            return
        if self.path.startswith('/api/kp-info'):
            self._kp_info_get()
            return
        if self.path.startswith('/cover'):
            self._cover_proxy()
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/kp-info'):
            self._kp_info_post()
            return
        self.send_response(404)
        self.end_headers()

    def _kp_info_get(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        movie_id = (params.get('id') or [''])[0]
        if not movie_id:
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error":"missing id"}')
            return
        data = _load_kp_cache().get(movie_id)
        body = json.dumps(data if isinstance(data, dict) else {}).encode('utf-8')
        self.send_response(200)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _kp_info_post(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        movie_id = (params.get('id') or [''])[0]
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if length > 128 * 1024:
                raise ValueError('payload too large')
            payload = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
        except Exception:
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error":"bad payload"}')
            return

        if not movie_id or not isinstance(payload, dict):
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error":"missing id or payload"}')
            return

        data = _load_kp_cache()
        data[movie_id] = payload
        if os.path.exists(KP_CACHE_FILE) and os.path.getsize(KP_CACHE_FILE) > MAX_CACHE_SIZE:
            items = list(data.items())[-500:]
            data = dict(items)
        _save_kp_cache(data)

        self.send_response(200)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def _cover_proxy(self):
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
        except Exception:
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
        except Exception as exc:
            body = json.dumps({'error': str(exc)}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'KinoLink server on http://127.0.0.1:{PORT}')
    server.serve_forever()