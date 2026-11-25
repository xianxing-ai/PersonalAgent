#!/bin/sh
# Installs only an already built, explicitly qualified release. No account, VM, network rule or secret is created.
set -eu
RELEASE=${1:?absolute built repository release required}
CONFIG=${2:-/etc/personal-agent-cloud-runtime/config.json}
SSH_USER=${3:?the already authorized registered SSH user is required}
case "$RELEASE:$CONFIG" in /*:/*) ;; *) echo "absolute release/config paths required" >&2; exit 1;; esac
case "$RELEASE$CONFIG" in *[!A-Za-z0-9_./-]*) echo "release/config paths must be safe unquoted systemd paths" >&2; exit 1;; esac
RELEASE=$(realpath "$RELEASE")
test -f "$CONFIG"
test -f "$RELEASE/apps/runtime/dist/application.js"
test -f "$RELEASE/packages/contracts/dist/cloud-persistent.js"
test -f "$RELEASE/scripts/remote-runner/cloud-runtime-service.mjs"
id personal-agent-runner >/dev/null 2>&1
if [ "$(id -u "$SSH_USER")" != 0 ]; then
  case " $(id -nG "$SSH_USER") " in *" personal-agent-runner "*) ;; *) echo "registered SSH user lacks the existing runner group; no permissions were changed" >&2; exit 1;; esac
fi
NODE=$(command -v node)
test -n "$NODE"
# The existing registered runner identity is also the private socket identity.
# No automatic download, build, secret generation, lock deletion or database copy occurs.
"$NODE" --input-type=module - "$CONFIG" "$RELEASE" <<'JS'
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const [configPath,release]=process.argv.slice(2),config=JSON.parse(readFileSync(configPath,'utf8'));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:release,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:release,encoding:'utf8'}).trim();
if(dirty||config.version!==1||config.qualification?.sourceRevision!==revision)throw Error('Fixed release qualification differs');
JS
cat > /etc/systemd/system/personal-agent-cloud-runtime.service <<UNIT
[Unit]
Description=PersonalAgent original Runtime for qualified cloud sessions
After=network-online.target

[Service]
Type=simple
User=personal-agent-runner
Group=personal-agent-runner
WorkingDirectory=$RELEASE
Environment=PA_CLOUD_RUNTIME_CONFIG=$CONFIG
EnvironmentFile=/etc/personal-agent-runner/token
RuntimeDirectory=personal-agent-cloud-runtime
RuntimeDirectoryMode=0750
ExecStart=$NODE $RELEASE/scripts/remote-runner/cloud-runtime-service.mjs
Restart=no
NoNewPrivileges=true
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
echo "Service prepared only. Review fixed qualification, secrets, volume and ownership before explicitly starting it."
