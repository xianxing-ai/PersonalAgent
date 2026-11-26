#!/bin/sh
# Idempotent installer for PersonalAgent VPS runner + LinuxServer Webtop Ubuntu XFCE cloud desktop.
# Binds the Webtop GUI strictly to 127.0.0.1 (access via SSH tunnel); keeps SSH as the only inbound port.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (for example: sudo sh $0)" >&2
  exit 1
fi

FORCE_CONFIG=0
SSH_USER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE_CONFIG=1 ;;
    --ssh-user)
      shift
      SSH_USER=${1:-}
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
CONTAINER_NAME="personal-agent-webtop"
WEBTOP_IMAGE="lscr.io/linuxserver/webtop:ubuntu-xfce"
WEBTOP_DATA="/var/lib/personal-agent-webtop"
POLICY_FILE="/etc/personal-agent-runner/vps-control.json"

echo "[1/4] Installing personal-agent-runner base service..."
sh "$SCRIPT_DIR/install-remote-runner.sh"

echo "[2/4] Ensuring Docker is installed and running..."
if ! command -v docker >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y docker.io
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y docker
  elif command -v yum >/dev/null 2>&1; then
    yum install -y docker
  else
    echo "Docker is not installed and no supported package manager (apt-get/dnf/yum) was found." >&2
    exit 1
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable docker >/dev/null 2>&1 || true
  systemctl start docker >/dev/null 2>&1 || true
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not responding. Check 'systemctl status docker'." >&2
  exit 1
fi

if id personal-agent-runner >/dev/null 2>&1 && getent group docker >/dev/null 2>&1; then
  usermod -aG docker personal-agent-runner || true
fi

if [ -n "$SSH_USER" ] && id "$SSH_USER" >/dev/null 2>&1; then
  if getent group personal-agent-runner >/dev/null 2>&1; then
    usermod -aG personal-agent-runner "$SSH_USER" || true
  fi
  if getent group docker >/dev/null 2>&1; then
    usermod -aG docker "$SSH_USER" || true
  fi
fi

echo "[3/4] Writing controlled VPS & cloud-desktop policy..."
if [ "$FORCE_CONFIG" -eq 1 ] || [ ! -f "$POLICY_FILE" ]; then
  cat > "$POLICY_FILE" <<'JSON'
{
  "enabled": true,
  "allowExec": true,
  "allowDesktop": true,
  "desktopContainer": "personal-agent-webtop",
  "webtopHttpPort": 3000,
  "webtopHttpsPort": 3001,
  "maxTimeoutMs": 60000,
  "allowedExecutables": [
    "uname", "uptime", "df", "free", "ps", "ls", "cat", "head", "tail", "find",
    "grep", "wc", "pwd", "id", "whoami", "which", "env", "printenv", "date",
    "node", "npm", "python3", "git", "curl", "wget",
    "xdg-open", "xdotool", "scrot", "chromium", "google-chrome", "playwright"
  ]
}
JSON
  chmod 644 "$POLICY_FILE"
fi

echo "[4/4] Deploying Webtop Ubuntu XFCE cloud desktop ($CONTAINER_NAME)..."
mkdir -p "$WEBTOP_DATA"
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker start "$CONTAINER_NAME" >/dev/null
else
  docker pull "$WEBTOP_IMAGE"
  docker run -d \
    --name "$CONTAINER_NAME" \
    --security-opt seccomp=unconfined \
    -e PUID=1000 \
    -e PGID=1000 \
    -e TZ=Asia/Shanghai \
    -p 127.0.0.1:3000:3000 \
    -p 127.0.0.1:3001:3001 \
    -v "$WEBTOP_DATA:/config" \
    --shm-size=1gb \
    --restart unless-stopped \
    "$WEBTOP_IMAGE" >/dev/null
fi

STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")
echo ""
echo "=== PersonalAgent VPS Cloud Desktop Ready ==="
echo "Webtop container : $CONTAINER_NAME ($STATUS)"
echo "Bind addresses   : 127.0.0.1:3000 (HTTP) / 127.0.0.1:3001 (HTTPS)"
echo "Policy file      : $POLICY_FILE"
echo ""
echo "Next steps:"
echo "1. Read your runner token on this VPS (keep it secret!):"
echo "   sudo cat /etc/personal-agent-runner/token"
echo "2. In Windows PersonalAgent -> 'VPS 电脑' -> '添加 VPS / 云电脑':"
echo "   Fill IP, port, SSH user, click '探测主机公钥', paste SSH private key & RUNNER_TOKEN."
echo "3. Open the visual cloud Linux desktop via SSH tunnel on Windows:"
echo "   ssh -N -L 3001:127.0.0.1:3001 <ssh_user>@<VPS_IP>"
echo "   Then visit https://127.0.0.1:3001 in your browser (accept the self-signed cert)."
