#!/usr/bin/env python3
"""Copia externa de los respaldos de la Mesa en un buzón IMAP.

El respaldo local vive en `/opt/backups/mesa-mwt-one`, en el mismo disco que la
base. Este cliente copia cada artifact a una carpeta del buzón
`alejandro@muitowork.com` en Hostinger, que es infraestructura distinta a la del
VPS, y verifica la copia leyéndola de vuelta.

Uso:

    mesa-offsite.py upload --artifact <ruta.dump> [--sha256 <hex>]
    mesa-offsite.py check                 # baja el más nuevo y compara sha256
    mesa-offsite.py list                  # catálogo de copias en el buzón
    mesa-offsite.py fetch --latest --out-dir <dir>
    mesa-offsite.py prune
    mesa-offsite.py quota
    mesa-offsite.py --self-test           # lógica pura, sin red

Configuración por entorno (la escribe `/etc/mwt/mesa-offsite.env`, modo 600):

    MESA_OFFSITE_HOST      servidor IMAP (por omisión imap.hostinger.com)
    MESA_OFFSITE_PORT      puerto (993, TLS implícito)
    MESA_OFFSITE_USER      cuenta
    MESA_OFFSITE_PASS      contraseña
    MESA_OFFSITE_FOLDER    carpeta destino (por omisión INBOX<delim>Mesa-Backups)
    MESA_OFFSITE_KEEP_HOURS  72    ventana en la que se guarda cada copia
    MESA_OFFSITE_KEEP_DAYS   30    días con una copia diaria
    MESA_OFFSITE_KEEP_MAX   200    tope duro de mensajes
    MESA_OFFSITE_KEEP_MIN     3    mensajes que nunca se borran
    MESA_OFFSITE_MAX_MB      20    tamaño máximo aceptado por mensaje

Cada mensaje lleva el dump como adjunto y, en el cuerpo, el manifiesto del
artifact entre las marcas `--- meta ---` y `--- end meta ---`; así la
restauración recupera el `.meta` sin descargar nada más. El asunto es el
catálogo:

    [mesa-backup] mesa_20261102T184502Z.dump sha256=<64 hex> bytes=<n> items=<n> events=<n>

Con `MESA_OFFSITE_AGE_RECIPIENT` el adjunto se guarda cifrado con age
(`<dump>.age`) y el asunto añade `plain_sha256=<64 hex> enc=age`: leer el buzón
deja de bastar para leer la base. La identidad para descifrar sale de
`MESA_OFFSITE_AGE_IDENTITY`.

Los fallos salen con código 1 y una sola línea `reason=<slug>` en stderr. Ni el
log ni el estado llevan credenciales ni la respuesta cruda del servidor.
"""

from __future__ import annotations

import argparse
import hashlib
import imaplib
import os
import re
import ssl
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from email import message_from_bytes, policy
from email.message import EmailMessage
from email.utils import formatdate

SUBJECT_PREFIX = '[mesa-backup]'
NAME_RE = re.compile(r'^mesa_\d{8}T\d{6}Z\.dump$')
SUBJECT_RE = re.compile(
    r'^\[mesa-backup\]\s+(mesa_\d{8}T\d{6}Z\.dump)\s+sha256=([0-9a-f]{64})'
    r'\s+bytes=(\d+)(?:\s+plain_sha256=([0-9a-f]{64}))?(?:\s+enc=(age))?'
    r'(?:\s+items=(\d+))?(?:\s+events=(\d+))?$'
)
META_BEGIN = '--- meta ---'
META_END = '--- end meta ---'
STAMP_RE = re.compile(r'^mesa_(\d{8}T\d{6}Z)\.dump$')

DEFAULTS = {
    'MESA_OFFSITE_HOST': 'imap.hostinger.com',
    'MESA_OFFSITE_PORT': '993',
    'MESA_OFFSITE_FOLDER': '',
    'MESA_OFFSITE_KEEP_HOURS': '72',
    'MESA_OFFSITE_KEEP_DAYS': '30',
    'MESA_OFFSITE_KEEP_MAX': '200',
    'MESA_OFFSITE_KEEP_MIN': '3',
    'MESA_OFFSITE_MAX_MB': '20',
    'MESA_OFFSITE_AGE_RECIPIENT': '',
    'MESA_OFFSITE_AGE_IDENTITY': '/etc/mwt/mesa-age.key',
    'MESA_OFFSITE_FOLDER_NAME': 'Mesa-Backups',
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
    """Carga `MESA_ENV_FILE` para las claves que no estén ya en el entorno.

    Es el mismo archivo que leen los scripts de bash
    (`/etc/mwt/mesa-offsite.env`), así que ejecutar este cliente a mano funciona
    sin exportar nada. No ejecuta el archivo y no pisa el entorno.
    """
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


def env_int(name: str) -> int:
    """Valor entero de entorno; un valor ilegible es un fallo, no un cero."""
    raw = env(name)
    try:
        return int(raw)
    except ValueError as error:
        raise Failure(f'{name.removeprefix("MESA_OFFSITE_").lower()}_invalid') from error


def stamp_epoch(name: str) -> int:
    """Segundos UTC del nombre `mesa_<UTC>.dump`.

    El nombre es la hora del dump, así que ordena la retención sin depender de
    la fecha interna que ponga el servidor de correo.
    """
    match = STAMP_RE.match(name)
    if match is None:
        raise Failure('name_invalid')
    moment = datetime.strptime(match.group(1), '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    return int(moment.timestamp())


def parse_subject(subject: str) -> dict | None:
    """Entrada de catálogo a partir del asunto, o None si no es nuestro."""
    match = SUBJECT_RE.match(' '.join(subject.split()))
    if match is None:
        return None
    name, sha, size, plain, enc, items, events = match.groups()
    return {
        'name': name,
        'sha256': sha,
        'bytes': int(size),
        'plain_sha256': plain or sha,
        'enc': enc or '',
        'items': int(items) if items else None,
        'events': int(events) if events else None,
        'stamp': stamp_epoch(name),
    }


def retention_plan(
    entries: list[dict],
    now: int,
    keep_hours: int,
    keep_days: int,
    keep_max: int,
    keep_min: int,
) -> list[dict]:
    """Entradas que la retención borra, de la más vieja a la más nueva.

    Reglas, en orden: la ventana de `keep_hours` se conserva entera; fuera de
    ella se conserva la más nueva de cada día UTC hasta `keep_days`; después el
    tope `keep_max` recorta las más viejas. `keep_min` mensajes recientes no se
    borran nunca, para que un reloj adelantado no vacíe el destino.
    """
    ordered = sorted(entries, key=lambda entry: entry['stamp'], reverse=True)
    dropped: set[str] = set()
    seen_day: set[str] = set()
    for index, entry in enumerate(ordered):
        if index < keep_min:
            continue
        age_hours = (now - entry['stamp']) / 3600
        if age_hours <= keep_hours:
            continue
        if age_hours <= keep_days * 24:
            day = datetime.fromtimestamp(entry['stamp'], timezone.utc).strftime('%Y-%m-%d')
            if day not in seen_day:
                seen_day.add(day)
                continue
        dropped.add(entry['uid'])
    kept = [entry for entry in ordered if entry['uid'] not in dropped]
    for entry in kept[keep_max:]:
        dropped.add(entry['uid'])
    return sorted([entry for entry in ordered if entry['uid'] in dropped], key=lambda entry: entry['stamp'])


def read_bytes(path: str) -> bytes:
    """Contenido del archivo, o `artifact_missing` si no se puede leer."""
    try:
        with open(path, 'rb') as handle:
            return handle.read()
    except OSError as error:
        raise Failure('artifact_missing') from error


def read_text(path: str) -> str:
    """Texto UTF-8 del archivo, o cadena vacía si no existe."""
    try:
        with open(path, encoding='utf-8') as handle:
            return handle.read()
    except OSError:
        return ''


def build_message(
    user: str,
    name: str,
    data: bytes,
    meta: str,
    counts: dict,
    enc: str,
    plain_sha: str,
) -> EmailMessage:
    """Mensaje con el dump adjunto y el manifiesto del artifact en el cuerpo."""
    digest = hashlib.sha256(data).hexdigest()
    subject = f'{SUBJECT_PREFIX} {name} sha256={digest} bytes={len(data)}'
    if enc:
        subject += f' plain_sha256={plain_sha} enc={enc}'
    if counts.get('items') is not None:
        subject += f" items={counts['items']}"
    if counts.get('events') is not None:
        subject += f" events={counts['events']}"
    body = [
        'Copia externa del respaldo de faberloom_mesa.',
        '',
        f'artifact={name}',
        f'sha256={digest}',
        f'bytes={len(data)}',
        f'generated={datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}',
    ]
    if enc:
        body += [f'enc={enc}', f'plain_sha256={plain_sha}']
    body += [
        '',
        META_BEGIN,
        meta.rstrip('\n'),
        META_END,
        '',
    ]
    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = user
    message['To'] = user
    message['Date'] = formatdate(localtime=False)
    message.set_content('\n'.join(body))
    message.add_attachment(
        data,
        maintype='application',
        subtype='octet-stream',
        filename=f'{name}.{enc}' if enc else name,
    )
    return message


def attachment_bytes(raw: bytes, name: str) -> bytes:
    """Adjunto llamado `name` dentro del mensaje crudo."""
    message = message_from_bytes(raw, policy=policy.default)
    for part in message.walk():
        if part.get_filename() == name and part.get_payload(decode=True):
            return part.get_payload(decode=True)
    raise Failure('readback_missing')


def age_encrypt(data: bytes, recipient: str) -> bytes:
    """Cifra el artifact con age; un fallo es `encrypt_failed`, no una copia muda."""
    try:
        done = subprocess.run(
            ['age', '--encrypt', '--recipient', recipient],
            input=data,
            capture_output=True,
            timeout=300,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise Failure('age_missing') from error
    if done.returncode != 0 or not done.stdout:
        raise Failure('encrypt_failed')
    return done.stdout


def age_decrypt(data: bytes) -> bytes:
    """Descifra con la identidad configurada; sin ella no se finge una copia."""
    identity = env('MESA_OFFSITE_AGE_IDENTITY')
    if not identity or not os.path.exists(identity):
        raise Failure('identity_missing')
    try:
        done = subprocess.run(
            ['age', '--decrypt', '--identity', identity],
            input=data,
            capture_output=True,
            timeout=300,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise Failure('age_missing') from error
    if done.returncode != 0 or not done.stdout:
        raise Failure('decrypt_failed')
    return done.stdout


def plain_bytes(entry: dict, raw: bytes) -> bytes:
    """Contenido del dump a partir del adjunto, descifrando si hace falta."""
    stored = attachment_bytes(raw, f"{entry['name']}.{entry['enc']}" if entry['enc'] else entry['name'])
    plain = age_decrypt(stored) if entry['enc'] == 'age' else stored
    if hashlib.sha256(plain).hexdigest() != entry['plain_sha256']:
        raise Failure('checksum_mismatch')
    return plain


def meta_from_body(raw: bytes) -> str:
    """Bloque de manifiesto que el mensaje lleva en el cuerpo."""
    message = message_from_bytes(raw, policy=policy.default)
    body = ''
    for part in message.walk():
        if part.get_content_type() == 'text/plain' and part.get_payload(decode=True):
            body = part.get_payload(decode=True).decode('utf-8', 'replace')
            break
    if META_BEGIN not in body or META_END not in body:
        return ''
    block = body.split(META_BEGIN, 1)[1].split(META_END, 1)[0]
    # El generador de correo escribe CRLF: el `.meta` restaurado debe ser el
    # mismo archivo de texto que escribió el respaldo, con saltos `\n`.
    block = block.replace('\r\n', '\n')
    return block.strip('\n') + '\n' if block.strip() else ''


class Mailbox:
    """La carpeta de copias: conexión, catálogo, escritura y poda."""

    def __init__(self) -> None:
        self.user = env('MESA_OFFSITE_USER')
        password = env('MESA_OFFSITE_PASS')
        if not self.user or not password:
            raise Failure('credentials_missing')
        host = env('MESA_OFFSITE_HOST')
        port = env_int('MESA_OFFSITE_PORT')
        try:
            self.imap = imaplib.IMAP4_SSL(host, port, timeout=30, ssl_context=ssl.create_default_context())
        except (OSError, imaplib.IMAP4.error) as error:
            raise Failure('connect_failed') from error
        try:
            self.imap.login(self.user, password)
        except imaplib.IMAP4.error as error:
            raise Failure('auth_failed') from error
        self.folder = self._resolve_folder()

    def _resolve_folder(self) -> str:
        """Carpeta configurada, o `INBOX<delim><nombre>`, creada si falta."""
        configured = env('MESA_OFFSITE_FOLDER')
        if configured:
            name = configured
        else:
            delimiter = '.'
            try:
                _typ, data = self.imap.list('""', '""')
                if data and data[0] and b' "." ' in data[0]:
                    delimiter = '.'
            except imaplib.IMAP4.error:
                delimiter = '.'
            name = f"INBOX{delimiter}{env('MESA_OFFSITE_FOLDER_NAME')}"
        quoted = f'"{name}"' if ' ' in name or '/' in name else name
        try:
            _typ, data = self.imap.list('""', quoted)
            if not data or data[0] is None:
                self.imap.create(quoted)
        except imaplib.IMAP4.error as error:
            if 'ALREADYEXISTS' not in str(error).upper():
                raise Failure('folder_failed') from error
        self.imap.folder_name = name
        return quoted

    def catalog(self) -> list[dict]:
        """Entradas del catálogo, con su UID, ordenadas por hora del dump."""
        try:
            self.imap.select(self.folder, readonly=True)
        except imaplib.IMAP4.error as error:
            raise Failure('folder_failed') from error
        try:
            _typ, data = self.imap.uid('FETCH', '1:*', '(BODY.PEEK[HEADER.FIELDS (SUBJECT)])')
        except imaplib.IMAP4.error:
            data = None
        entries: list[dict] = []
        for item in data or []:
            if not isinstance(item, tuple):
                continue
            meta, header = item
            uid = re.search(rb'UID (\d+)', meta)
            if not uid:
                continue
            # El servidor pliega el asunto en varias líneas; se desdobla antes
            # de leerlo o el catálogo se queda vacío.
            text = re.sub(r'\n[ \t]+', ' ', header.decode('utf-8', 'replace').replace('\r\n', '\n'))
            subject = re.search(r'(?im)^Subject:[ \t]*(.+)$', text)
            if not subject:
                continue
            entry = parse_subject(subject.group(1))
            if entry is not None:
                entry['uid'] = uid.group(1).decode('ascii')
                entries.append(entry)
        return sorted(entries, key=lambda entry: entry['stamp'])

    def raw(self, uid: str) -> bytes:
        """Cuerpo completo del mensaje `uid`."""
        _typ, data = self.imap.uid('FETCH', uid, '(BODY.PEEK[])')
        for item in data or []:
            if isinstance(item, tuple) and isinstance(item[1], (bytes, bytearray)):
                return bytes(item[1])
        raise Failure('readback_missing')

    def append(self, message: EmailMessage) -> str:
        """Escribe el mensaje y devuelve su UID si el servidor lo informa."""
        try:
            typ, data = self.imap.append(
                self.folder,
                '\\Seen',
                imaplib.Time2Internaldate(datetime.now(timezone.utc)),
                message.as_bytes(),
            )
        except imaplib.IMAP4.error as error:
            raise Failure('append_failed') from error
        if typ != 'OK':
            raise Failure('append_failed')
        for item in data or []:
            if isinstance(item, bytes):
                match = re.search(rb'APPENDUID \d+ (\d+)', item)
                if match:
                    return match.group(1).decode('ascii')
        return ''

    def delete(self, uids: list[str]) -> int:
        """Marca y expulsa `uids`; devuelve cuántos se fueron."""
        if not uids:
            return 0
        self.imap.select(self.folder)
        for uid in uids:
            self.imap.uid('STORE', uid, '+FLAGS', '(\\Deleted)')
        try:
            self.imap.expunge()
        except imaplib.IMAP4.error as error:
            raise Failure('prune_failed') from error
        return len(uids)


def counts_from_meta(meta: str) -> dict:
    """`items` y `events` del manifiesto del artifact."""
    counts: dict = {}
    for line in meta.splitlines():
        key, _, value = line.partition('=')
        if key in ('items', 'events') and value.isdigit():
            counts[key] = int(value)
    return counts


def cmd_upload(args: argparse.Namespace) -> int:
    """Sube el artifact, lo relee y poda; deja el resultado en una línea."""
    path = args.artifact
    name = os.path.basename(path)
    if NAME_RE.match(name) is None:
        raise Failure('name_invalid')
    data = read_bytes(path)
    limit = env_int('MESA_OFFSITE_MAX_MB') * 1024 * 1024
    if len(data) > limit:
        raise Failure('too_large')
    digest = hashlib.sha256(data).hexdigest()
    if args.sha256 and args.sha256 != digest:
        raise Failure('checksum_mismatch')
    recipient = env('MESA_OFFSITE_AGE_RECIPIENT')
    payload = age_encrypt(data, recipient) if recipient else data
    enc = 'age' if recipient else ''
    meta = read_text(f'{path}.meta')
    mailbox = Mailbox()
    entries = mailbox.catalog()
    existing = next(
        (item for item in entries if item['name'] == name and item['plain_sha256'] == digest),
        None,
    )
    if existing is not None:
        uid = existing['uid']
        repeated = 1
    else:
        repeated = 0
        uid = mailbox.append(
            build_message(mailbox.user, name, payload, meta, counts_from_meta(meta), enc, digest)
        )
        if uid == '':
            match = next((item for item in entries if item['name'] == name), None)
            if match is None:
                raise Failure('readback_missing')
            uid = match['uid']
        readback = mailbox.raw(uid)
        plain_bytes({'name': name, 'enc': enc, 'plain_sha256': digest}, readback)
        entries = mailbox.catalog()

    pruned = mailbox.delete(
        [
            item['uid']
            for item in retention_plan(
                entries,
                int(datetime.now(timezone.utc).timestamp()),
                env_int('MESA_OFFSITE_KEEP_HOURS'),
                env_int('MESA_OFFSITE_KEEP_DAYS'),
                env_int('MESA_OFFSITE_KEEP_MAX'),
                env_int('MESA_OFFSITE_KEEP_MIN'),
            )
        ]
    )
    print(
        f'ok artifact={name} folder={mailbox.imap.folder_name} uid={uid} '
        f'pruned={pruned} repeated={repeated}'
    )
    return 0


def cmd_prune(_args: argparse.Namespace) -> int:
    """Aplica sólo la retención del buzón."""
    mailbox = Mailbox()
    entries = mailbox.catalog()
    plan = retention_plan(
        entries,
        int(datetime.now(timezone.utc).timestamp()),
        env_int('MESA_OFFSITE_KEEP_HOURS'),
        env_int('MESA_OFFSITE_KEEP_DAYS'),
        env_int('MESA_OFFSITE_KEEP_MAX'),
        env_int('MESA_OFFSITE_KEEP_MIN'),
    )
    pruned = mailbox.delete([item['uid'] for item in plan])
    print(f'ok kept={len(entries) - pruned} pruned={pruned} folder={mailbox.imap.folder_name}')
    return 0


def cmd_list(_args: argparse.Namespace) -> int:
    """Imprime el catálogo, del más viejo al más nuevo."""
    mailbox = Mailbox()
    entries = mailbox.catalog()
    for entry in entries:
        print(
            f"{entry['name']} uid={entry['uid']} bytes={entry['bytes']} "
            f"sha256={entry['sha256'][:16]}… enc={entry['enc'] or 'none'} "
            f"items={entry['items']} events={entry['events']}"
        )
    print(f'total={len(entries)} folder={mailbox.imap.folder_name}')
    return 0


def cmd_check(_args: argparse.Namespace) -> int:
    """Baja la copia más nueva, la descifra si hace falta y compara su sha256."""
    mailbox = Mailbox()
    entries = mailbox.catalog()
    if not entries:
        raise Failure('no_message')
    newest = entries[-1]
    raw = mailbox.raw(newest['uid'])
    data = plain_bytes(newest, raw)
    print(
        f"ok artifact={newest['name']} bytes={len(data)} sha256={newest['plain_sha256']} "
        f"enc={newest['enc'] or 'none'} age_s={int(datetime.now(timezone.utc).timestamp()) - newest['stamp']}"
    )
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    """Escribe el dump, su `.sha256` y su `.meta` en `--out-dir`."""
    mailbox = Mailbox()
    entries = mailbox.catalog()
    if not entries:
        raise Failure('no_message')
    chosen = entries[-1] if args.latest else next((e for e in entries if e['name'] == args.name), None)
    if chosen is None:
        raise Failure('no_message')
    raw = mailbox.raw(chosen['uid'])
    data = plain_bytes(chosen, raw)
    digest = hashlib.sha256(data).hexdigest()
    os.makedirs(args.out_dir, exist_ok=True)
    path = os.path.join(args.out_dir, chosen['name'])
    with open(path, 'wb') as handle:
        handle.write(data)
    with open(f'{path}.sha256', 'w', encoding='utf-8') as handle:
        handle.write(f'{digest}  {chosen["name"]}\n')
    meta = meta_from_body(raw)
    if meta:
        with open(f'{path}.meta', 'w', encoding='utf-8') as handle:
            handle.write(meta)
    print(f'artifact={path}')
    return 0


def cmd_quota(_args: argparse.Namespace) -> int:
    """Uso de la cuota del buzón, si el servidor la informa."""
    mailbox = Mailbox()
    try:
        _typ, data = mailbox.imap.getquotaroot('INBOX')
    except imaplib.IMAP4.error as error:
        raise Failure('quota_unavailable') from error

    def flat(value: object) -> list[str]:
        """Texto de una respuesta IMAP, que anida tuplas y listas."""
        if isinstance(value, (list, tuple)):
            return [text for item in value for text in flat(item)]
        if isinstance(value, bytes):
            return [value.decode('utf-8', 'replace')]
        return [str(value)]

    values = [text for text in flat(data) if 'STORAGE' in text]
    print(values[-1] if values else 'quota=unknown')
    return 0


def self_test() -> int:
    """Pruebas de la lógica pura: asunto, nombre, retención."""
    checks = 0

    def same(left: object, right: object, what: str) -> None:
        nonlocal checks
        checks += 1
        if left != right:
            raise SystemExit(f'self-test FAIL {what}: {left!r} != {right!r}')

    entry = parse_subject(
        '[mesa-backup] mesa_20261102T184502Z.dump sha256=' + 'a' * 64 + ' bytes=286625 items=500 events=2477'
    )
    same(entry['name'], 'mesa_20261102T184502Z.dump', 'asunto: nombre')
    same(entry['items'], 500, 'asunto: items')
    same(entry['events'], 2477, 'asunto: events')
    same(entry['stamp'], int(datetime(2026, 11, 2, 18, 45, 2, tzinfo=timezone.utc).timestamp()), 'asunto: marca')
    same(parse_subject('[mesa-backup] mesa_20261102T184502Z.dump bytes=1'), None, 'asunto sin sha')
    same(parse_subject('otra cosa'), None, 'asunto ajeno')

    now = int(datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc).timestamp())

    def at(hours: float, name: str | None = None) -> dict:
        moment = now - int(hours * 3600)
        label = name or datetime.fromtimestamp(moment, timezone.utc).strftime('mesa_%Y%m%dT%H%M%SZ.dump')
        return {'name': label, 'uid': label, 'stamp': moment, 'sha256': 'b' * 64, 'bytes': 1}

    entries = [at(1), at(2), at(80), at(79), at(100 * 24)]
    plan = retention_plan(entries, now, 72, 30, 200, 1)
    same([item['uid'] for item in plan], [at(100 * 24)['uid'], at(80)['uid']], 'retención: ventana y día')

    plan = retention_plan([at(100 * 24), at(101 * 24)], now, 1, 1, 200, 1)
    same([item['uid'] for item in plan], [at(101 * 24)['uid']], 'retención: keep_min protege el más nuevo')

    many = [at(0.1 * index) for index in range(10)]
    plan = retention_plan(many, now, 72, 30, 4, 1)
    same(len(plan), 6, 'retención: tope duro')

    same(stamp_epoch('mesa_20261102T184502Z.dump') > 0, True, 'nombre: marca legible')
    print(f'self-test: {checks} ok')
    return 0


def main(argv: list[str]) -> int:
    """Despacha el subcomando y traduce un `Failure` a `reason=`."""
    parser = argparse.ArgumentParser(description='Copia externa de los respaldos de la Mesa en IMAP.')
    parser.add_argument('--self-test', action='store_true', help='prueba la lógica pura y sale')
    sub = parser.add_subparsers(dest='command')

    upload = sub.add_parser('upload', help='sube un artifact y verifica la copia')
    upload.add_argument('--artifact', required=True)
    upload.add_argument('--sha256', default='')
    upload.set_defaults(handler=cmd_upload)

    sub.add_parser('check', help='verifica la copia más nueva').set_defaults(handler=cmd_check)
    sub.add_parser('list', help='imprime el catálogo').set_defaults(handler=cmd_list)
    sub.add_parser('prune', help='aplica la retención del buzón').set_defaults(handler=cmd_prune)
    sub.add_parser('quota', help='uso de la cuota').set_defaults(handler=cmd_quota)

    fetch = sub.add_parser('fetch', help='escribe una copia en disco')
    fetch.add_argument('--latest', action='store_true')
    fetch.add_argument('--name', default='')
    fetch.add_argument('--out-dir', required=True)
    fetch.set_defaults(handler=cmd_fetch)

    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    load_env_file()
    if not getattr(args, 'handler', None):
        parser.print_help(sys.stderr)
        return 2
    try:
        return args.handler(args)
    except Failure as failure:
        print(f'reason={failure.slug}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
