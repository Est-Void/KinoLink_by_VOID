#!/usr/bin/env python3
import argparse
import ipaddress
import json
import os
import signal
import socket
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 8080
MAX_AUTO_PORT = 8129
PROBE_TIMEOUT = 0.4
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0'
PROBE_UA = 'kinolink-probe/1.0'

APP_NAME = 'kinolink'
APP_VERSION = '0.8.1-dev'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KP_CACHE_FILE = os.path.join(BASE_DIR, '.kp-info-cache.json')
SERVER_INFO_FILE = os.path.join(BASE_DIR, '.kinolink-server.json')
MAX_CACHE_SIZE = 1024 * 1024
MAX_COVER_SIZE = 8 * 1024 * 1024
MAX_MOVIE_ID_LENGTH = 20
KP_CACHE_LOCK = threading.Lock()
ALLOWED_CORS_ORIGINS = {'https://www.kinopoisk.ru', 'https://hd.kinopoisk.ru'}


def _load_kp_cache():
    try:
        with open(KP_CACHE_FILE, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_kp_cache(data):
    temporary_path = None
    try:
        fd, temporary_path = tempfile.mkstemp(prefix='.kp-info-cache-', suffix='.tmp', dir=BASE_DIR)
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.replace(temporary_path, KP_CACHE_FILE)
    except Exception:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


def _valid_movie_id(movie_id):
    return movie_id.isdigit() and len(movie_id) <= MAX_MOVIE_ID_LENGTH


def _safe_cover_target(target):
    """Accept only ordinary web URLs; reject local and special network ranges."""
    parsed = urllib.parse.urlparse(target)
    if parsed.scheme.lower() not in ('http', 'https') or not parsed.hostname:
        return False
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
    except (OSError, ValueError):
        return False


def _lan_addresses():
    """Return private IPv4 addresses suitable for connecting from the LAN."""
    addresses = set()
    try:
        for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = item[4][0]
            if ipaddress.ip_address(address).is_private and not ipaddress.ip_address(address).is_loopback:
                addresses.add(address)
    except OSError:
        pass

    # This determines the address selected by the default route without sending data.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(('192.0.2.1', 80))
            address = probe.getsockname()[0]
            if ipaddress.ip_address(address).is_private and not ipaddress.ip_address(address).is_loopback:
                addresses.add(address)
    except OSError:
        pass
    return sorted(addresses, key=lambda address: tuple(map(int, address.split('.'))))


class SafeCoverRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _safe_cover_target(newurl):
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _probe_port(port, host='127.0.0.1', timeout=PROBE_TIMEOUT):
    def _fetch(path):
        request = urllib.request.Request(
            f'http://{host}:{port}{path}',
            headers={'User-Agent': PROBE_UA, 'Accept': '*/*'},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()

    try:
        data = json.loads(_fetch('/api/status').decode('utf-8'))
        if isinstance(data, dict) and data.get('app') == APP_NAME:
            return data
    except Exception:
        pass

    try:
        body = _fetch('/')
    except Exception:
        return None
    if isinstance(body, bytes) and b'KinoLink' in body:
        return {'app': APP_NAME, 'detected': 'root'}
    return None


def _read_server_info():
    try:
        with open(SERVER_INFO_FILE, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
            if isinstance(data, dict) and isinstance(data.get('pid'), int):
                return data
    except Exception:
        pass
    return None


def _write_server_info(info):
    try:
        with open(SERVER_INFO_FILE, 'w', encoding='utf-8') as fh:
            json.dump(info, fh, ensure_ascii=False)
    except Exception:
        pass


def _remove_server_info():
    try:
        os.remove(SERVER_INFO_FILE)
    except OSError:
        pass


def _is_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


class AlreadyRunning(Exception):
    def __init__(self, port, info=None):
        self.port = int(port)
        self.info = info or {}
        self.pid = self.info.get('pid')

    def __str__(self):
        host = '127.0.0.1' if self.info.get('detected') == 'root' else (self.info.get('host') or '127.0.0.1')
        suffix = f' (pid {self.pid})' if self.pid else ''
        return f'http://{host}:{self.port}{suffix}'


def find_running_instance():
    info = _read_server_info()
    if info and _is_alive(info.get('pid')) and _probe_port(int(info.get('port')), info.get('host') or '127.0.0.1'):
        return AlreadyRunning(int(info.get('port')), info)

    found = []
    lock = threading.Lock()
    workers = []

    def check(port):
        data = _probe_port(port)
        if data:
            with lock:
                found.append((int(port), data))

    for port in range(DEFAULT_PORT, MAX_AUTO_PORT + 1):
        worker = threading.Thread(target=check, args=(port,), daemon=True)
        worker.start()
        workers.append(worker)

    for worker in workers:
        worker.join()

    if not found:
        return None
    found.sort(key=lambda item: item[0])
    port, data = found[0]
    return AlreadyRunning(port, data)


def _create_server(host, port):
    family = socket.AF_INET6 if ':' in host else socket.AF_INET
    server_cls = type('KinoLinkServer', (ThreadingHTTPServer,), {'address_family': family})
    return server_cls((host, port), Handler)


def bind_server(host, forced_port):
    if forced_port:
        try:
            return _create_server(host, forced_port)
        except OSError:
            if _probe_port(forced_port):
                raise AlreadyRunning(forced_port)
            raise RuntimeError(f'Порт {forced_port} занят другим приложением')

    for port in range(DEFAULT_PORT, MAX_AUTO_PORT + 1):
        try:
            return _create_server(host, port)
        except OSError:
            if _probe_port(port):
                raise AlreadyRunning(port)
    raise RuntimeError(f'Не удалось найти свободный порт в диапазоне {DEFAULT_PORT}–{MAX_AUTO_PORT}')


class Handler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        super().send_response(code, message)
        if not self.path.startswith('/cover'):
            self.send_header('Cache-Control', 'no-store, max-age=0')

    def _cors_headers(self):
        origin = self.headers.get('Origin')
        if origin in ALLOWED_CORS_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/status'):
            self._api_status()
            return
        if self.path.startswith('/api/kp-info'):
            self._kp_info_get()
            return
        if self.path.startswith('/cover'):
            self._cover_proxy()
            return
        super().do_GET()

    def _api_status(self):
        host, port = self.server.server_address[:2]
        body = json.dumps({
            'app': APP_NAME,
            'version': APP_VERSION,
            'status': 'ok',
            'pid': os.getpid(),
            'host': host,
            'port': port,
        }, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        if not _valid_movie_id(movie_id):
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error":"missing id"}')
            return
        with KP_CACHE_LOCK:
            data = _load_kp_cache().get(movie_id)
        if not isinstance(data, dict) or not data.get('title'):
            data = {}
        body = json.dumps(data).encode('utf-8')
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

        if not _valid_movie_id(movie_id) or not isinstance(payload, dict) or not isinstance(payload.get('title'), str) or not payload['title'].strip():
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error":"missing id, payload or title"}')
            return

        with KP_CACHE_LOCK:
            data = _load_kp_cache()
            data[movie_id] = payload
            if os.path.exists(KP_CACHE_FILE) and os.path.getsize(KP_CACHE_FILE) > MAX_CACHE_SIZE:
                data = dict(list(data.items())[-500:])
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
        if not _safe_cover_target(target):
            self._blank()
            return
        try:
            request = urllib.request.Request(target, headers={
                'User-Agent': BROWSER_UA,
                'Accept': 'image/*,*/*;q=0.8',
            })
            opener = urllib.request.build_opener(SafeCoverRedirectHandler())
            with opener.open(request, timeout=12) as response:
                content_type = (response.headers.get_content_type() or '').lower()
                content_length = response.headers.get('Content-Length')
                if content_type == 'application/octet-stream' or not content_type.startswith('image/'):
                    raise ValueError('response is not an image')
                if content_length and int(content_length) > MAX_COVER_SIZE:
                    raise ValueError('cover is too large')
                body = response.read(MAX_COVER_SIZE + 1)
                if len(body) > MAX_COVER_SIZE:
                    raise ValueError('cover is too large')
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

def main(argv=None):
    parser = argparse.ArgumentParser(
        description='KinoLink by VOID — локальный сервер плеера.',
        epilog=f'Если порт {DEFAULT_PORT} занят, автоматически выбирается следующий свободный порт (до {MAX_AUTO_PORT}).',
    )
    parser.add_argument('--port', type=int, metavar='PORT', default=None,
                        help='использовать конкретный порт вместо автоматического выбора')
    parser.add_argument('--host', metavar='HOST', default=None,
                        help='адрес интерфейса для прослушивания (по умолчанию 127.0.0.1)')
    parser.add_argument('--lan', '--global', dest='lan_bind', action='store_true',
                        help='слушать на всех IPv4-интерфейсах для устройств локальной сети')
    args = parser.parse_args(argv)

    if args.port is not None and not 0 < args.port < 65536:
        parser.error('port должен быть в диапазоне 1–65535')

    if args.lan_bind and args.host:
        parser.error('--lan нельзя использовать одновременно с --host')

    host = '0.0.0.0' if args.lan_bind else (args.host or '127.0.0.1')

    try:
        running = find_running_instance()
        if running:
            raise running
        server = bind_server(host, args.port)
    except AlreadyRunning as exc:
        print(f'KinoLink: процесс уже запущен на {exc}. Используйте этот адрес.', file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f'KinoLink: {exc}', file=sys.stderr)
        return 1

    bind_host, port = server.server_address[:2]

    os.chdir(BASE_DIR)
    _write_server_info({
        'app': APP_NAME,
        'version': APP_VERSION,
        'pid': os.getpid(),
        'host': bind_host,
        'port': port,
    })

    def _on_signal(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    if bind_host in ('0.0.0.0', '::'):
        print(f'KinoLink server on http://{bind_host}:{port} (локально: http://127.0.0.1:{port})', flush=True)
        addresses = _lan_addresses()
        for address in addresses:
            print(f'Сеть: http://{address}:{port}', flush=True)
        print('Внимание: сервер доступен всем устройствам локальной сети. Не используйте --lan в публичной сети.', flush=True)
    else:
        print(f'KinoLink server on http://{bind_host}:{port}', flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        _remove_server_info()
    return 0


if __name__ == '__main__':
    sys.exit(main())
