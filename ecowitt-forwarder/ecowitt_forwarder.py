#!/usr/bin/env python3
"""
Ecowitt Forwarder Service - v2
Handles BOTH GET (query params) and POST (form body) from Ecowitt HP2564BU Pro
Forwards to Home Assistant webhook endpoint.
"""

import http.server
import urllib.request
import urllib.parse
import logging
import sys

HA_WEBHOOK = "http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326"
LISTEN_PORT = 4003

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ecowitt-fwd] %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger(__name__)


def forward_to_ha(fields_dict, raw_body=None):
    """Forward data to HA webhook as POST with URL-encoded form body."""
    if raw_body is None:
        raw_body = urllib.parse.urlencode(fields_dict).encode()
    
    solar = fields_dict.get("solarradiation", fields_dict.get("solar_radiation", "?"))
    uv    = fields_dict.get("uv", fields_dict.get("uvindex", "?"))
    tempf = fields_dict.get("tempf", "?")
    rain  = fields_dict.get("rainratein", "?")
    passkey = fields_dict.get("PASSKEY", fields_dict.get("passkey", "?"))
    log.info(f"solar={solar}W/m² UV={uv} temp={tempf}°F rain={rain}in/h PASSKEY={passkey[:8]}...")
    
    try:
        req = urllib.request.Request(
            HA_WEBHOOK,
            data=raw_body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            log.info(f"HA webhook response: HTTP {resp.status}")
            return True
    except Exception as e:
        log.error(f"Failed to forward to HA: {e}")
        return False


class EcowittHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # suppress default access log

    def do_GET(self):
        """Ecowitt may send GET with query string parameters"""
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ecowitt-forwarder OK\n")
            return

        log.info(f"GET {self.path}")
        # Parse query params from path
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/api/ecowitt", "/api/ecowitt/", "/report", "/"):
            fields = dict(urllib.parse.parse_qsl(parsed.query))
            if fields:
                log.info(f"Ecowitt GET push → {len(fields)} fields")
                forward_to_ha(fields)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"OK")
            else:
                log.warning(f"GET with no query params: {self.path}")
                self.send_response(200)
                self.end_headers()
        else:
            log.warning(f"Unknown GET path: {self.path}")
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        """Ecowitt may also send POST with form body"""
        log.info(f"POST {self.path}")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        if self.path in ("/api/ecowitt", "/api/ecowitt/", "/report", "/"):
            fields = dict(urllib.parse.parse_qsl(body.decode(errors="replace")))
            if fields:
                log.info(f"Ecowitt POST push → {len(fields)} fields")
                forward_to_ha(fields, raw_body=body)
                self.send_response(200)
            else:
                log.warning(f"POST with empty body: {self.path}")
                self.send_response(200)
        else:
            log.warning(f"Unknown POST path: {self.path} body={body[:100]}")
            self.send_response(404)
        self.end_headers()


if __name__ == "__main__":
    log.info(f"Ecowitt forwarder v2 starting on port {LISTEN_PORT}")
    log.info(f"Handles GET and POST at /api/ecowitt, /report, /")
    log.info(f"Forwarding to: {HA_WEBHOOK}")
    server = http.server.HTTPServer(("0.0.0.0", LISTEN_PORT), EcowittHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Stopped")
