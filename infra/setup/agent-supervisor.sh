#!/usr/bin/env bash
# Agent süpervizörü — systemd'siz ortam için.
#
# Oyun konteynerinde systemd yok (PID 1 = bash), yani altai-agent@.service
# kullanılamıyor. Bu script onun yerini tutar: agent'ı arka planda çalıştırır,
# çökerse yeniden başlatır, PID ve log dosyalarını /data içinde tutar.
#
#   agent-supervisor.sh start <slug>     tek agent başlat
#   agent-supervisor.sh start-all        env dizinindeki tüm agent'ları başlat
#   agent-supervisor.sh stop <slug>      düzgünce durdur (SIGTERM)
#   agent-supervisor.sh stop-all
#   agent-supervisor.sh status
#   agent-supervisor.sh logs <slug> [n]

set -uo pipefail

ALTAI_DIR="${ALTAI_DIR:-/data/altai}"
ENV_DIR="${ENV_DIR:-/data/altai-env}"
RUN_DIR="${RUN_DIR:-/data/altai-run}"
TSX="$ALTAI_DIR/apps/agent/node_modules/.bin/tsx"

mkdir -p "$RUN_DIR"

pid_file()  { echo "$RUN_DIR/$1.pid"; }
log_file()  { echo "$RUN_DIR/$1.log"; }
env_file()  { echo "$ENV_DIR/agent-$1.env"; }

is_running() {
  local pf; pf="$(pid_file "$1")"
  [[ -f "$pf" ]] || return 1
  local pid; pid="$(cat "$pf" 2>/dev/null)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_one() {
  local slug="$1"
  local ef; ef="$(env_file "$slug")"
  [[ -r "$ef" ]] || { echo "HATA: $ef yok"; return 1; }
  [[ -x "$TSX" ]] || { echo "HATA: $TSX yok — install-agent-container.sh çalıştırıldı mı?"; return 1; }

  if is_running "$slug"; then
    echo "$slug zaten çalışıyor (pid $(cat "$(pid_file "$slug")"))"
    return 0
  fi

  # Süpervizör döngüsü: agent çökerse 10 sn sonra yeniden başlatır.
  # Ama düzgün kapanışta (stop ile oluşan .stop dosyası) döngüden çıkar —
  # yoksa "durdur" dediğimizde kendini geri açardı.
  rm -f "$RUN_DIR/$slug.stop"
  (
    cd "$ALTAI_DIR/apps/agent" || exit 1
    while [[ ! -f "$RUN_DIR/$slug.stop" ]]; do
      set -a
      # shellcheck disable=SC1090
      source "$ef"
      set +a
      "$TSX" src/index.ts >>"$(log_file "$slug")" 2>&1
      code=$?
      [[ -f "$RUN_DIR/$slug.stop" ]] && break
      echo "[supervisor] agent $slug çıktı (kod $code), 10 sn sonra yeniden başlıyor" \
        >>"$(log_file "$slug")"
      sleep 10
    done
    echo "[supervisor] $slug durduruldu" >>"$(log_file "$slug")"
  ) &

  echo $! > "$(pid_file "$slug")"
  echo "$slug başlatıldı (süpervizör pid $!) — log: $(log_file "$slug")"
}

stop_one() {
  local slug="$1"
  touch "$RUN_DIR/$slug.stop"
  if ! is_running "$slug"; then
    echo "$slug çalışmıyor"
    rm -f "$(pid_file "$slug")"
    return 0
  fi
  local sup; sup="$(cat "$(pid_file "$slug")")"
  # Önce agent sürecine SIGTERM: açık session'ları kapatması gerekiyor
  # (plan Bölüm 6 — graceful shutdown, yoksa her restart'ta session kaybı).
  pkill -TERM -P "$sup" 2>/dev/null
  for _ in $(seq 30); do
    is_running "$slug" || break
    sleep 1
  done
  kill -TERM "$sup" 2>/dev/null
  sleep 1
  is_running "$slug" && kill -KILL "$sup" 2>/dev/null
  rm -f "$(pid_file "$slug")"
  echo "$slug durduruldu"
}

all_slugs() {
  # Yalnızca gerçekten doldurulmuş env dosyaları — şablon hâlindekiler atlanır,
  # yoksa bootstrap her açılışta yarım yapılandırılmış agent'ları başlatır.
  for f in "$ENV_DIR"/agent-*.env; do
    [[ -e "$f" ]] || continue
    grep -qE '^AGENT_SHARED_SECRET=.+' "$f" || continue
    grep -qE '^RCON_PASSWORD=.+' "$f" || continue
    basename "$f" | sed -E 's/^agent-(.*)\.env$/\1/'
  done
}

case "${1:-}" in
  start)     start_one "${2:?slug gerekli}" ;;
  stop)      stop_one  "${2:?slug gerekli}" ;;
  start-all)
    found=0
    for s in $(all_slugs); do found=1; start_one "$s"; done
    (( found )) || echo "başlatılacak yapılandırılmış agent yok ($ENV_DIR)"
    ;;
  stop-all)  for s in $(all_slugs); do stop_one "$s"; done ;;
  status)
    for f in "$ENV_DIR"/agent-*.env; do
      [[ -e "$f" ]] || continue
      s="$(basename "$f" | sed -E 's/^agent-(.*)\.env$/\1/')"
      if is_running "$s"; then
        echo "  $s: çalışıyor (pid $(cat "$(pid_file "$s")"))"
      else
        echo "  $s: durmuş"
      fi
    done
    ;;
  logs)      tail -n "${3:-100}" "$(log_file "${2:?slug gerekli}")" ;;
  *)
    grep '^#' "$0" | sed 's/^# \{0,1\}//'
    exit 2 ;;
esac
