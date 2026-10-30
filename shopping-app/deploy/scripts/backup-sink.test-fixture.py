"""Disposable, private HTTPS object-store fixture. Never a real backup service."""
import hmac
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OBJECTS = {}
TOKEN = Path('/run/secrets/backup_token').read_text().strip()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def authenticated(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            self.send_error(401)
            return False
        return True

    def do_PUT(self):
        if not self.authenticated():
            return
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= 16 * 1024 * 1024:
            self.send_error(413)
            return
        OBJECTS[self.path] = self.rfile.read(size)
        self.send_response(201)
        self.end_headers()

    def do_GET(self):
        if not self.authenticated():
            return
        if self.path not in OBJECTS:
            self.send_error(404)
            return
        value = OBJECTS[self.path]
        self.send_response(200)
        self.send_header('Content-Length', str(len(value)))
        self.end_headers()
        self.wfile.write(value)

context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.minimum_version = ssl.TLSVersion.TLSv1_2
context.load_cert_chain('/run/secrets/tls_cert', '/run/secrets/tls_key')
server = ThreadingHTTPServer(('0.0.0.0', 8443), Handler)
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
