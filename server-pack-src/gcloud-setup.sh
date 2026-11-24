#!/bin/bash
# Magic Garden Shop Alarm - sets up, and on every boot starts, the website's engine on a small Linux server
# (made for a Google Cloud e2-micro running Debian 12; it's the server's startup script).
#  - the engine: the Shop Alarm app in --server mode (the shop watcher + /api/...), on a virtual screen (Xvfb)
#  - Caddy: gives it a fixed https address, https://<server-ip-with-dashes>.sslip.io/, with a free certificate
# The app is fetched fresh from GitHub on each boot, so restarting the server picks up updates.
# Log: /var/log/shop-alarm-setup.log    Address: /etc/shop-alarm-address
set -u
exec >>/var/log/shop-alarm-setup.log 2>&1
echo "=== $(date -u) start"
APP=/opt/shop-alarm
REPO_TARBALL=https://github.com/raidar23/shop-alarm/archive/refs/heads/main.tar.gz
ELECTRON_VERSION=44.11.3

# 1. some room to breathe: the server has 1 GB of memory, so add 2 GB of swap (once)
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2. what Electron needs to run without a real screen (once)
if [ ! -f /var/lib/shop-alarm-packages ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y xvfb xauth curl ca-certificates unzip fonts-liberation \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libasound2 \
    libxss1 libxshmfence1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxtst6 libx11-xcb1 \
    libpango-1.0-0 libcairo2 && touch /var/lib/shop-alarm-packages
fi

# 3. the app, fresh from GitHub
mkdir -p "$APP"
curl -fsSL "$REPO_TARBALL" | tar -xz -C "$APP" --strip-components=1 || echo "couldn't fetch the app; using the copy already here"

# 4. Electron, which runs it (once)
if [ ! -x "$APP/runtime/electron" ]; then
  curl -fsSL -o /tmp/electron.zip "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-x64.zip" \
    && mkdir -p "$APP/runtime" && unzip -oq /tmp/electron.zip -d "$APP/runtime" && rm -f /tmp/electron.zip
fi

# 5. Caddy, for https (once), and its address from this server's public IP
if [ ! -x /usr/local/bin/caddy ]; then
  curl -fsSL -o /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64" && chmod +x /usr/local/bin/caddy
fi
IP=$(curl -fsS -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
HOST="${IP//./-}.sslip.io"
mkdir -p /etc/caddy /var/lib/caddy
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  reverse_proxy 127.0.0.1:8787 {
    flush_interval -1
  }
}
EOF
echo "https://$HOST/" > /etc/shop-alarm-address

# 6. keep both running (and restart them if they ever stop)
cat > /etc/systemd/system/shop-alarm.service <<EOF
[Unit]
Description=Magic Garden Shop Alarm engine
After=network-online.target
Wants=network-online.target
[Service]
Environment=MG_WEB_PORT=8787
ExecStart=/usr/bin/xvfb-run -a -s "-screen 0 1280x720x24" $APP/runtime/electron $APP --server --no-sandbox --disable-dev-shm-usage --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader
Restart=always
RestartSec=15
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/caddy.service <<EOF
[Unit]
Description=Caddy (https for the Shop Alarm engine)
After=network-online.target
Wants=network-online.target
[Service]
Environment=HOME=/var/lib/caddy XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable shop-alarm caddy
systemctl restart shop-alarm caddy
echo "=== $(date -u) done: https://$HOST/"
