#!/usr/bin/env bash
# =====================================================================
# SFTP aislado para transferencias manuales (ftp.muitowork.com)
#
#   bash scripts/mesa-sftp-setup.sh          # instala o repara
#   bash scripts/mesa-sftp-setup.sh --check  # sólo informa; 1 si falta algo
#
# Crea el usuario `mesa-backup`, una jaula en /srv/mesa-backups, una clave
# ed25519 para el cliente y un segundo sshd (`sshd-mesa.service`) en el puerto
# 2223. No toca el sshd principal (2222, sólo root con clave): si este servicio
# falla, el acceso de administración sigue intacto.
#
# El endpoint comparte host y disco con la base: sirve para mover archivos, no
# como copia externa. La copia que sobrevive a la pérdida del VPS es la del
# buzón (`scripts/mesa-offsite.py`).
#
# Requiere root en el host. Idempotente: repetirlo no cambia nada.
# =====================================================================
set -euo pipefail

PORT="${MESA_SFTP_PORT:-2223}"
USER="${MESA_SFTP_USER:-mesa-backup}"
JAIL="${MESA_SFTP_JAIL:-/srv/mesa-backups}"
KEY="${MESA_SFTP_KEY:-/root/.ssh/mesa_sftp_ed25519}"
CONFIG=/etc/ssh/sshd_mesa_config
UNIT=/etc/systemd/system/sshd-mesa.service
MODE=install
[[ "${1:-}" == "--check" ]] && MODE=check
[[ $# -le 1 ]] || { echo "uso: $0 [--check]" >&2; exit 2; }

check() {
  local failures=0
  id "$USER" >/dev/null 2>&1 || { echo "falta el usuario $USER"; failures=$((failures + 1)); }
  [[ -f "$CONFIG" ]] || { echo "falta $CONFIG"; failures=$((failures + 1)); }
  [[ -f "$UNIT" ]] || { echo "falta $UNIT"; failures=$((failures + 1)); }
  [[ -f "$JAIL/.ssh/authorized_keys" ]] || { echo "falta $JAIL/.ssh/authorized_keys"; failures=$((failures + 1)); }
  systemctl is-active --quiet sshd-mesa.service || { echo "sshd-mesa.service no está activo"; failures=$((failures + 1)); }
  ss -lnt "sport = :$PORT" 2>/dev/null | grep -q LISTEN || { echo "nadie escucha en $PORT"; failures=$((failures + 1)); }
  ufw status 2>/dev/null | grep -q "^$PORT/tcp" || { echo "ufw no permite $PORT/tcp"; failures=$((failures + 1)); }
  if (( failures > 0 )); then
    echo "estado: $failures problema(s)"
    return 1
  fi
  echo "estado: ok puerto=$PORT usuario=$USER jaula=$JAIL"
  ssh-keygen -lf "$JAIL/.ssh/authorized_keys" 2>/dev/null | sed 's/^/clave: /'
  return 0
}

if [[ "$MODE" == check ]]; then
  check
  exit $?
fi

echo "== usuario y jaula =="
id "$USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$JAIL" --shell /usr/sbin/nologin "$USER"
install -d -o root -g root -m 755 "$JAIL"
install -d -o "$USER" -g "$USER" -m 700 "$JAIL/incoming"
install -d -o "$USER" -g "$USER" -m 700 "$JAIL/.ssh"

echo "== clave del cliente =="
[[ -f "$KEY" ]] || ssh-keygen -q -t ed25519 -N '' -C "mesa-backup@sftp" -f "$KEY"
install -o "$USER" -g "$USER" -m 600 "$KEY.pub" "$JAIL/.ssh/authorized_keys"
chmod 600 "$KEY"

echo "== configuración del sshd aislado =="
cat >"$CONFIG" <<CONF
# SFTP aislado para copias (ftp.muitowork.com).
# Sólo $USER, sólo SFTP, enjaulado, sin contraseñas ni reenvíos.
Port $PORT
ListenAddress 0.0.0.0
ListenAddress ::
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key
PidFile /run/sshd-mesa.pid
UsePAM yes
AllowUsers $USER
PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitTunnel no
PermitTTY no
PrintMotd no
AcceptEnv LANG LC_*
ChrootDirectory $JAIL
ForceCommand internal-sftp -d /incoming
Subsystem sftp internal-sftp
CONF
chmod 600 "$CONFIG"
sshd -t -f "$CONFIG"

echo "== servicio =="
cat >"$UNIT" <<UNITFILE
[Unit]
Description=SFTP aislado para copias de la Mesa
After=network.target

[Service]
Type=notify
ExecStart=/usr/sbin/sshd -D -f $CONFIG
ExecReload=/bin/kill -HUP \$MAINPID
KillMode=process
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITFILE
systemctl daemon-reload
systemctl enable --quiet sshd-mesa.service
systemctl restart sshd-mesa.service

echo "== firewall =="
ufw allow "$PORT/tcp" >/dev/null

check
