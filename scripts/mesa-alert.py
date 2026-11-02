#!/usr/bin/env python3
"""Aviso por correo cuando el respaldo de la Mesa deja de estar sano.

`backup-mesa.sh` deja su estado en `/opt/mwt/mesa_backup_status.txt`, pero nadie
mira ese archivo. Este cliente corre desde cron, ejecuta
`backup-mesa.sh --check-freshness` y manda un correo cuando el código de salida
no es 0: 1 significa que el último respaldo no sirve y 3 que el local vale pero
una copia externa falló. Cuando vuelve a 0 manda un aviso de recuperación.

Para no inundar el buzón, un fallo con la misma firma se repite como mucho cada
`MESA_ALERT_REPEAT_HOURS`; la firma cambia cuando cambia el motivo.

Uso:

    mesa-alert.py               # evalúa y avisa si hace falta
    mesa-alert.py --dry-run     # dice qué haría, sin enviar
    mesa-alert.py --force       # envía aunque no haya cambio de estado

Configuración: `/etc/mwt/mesa-offsite.env` (mismo archivo que la copia externa).
Lee `MESA_ALERT_TO` (lista separada por comas; por omisión el propio buzón),
`MESA_ALERT_REPEAT_HOURS` y `MESA_ALERT_STATE`. Las credenciales SMTP son las de
`MESA_OFFSITE_USER` / `MESA_OFFSITE_PASS`, por `smtp.hostinger.com:465`.

Los fallos salen con código 1 y `reason=<slug>`; el log nunca lleva la
contraseña ni la respuesta cruda del servidor.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import smtplib
import ssl
import subprocess
import sys
from datetime import datetime, timezone
from email.message import EmailMessage

DEFAULTS = {
    'MESA_OFFSITE_HOST': 'imap.hostinger.com',
    'MESA_ALERT_SMTP_HOST': 'smtp.hostinger.com',
    'MESA_ALERT_SMTP_PORT': '465',
    'MESA_ALERT_REPEAT_HOURS': '12',
    'MESA_ALERT_STATE': '/opt/mwt/mesa_alert_state.txt',
    'MESA_ALERT_CHECK': '/opt/mwt/scripts/backup-mesa.sh',
}


class Failure(Exception):
    """Un fallo esperado, con un slug que sí puede ir al log."""

    def __init__(self, slug: str) -> None:
        super().__init__(slug)
        self.slug = slug


def env(name: str) -> str:
    """Valor de entorno con el valor por omisión de DEFAULTS."""
    return os.environ.get(name, DEFAULTS.get(name, ''))


def load_env_file() -> None:
    """Carga `MESA_ENV_FILE` para las claves que no estén ya en el entorno."""
    path = os.environ.get('MESA_ENV_FILE', '/etc/mwt/mesa-offsite.env')
    try:
        with open(path, encoding='utf-8') as handle:
            lines = handle.readlines()
    except OSError:
        return
    for line in lines:
        entry = line.strip()
        if not entry or entry.startswith('#') or '=' not in entry:
            continue
        key, _, value = entry.partition('=')
        key = key.strip()
        if not re.match(r'^[A-Z_][A-Z0-9_]*$', key) or key in os.environ:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        os.environ[key] = value


def now() -> datetime:
    """Instante actual en UTC."""
    return datetime.now(timezone.utc)


def read_state() -> dict:
    """Estado guardado del aviso; un archivo roto se trata como vacío."""
    try:
        with open(env('MESA_ALERT_STATE'), encoding='utf-8') as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def write_state(state: dict) -> None:
    """Guarda el estado de forma atómica."""
    path = env('MESA_ALERT_STATE')
    partial = f'{path}.part'
    with open(partial, 'w', encoding='utf-8') as handle:
        json.dump(state, handle, ensure_ascii=False)
    os.replace(partial, path)


def check() -> tuple[int, str]:
    """Código y texto de `backup-mesa.sh --check-freshness`."""
    script = env('MESA_ALERT_CHECK')
    if not os.path.exists(script):
        raise Failure('check_script_missing')
    done = subprocess.run(['bash', script, '--check-freshness'], capture_output=True, text=True, check=False)
    text = (done.stdout or done.stderr).strip().splitlines()
    return done.returncode, text[-1] if text else ''


def recipients() -> list[str]:
    """Destinatarios del aviso."""
    raw = env('MESA_ALERT_TO') or env('MESA_OFFSITE_USER')
    return [item.strip() for item in raw.split(',') if item.strip()]


def compose(subject: str, body: str, sender: str) -> EmailMessage:
    """Correo de aviso, sin adjuntos."""
    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = sender
    message['To'] = ', '.join(recipients())
    message['Date'] = datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')
    message.set_content(body)
    return message


def send(subject: str, body: str) -> None:
    """Envía por SMTP con TLS implícito; un fallo es `smtp_failed`."""
    user = env('MESA_OFFSITE_USER')
    password = env('MESA_OFFSITE_PASS')
    if not user or not password:
        raise Failure('credentials_missing')
    message = compose(subject, body, user)
    try:
        with smtplib.SMTP_SSL(
            env('MESA_ALERT_SMTP_HOST'),
            int(env('MESA_ALERT_SMTP_PORT')),
            timeout=30,
            context=ssl.create_default_context(),
        ) as smtp:
            smtp.login(user, password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise Failure('smtp_failed') from error


def summary_lines() -> str:
    """Línea de estado del respaldo, sin secretos."""
    path = os.environ.get('MESA_STATUS_FILE', '/opt/mwt/mesa_backup_status.txt')
    try:
        with open(path, encoding='utf-8') as handle:
            return handle.read().strip()
    except OSError:
        return '(sin archivo de estado)'


def main(argv: list[str]) -> int:
    """Evalúa el respaldo y manda el aviso que corresponda."""
    parser = argparse.ArgumentParser(description='Aviso por correo del estado del respaldo de la Mesa.')
    parser.add_argument('--dry-run', action='store_true', help='dice qué haría, sin enviar')
    parser.add_argument('--force', action='store_true', help='envía aunque no haya cambio de estado')
    args = parser.parse_args(argv)
    load_env_file()

    try:
        code, detail = check()
    except Failure as failure:
        print(f'reason={failure.slug}', file=sys.stderr)
        return 1

    state = read_state()
    stamp = now()
    healthy = code == 0
    signature = f'{code}:{detail}'
    repeat = int(env('MESA_ALERT_REPEAT_HOURS'))
    last = state.get('notified_at', '')
    elapsed_h = 1e9
    if last:
        try:
            elapsed_h = (stamp - datetime.fromisoformat(last)).total_seconds() / 3600
        except ValueError:
            elapsed_h = 1e9

    action = 'none'
    if healthy:
        if state.get('state') == 'fail' or args.force:
            action = 'recovered'
    elif args.force or state.get('signature') != signature or elapsed_h >= repeat:
        action = 'alert'

    if action == 'none':
        print(f'ok state={"ok" if healthy else "fail"} action=none detail={detail}')
        return 0

    if action == 'alert':
        subject = f'Mesa · respaldo con problema (exit {code})'
        body = (
            'El respaldo de faberloom_mesa no está sano.\n\n'
            f'check-freshness: exit {code}\n'
            f'Detalle: {detail}\n\n'
            f'Estado: {summary_lines()}\n\n'
            'Revisar en la VPS:\n'
            '  /opt/mwt/scripts/backup-mesa.sh --check-freshness\n'
            '  /opt/mwt/scripts/mesa-offsite.py check\n'
            '  tail -30 /opt/mwt/logs/mesa_backup.log\n'
        )
    else:
        subject = 'Mesa · respaldo recuperado'
        body = (
            'El respaldo de faberloom_mesa volvió a estar sano.\n\n'
            f'check-freshness: exit 0\n'
            f'Detalle: {detail}\n\n'
            f'Estado: {summary_lines()}\n'
        )

    if args.dry_run:
        print(f'dry-run action={action} subject="{subject}"')
        return 0

    try:
        send(subject, body)
    except Failure as failure:
        print(f'reason={failure.slug}', file=sys.stderr)
        return 1

    write_state(
        {
            'state': 'ok' if healthy else 'fail',
            'signature': signature,
            'notified_at': stamp.isoformat(),
        }
    )
    print(f'ok action={action} state={"ok" if healthy else "fail"}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
