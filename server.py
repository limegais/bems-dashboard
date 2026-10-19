#!/usr/bin/env python3
"""
BEMS Dashboard Web Server
Serves static dashboard files on port 3001 (configurable via PORT env)
"""
import os
import sys
import http.server
import socketserver

PORT = int(os.getenv("PORT", 3001))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        # Clean terminal logging
        sys.stdout.write(f"[BEMS-Web] {self.address_string()} - {format%args}\n")
        sys.stdout.flush()

def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), QuietHandler) as httpd:
        print(f"[BEMS-Web] Server berjalan di http://0.0.0.0:{PORT} (Directory: {DIRECTORY})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[BEMS-Web] Server dimatikan.")

if __name__ == "__main__":
    main()
