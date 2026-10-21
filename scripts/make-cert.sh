#!/bin/bash
# Local HTTPS for the shop Wi-Fi, with nothing to download: a private certificate authority (CA) made
# once with openssl, and a server certificate for this Mac's current address(es) signed by it.
# Phones install the CA once (public/ca.crt → /phone-setup.html); the server cert is re-issued
# automatically by start.sh whenever the Mac's IP changes.
set -e
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
CERTS="$APP_DIR/certs"; mkdir -p "$CERTS"; chmod 700 "$CERTS"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"
HOST="$(scutil --get LocalHostName 2>/dev/null | tr 'A-Z' 'a-z').local"

if [ ! -f "$CERTS/ca.key" ]; then
  echo "Creating the shop's private certificate authority (one time)…"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$CERTS/ca.key" -out "$CERTS/ca.crt" \
    -subj "/CN=Paper & Pixels Shop CA/O=Paper & Pixels" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
  chmod 600 "$CERTS/ca.key"
fi

SAN="IP:$IP,IP:127.0.0.1,DNS:localhost,DNS:$HOST"
# Re-issue only when the addresses changed (or no server cert yet).
if [ -f "$CERTS/server.san" ] && [ "$(cat "$CERTS/server.san")" = "$SAN" ] && [ -f "$CERTS/server.crt" ]; then exit 0; fi
echo "Issuing the app's HTTPS certificate for $IP and $HOST…"
openssl req -newkey rsa:2048 -sha256 -nodes -keyout "$CERTS/server.key" -out "$CERTS/server.csr" \
  -subj "/CN=Paper & Pixels app" >/dev/null 2>&1
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$SAN" > "$CERTS/server.ext"
openssl x509 -req -sha256 -days 825 -in "$CERTS/server.csr" -CA "$CERTS/ca.crt" -CAkey "$CERTS/ca.key" -CAcreateserial \
  -out "$CERTS/server.crt" -extfile "$CERTS/server.ext" >/dev/null 2>&1
echo "$SAN" > "$CERTS/server.san"; chmod 600 "$CERTS/server.key"
cp "$CERTS/ca.crt" "$APP_DIR/public/ca.crt"
echo "HTTPS certificate ready: https://$IP:3443  and  https://$HOST:3443"
