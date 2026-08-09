#!/usr/bin/env bash
# Agent'ı servis olarak açmadan ÖNCE çalıştırın.
#
# Agent gerçek bir Squad sunucusuna karşı ilk kez çalıştırılıyor. Servis olarak
# başlatıp journalctl'de hata aramak yerine, bağımlılıkları tek tek burada
# doğruluyoruz: log dosyası okunabiliyor mu, RCON açık mı, Postgres'e
# ulaşılıyor mu, api ayakta mı.
#
# Kullanım: ./preflight.sh /etc/altai/agent-squad-01.env

set -uo pipefail

ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
  echo "Kullanım: $0 /etc/altai/agent-<slug>.env" >&2
  exit 2
fi
if [[ ! -r "$ENV_FILE" ]]; then
  echo "HATA: $ENV_FILE okunamıyor (root veya agent kullanıcısı olarak çalıştırın)" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

need() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then bad "$name tanımlı değil"; return 1; fi
  return 0
}

echo "== 1. Zorunlu değişkenler =="
for v in SERVER_SLUG AGENT_API_WS_URL AGENT_SHARED_SECRET AGENT_ENGINE; do
  need "$v" && ok "$v var"
done
if [[ -n "${DATABASE_URL:-}" ]]; then
  warn "DATABASE_URL tanımlı ama agent artık veritabanına bağlanmıyor — silebilirsiniz"
fi
if [[ "${AGENT_ENGINE:-}" == "real" ]]; then
  for v in SQUADJS_VENDOR_ENTRY RCON_HOST RCON_PORT RCON_PASSWORD SQUAD_LOG_DIR; do
    need "$v" && ok "$v var"
  done
else
  warn "AGENT_ENGINE=${AGENT_ENGINE:-} — gerçek Squad sunucusuna BAĞLANMAZ, sahte event üretir"
fi

echo "== 2. Squad log dosyası =="
if [[ -n "${SQUAD_LOG_DIR:-}" ]]; then
  LOG="$SQUAD_LOG_DIR/SquadGame.log"
  if [[ ! -d "$SQUAD_LOG_DIR" ]]; then
    bad "$SQUAD_LOG_DIR yok"
  elif [[ ! -r "$LOG" ]]; then
    bad "$LOG okunamıyor — agent kullanıcısının okuma izni var mı?"
  else
    ok "$LOG okunabiliyor ($(du -h "$LOG" | cut -f1))"
    # Log canlı mı? Durmuş bir log, agent'ın sessizce hiçbir şey yapmaması demek.
    AGE=$(( $(date +%s) - $(stat -c %Y "$LOG") ))
    if (( AGE > 600 )); then
      warn "log $((AGE/60)) dakikadır güncellenmemiş — sunucu kapalı olabilir"
    else
      ok "log canlı (son yazım ${AGE} sn önce)"
    fi
    # Bu satır yoksa parser oyuncu bağlantılarını göremez.
    if grep -qm1 'LogSquad' "$LOG" 2>/dev/null; then
      ok "log formatı tanıdık (LogSquad satırları var)"
    else
      warn "logda LogSquad satırı bulunamadı — dosya doğru mu?"
    fi
  fi
fi

echo "== 3. RCON =="
if [[ -n "${RCON_HOST:-}" && -n "${RCON_PORT:-}" ]]; then
  if command -v nc >/dev/null 2>&1; then
    if nc -z -w5 "$RCON_HOST" "$RCON_PORT" 2>/dev/null; then
      ok "RCON portu açık ($RCON_HOST:$RCON_PORT)"
    else
      bad "RCON portuna bağlanılamadı ($RCON_HOST:$RCON_PORT) — sunucu açık mı, port doğru mu?"
      # Bu ortamda en sık yapılan hata: loopback filtreli olduğu hâlde
      # 127.0.0.1 yazmak. Hata mesajı "connection refused" olduğu için
      # RCON kapalı sanılıyor, oysa adres yanlış.
      case "$RCON_HOST" in
        127.0.0.1|localhost|::1)
          warn "RCON_HOST=$RCON_HOST — bu ortamda loopback KAPALI, sunucunun genel IP'sini yazın"
          ;;
      esac
    fi
  else
    warn "nc yok, RCON portu kontrol edilemedi (apt install netcat-openbsd)"
  fi
fi

echo "== 4. Spool dizini =="
SPOOL="${AGENT_SPOOL_DIR:-/data/altai-run/spool}"
SPOOL_PARENT="$(dirname "$SPOOL")"
if mkdir -p "$SPOOL" 2>/dev/null && [[ -w "$SPOOL" ]]; then
  ok "spool yazılabilir ($SPOOL)"
  case "$SPOOL" in
    /data/*) ;;
    # Konteynerde /data dışı kalıcı değil: kesinti sırasında biriken eventler
    # bir sonraki `update`'te sessizce yok olur.
    *) warn "$SPOOL /data altında değil — konteyner yeniden yaratılınca kuyruk kaybolur" ;;
  esac
  PENDING=$(find "$SPOOL" -name 'spool*.ndjson' -size +0 2>/dev/null | wc -l)
  (( PENDING > 0 )) && warn "spool'da gönderilmemiş event var ($PENDING dosya)"
else
  bad "spool dizini oluşturulamadı/yazılamıyor: $SPOOL (üst dizin: $SPOOL_PARENT)"
fi

echo "== 5. api WebSocket =="
if [[ -n "${AGENT_API_WS_URL:-}" ]]; then
  HTTP_URL="${AGENT_API_WS_URL/#wss:/https:}"; HTTP_URL="${HTTP_URL/#ws:/http:}"
  # WebSocket kökte (/agent-ws), HTTP rotaları /api önekinde — ters vekil
  # öneki SOYMUYOR. Sağlık ucu bu yüzden /api/health.
  HEALTH="${HTTP_URL%/agent-ws}/api/health"
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 10 "$HEALTH" >/dev/null 2>&1; then
      ok "api ayakta ($HEALTH)"
    else
      bad "api'ye ulaşılamadı ($HEALTH) — uygulama sunucusunda api çalışıyor mu?"
    fi
  else
    warn "curl yok, api kontrol edilemedi"
  fi
fi

echo "== 6. Çalışma zamanı =="
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  # Oyun konteynerinde Node 20 var; agent v20'de çalışıyor.
  if (( NODE_MAJOR >= 20 )); then ok "node $(node -v)"; else bad "node $(node -v) — en az v20 gerekli"; fi
else
  bad "node kurulu değil"
fi
if [[ -n "${SQUADJS_VENDOR_ENTRY:-}" ]]; then
  if [[ -r "$SQUADJS_VENDOR_ENTRY" ]]; then ok "vendor girişi bulundu"; else bad "SQUADJS_VENDOR_ENTRY okunamıyor: $SQUADJS_VENDOR_ENTRY"; fi
fi

echo
if (( FAIL )); then
  echo "SONUÇ: eksikler var — düzeltmeden servisi başlatmayın."
  exit 1
fi

# Depo kökü: bu script infra/setup/ altında duruyor.
REPO_ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
# systemd unit'indeki User= alanı, agent'ı hangi kullanıcının çalıştırdığını söyler.
AGENT_USER="$(awk -F= '/^User=/{print $2}' /etc/systemd/system/altai-agent@.service 2>/dev/null || true)"
AGENT_USER="${AGENT_USER:-<agent-kullanicisi>}"

cat <<EOF
SONUÇ: hazır.

Önce ÖN PLANDA deneyin — çıktıyı canlı görün, Ctrl+C ile durur:

  cd $REPO_ROOT/apps/agent
  sudo -u $AGENT_USER env \$(grep -v '^#' $ENV_FILE | xargs) \\
    ./node_modules/.bin/tsx src/index.ts

Beklenen: "agent başladı" ve engine: real  (fixture yazıyorsa env yanlış)

Sorun yoksa servis olarak açın:
  sudo systemctl enable --now altai-agent@${SERVER_SLUG}
  sudo journalctl -u altai-agent@${SERVER_SLUG} -f
EOF
