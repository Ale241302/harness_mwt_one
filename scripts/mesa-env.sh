#!/usr/bin/env bash
# =====================================================================
# Lector del `.env` de la copia externa (lo comparten el respaldo y el drill).
#
#   . "$(dirname "$0")/mesa-env.sh"
#   mesa_load_env "${MESA_ENV_FILE:-/etc/mwt/mesa-offsite.env}"
#
# Lee `CLAVE=valor` sin ejecutar el archivo y **sin pisar** lo que ya viene en
# el entorno: una prueba puede apuntar a otro destino exportando la variable
# antes de llamar al script. Ignora comentarios, líneas sin `=`, claves que no
# sean `[A-Z_][A-Z0-9_]*` y quita comillas simples o dobles que envuelvan todo
# el valor. Un archivo ilegible no es un error: la copia externa se apaga sola.
# =====================================================================

mesa_load_env() { # <ruta>
  local file="${1:-}" line key value
  [[ -n "$file" && -r "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    [[ -n "${!key:-}" ]] && continue
    if [[ "$value" == \"*\" && "$value" == *\" ]] || [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done <"$file"
  return 0
}
