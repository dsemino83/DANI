#!/bin/sh
# Simulacro seguro de Disaster Recovery: verifica y restaura el último resguardo SOLO en bases temporales.
# Nunca ejecuta --restaurar ni reemplaza datos productivos.
set -eu
cd "$(dirname "$0")/.."
BASE="${HB_RESGUARDO_DIR:-/var/backups/home-banking}"
ESTADO="${HB_DR_STATUS_FILE:-/var/backups/home-banking/ultimo-simulacro-dr.env}"
ULTIMO="$(find "$BASE" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' 2>/dev/null | sort | tail -1)"
[ -n "$ULTIMO" ] || { echo "No hay resguardos en $BASE" >&2; exit 2; }
INICIO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TMP="${ESTADO}.tmp"
umask 077
if sh scripts/restaurar-resguardo.sh "$ULTIMO" --probar; then
  FIN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'estado=OK\ninicio=%s\nfin=%s\nresguardo=%s\n' "$INICIO" "$FIN" "$(basename "$ULTIMO")" > "$TMP"
  mv "$TMP" "$ESTADO"
  echo "Simulacro DR OK: $ULTIMO"
else
  rc=$?
  FIN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'estado=ERROR\ninicio=%s\nfin=%s\nresguardo=%s\ncodigo=%s\n' "$INICIO" "$FIN" "$(basename "$ULTIMO")" "$rc" > "$TMP"
  mv "$TMP" "$ESTADO"
  exit "$rc"
fi
