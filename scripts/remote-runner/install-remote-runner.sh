#!/bin/sh
# Idempotent installer for a fresh Ubuntu, Debian or openEuler host.
# It prepares a headless job executor. It does not open extra inbound ports.
set -eu
VERSION=1.2.0
# Keep these pins aligned with .node-version and the root CI npm pin.
NODE_VERSION=24.15.0
NPM_VERSION=11.12.1
PATH=/usr/local/bin:$PATH
export PATH
PREFIX=/opt/personal-agent-runner
STATE=/var/lib/personal-agent-runner
ENV_FILE=/etc/personal-agent-runner/token
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|aarch64|arm64) ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
mkdir -p /etc/personal-agent-runner
if [ ! -f /etc/personal-agent-runner/model-command.json ]; then
  cat > /etc/personal-agent-runner/model-command.json <<'JSON'
{"command":[],"timeoutMs":120000}
JSON
  chmod 644 /etc/personal-agent-runner/model-command.json
fi
if [ -f "$PREFIX/VERSION" ] && [ "$(cat "$PREFIX/VERSION")" = "$VERSION" ] \
  && [ -x /usr/local/bin/node ] && [ "$(/usr/local/bin/node --version)" = "v$NODE_VERSION" ] \
  && [ -x /usr/local/bin/npm ] && [ "$(/usr/local/bin/npm --version)" = "$NPM_VERSION" ]; then
  node "$PREFIX/remote-runner-service.mjs" --verify
  exit 0
fi
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl xz-utils
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ca-certificates curl xz
elif command -v yum >/dev/null 2>&1; then
  yum install -y ca-certificates curl xz
else
  echo "install curl and xz, then re-run" >&2
  exit 1
fi
NODE_ARCH=$ARCH
if [ "$ARCH" = "x86_64" ]; then NODE_ARCH=x64; fi
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then NODE_ARCH=arm64; fi
if [ ! -x /usr/local/bin/node ] || [ "$(/usr/local/bin/node --version)" != "v$NODE_VERSION" ]; then
  TMP=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz" -o "$TMP/node.tar.xz"
  tar -xJf "$TMP/node.tar.xz" -C /usr/local --strip-components=1
  rm -rf "$TMP"
fi
if [ "$(/usr/local/bin/npm --version)" != "$NPM_VERSION" ]; then
  /usr/local/bin/npm install --global --prefix /usr/local "npm@$NPM_VERSION"
fi
mkdir -p "$PREFIX" "$STATE" "$(dirname "$ENV_FILE")"
if [ ! -f /etc/personal-agent-runner/model-command.json ]; then
  cat > /etc/personal-agent-runner/model-command.json <<'JSON'
{"command":[],"timeoutMs":120000}
JSON
  chmod 644 /etc/personal-agent-runner/model-command.json
fi
cp "$SCRIPT_DIR/remote-runner-service.mjs" "$PREFIX/remote-runner-service.mjs"
cp "$SCRIPT_DIR/local-repo-executor.mjs" "$PREFIX/local-repo-executor.mjs"
cp "$SCRIPT_DIR/cloud-runtime-transport.mjs" "$PREFIX/cloud-runtime-transport.mjs"
chmod 755 "$PREFIX/remote-runner-service.mjs"
printf '%s\n' "$VERSION" > "$PREFIX/VERSION"
if ! id personal-agent-runner >/dev/null 2>&1; then
  useradd --system --home "$STATE" --shell /usr/sbin/nologin personal-agent-runner
fi
chown -R personal-agent-runner:personal-agent-runner "$STATE"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  printf 'RUNNER_TOKEN=%s\n' "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")" > "$ENV_FILE"
  chown root:personal-agent-runner "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi
cat > /etc/systemd/system/personal-agent-runner.service <<'UNIT'
[Unit]
Description=PersonalAgent remote job executor
After=network-online.target

[Service]
Type=simple
User=personal-agent-runner
EnvironmentFile=/etc/personal-agent-runner/token
Environment=RUNNER_STATE=/var/lib/personal-agent-runner/state.json
ExecStart=/usr/local/bin/node /opt/personal-agent-runner/remote-runner-service.mjs --serve
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable personal-agent-runner.service
  systemctl restart personal-agent-runner.service || true
fi
if [ -d /etc/logrotate.d ]; then
  cat > /etc/logrotate.d/personal-agent-runner <<'ROTATE'
/var/log/personal-agent-runner.log {
  weekly
  rotate 4
  missingok
  notifempty
  compress
  copytruncate
}
ROTATE
fi
echo "SSH is the only required inbound port. Do not publish the runner state directory."
echo "Huawei ECS security group: allow tcp/22 from your address. Leave other inbound ports closed."
node "$PREFIX/remote-runner-service.mjs" --verify
