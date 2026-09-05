#!/usr/bin/env python3
import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

KINOBOX_REMOTE = 'https://api.kinobox.tv/api/players'
DEFAULT_PORT = 8080
MAX_AUTO_PORT = 8129
PROBE_TIMEOUT = 0.4
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0'
PROBE_UA = 'kinolink-probe/1.0'

APP_NAME = 'kinolink'
APP_VERSION = '0.7.1'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KP_CACHE_FILE = os.path.join(BASE_DIR, '.kp-info-cache.json')
SERVER_INFO_FILE = os.path.join(BASE_DIR, '.kinolink-server.json')
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


def _lan_ipv4():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(('8.8.8.8', 80))
            ip = sock.getsockname()[0]
        finally:
            sock.close()
        if ip and not ip.startswith('127.'):
            return ip
    except Exception:
        pass
    return None


def _announce_mdns(port):
    procs = []
    try:
        host_addr = _lan_ipv4()
        if host_addr:
            procs.append(subprocess.Popen(
                ['/usr/bin/avahi-publish-address', '-R', 'kinolink.local', host_addr],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ))
        procs.append(subprocess.Popen(
            ['/usr/bin/avahi-publish-service', 'kinolink', '_http._tcp', str(port)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ))
    except Exception:
        pass
    return procs or None


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
        if not self.path.startswith('/api/kinobox') and not self.path.startswith('/cover'):
            self.send_header('Cache-Control', 'no-store, max-age=0')

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
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
        if self.path.startswith('/api/kinobox'):
            self._kinobox_proxy()
            return
        if self.path.startswith('/api/kp-info'):
            self._kp_info_get()
            return
        if self.path.startswith('/pair'):
            self._pair_page()
            return
        if self.path.startswith('/cover'):
            self._cover_proxy()
            return
        super().do_GET()

    def _pair_page(self):
        base_url = f'http://{self.headers.get("Host", "127.0.0.1:8080")}/'
        kp_url = 'https://www.kinopoisk.ru/?kinolink-pair=' + urllib.parse.quote(base_url, safe='')
        body = f'''<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KinoLink — настройка</title>
<style>
body{{margin:0;font-family:system-ui,sans-serif;background:#0b0b0f;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}}
.card{{max-width:380px;width:100%;margin:24px;padding:24px;background:#18181b;border:1px solid #3f3f46;border-radius:14px;text-align:center}}
h1{{font-size:18px;margin:0 0 12px}}
p{{font-size:13px;color:#a1a1aa;line-height:1.5;margin:0 0 16px}}
code{{display:block;font-size:13px;color:#7dd3fc;word-break:break-all;margin-bottom:16px}}
a.btn{{display:block;padding:12px;border-radius:10px;text-decoration:none;color:#fff;font-weight:600;background:linear-gradient(45deg,#2b0a45,#000)}}
.small{{font-size:12px;color:#52525b;margin-top:12px}}
</style></head><body><div class="card">
<h1>KinoLink</h1>
<p>Сейчас браузер настроит адрес сервера на этой странице Кинопоиска. Если переход не произошёл — нажмите кнопку.</p>
<code>{base_url}</code>
<a class="btn" href="{kp_url}">Настроить на этом устройстве</a>
<div class="small">Откроется Кинопоиск — ничего вводить не нужно</div>
</div>
<script>setTimeout(function(){{location.href={json.dumps(kp_url)};}},600);</script>
</body></html>'''.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='KinoLink by VOID — локальный сервер плеера.',
        epilog=f'Если порт {DEFAULT_PORT} занят, автоматически выбирается следующий свободный порт (до {MAX_AUTO_PORT}).',
    )
    parser.add_argument('--port', type=int, metavar='PORT', default=None,
                        help='использовать конкретный порт вместо автоматического выбора')
    parser.add_argument('--host', metavar='HOST', default=None,
                        help='адрес интерфейса для прослушивания (по умолчанию 127.0.0.1)')
    parser.add_argument('--global', dest='global_bind', action='store_true',
                        help='слушать на всех интерфейсах (0.0.0.0)')
    args = parser.parse_args(argv)

    if args.port is not None and not 0 < args.port < 65536:
        parser.error('port должен быть в диапазоне 1–65535')

    host = '0.0.0.0' if args.global_bind else (args.host or '127.0.0.1')

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

    mdns_proc = _announce_mdns(port)

    if bind_host in ('0.0.0.0', '::'):
        print(f'KinoLink server on http://{bind_host}:{port} (локально: http://127.0.0.1:{port})', flush=True)
        lan_ip = _lan_ipv4()
        if lan_ip:
            print(f'Локальная сеть: http://{lan_ip}:{port}  (mDNS: http://kinolink.local:{port})', flush=True)
        print('Внимание: сервер доступен из локальной сети.', flush=True)
    else:
        print(f'KinoLink server on http://{bind_host}:{port}', flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        _remove_server_info()
        if mdns_proc:
            for proc in mdns_proc:
                try:
                    proc.terminate()
                except Exception:
                    pass
    return 0


if __name__ == '__main__':
    sys.exit(main())