#!/bin/sh
# certbot deploy hook: copy the issued certificate for coturn (uid 65534).
set -eu
src=/etc/letsencrypt/live/coturn.princerehman.com
cp "$src/fullchain.pem" /out/fullchain.pem.new
cp "$src/privkey.pem" /out/privkey.pem.new
chown 65534:65534 /out/fullchain.pem.new /out/privkey.pem.new
chmod 644 /out/fullchain.pem.new
chmod 600 /out/privkey.pem.new
mv /out/fullchain.pem.new /out/fullchain.pem
mv /out/privkey.pem.new /out/privkey.pem
