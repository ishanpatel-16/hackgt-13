#!/usr/bin/env bash
# Makes a self-signed HTTPS certificate for the nodes' web page (needed for GPS).
# Writes data/cert.pem + data/key.pem; then run `pio run -e nodeX -t uploadfs`.
# ECDSA P-256 because the ESP32 does the TLS handshake much faster than with RSA.
set -euo pipefail
cd "$(dirname "$0")/.."
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -days 825 -subj "/CN=net0" \
  -addext "subjectAltName=IP:192.168.4.1,DNS:net0.local" \
  -keyout data/key.pem -out data/cert.pem
echo "Wrote data/cert.pem and data/key.pem"
