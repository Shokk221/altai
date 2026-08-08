#!/usr/bin/env bash
# Altai v2 agent kurulumu — OYUN SUNUCUSUNDA çalıştırılır.
#
# Ne yapar:
#   1. node/pnpm sürümünü doğrular
#   2. Depoyu /opt/altai'ye yerleştirir ve agent bağımlılıklarını kurar
#   3. /etc/altai/agent-<slug>.env dosyasını şablondan oluşturur (0600)
#   4. systemd template unit'ini kurar (BAŞLATMAZ — önce preflight.sh)
#
# Tekrar tekrar çalıştırılabilir; mevcut env dosyalarının üzerine YAZMAZ.
#
# Kullanım (repo kökünden veya herhangi bir yerden):
#   sudo ./infra/setup/install-agent.sh --slug squad-01 --user sqserver
#   sudo ./infra/setup/install-agent.sh --slug squad-02 --user sqserver

set -euo pipefail

ALTAI_DIR="${ALTAI_DIR:-/opt/altai}"
SLUG=""
RUN_USER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="${2:-}"; shift 2 ;;
    --user) RUN_USER="${2:-}"; shift 2 ;;
    --dir)  ALTAI_DIR="${2:-}"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Bilinmeyen argüman: $1" >&2; exit 2 ;;
  esac
done

die() { echo "HATA: $*" >&2; exit 1; }
say() { printf '\033[36m==>\033[0m %s\n' "$*"; }

[[ $EUID -eq 0 ]] || die "root olarak çalıştırın (sudo)"
[[ -n "$SLUG" ]] || die "--slug zorunlu (örn. --slug squad-01)"
[[ -n "$RUN_USER" ]] || die "--user zorunlu — Squad loglarını OKUYABİLEN kullanıcı (örn. LinuxGSM kullanıcısı)"
id "$RUN_USER" >/dev/null 2>&1 || die "kullanıcı yok: $RUN_USER"
RUN_GROUP="$(id -gn "$RUN_USER")"

REPO_ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
[[ -f "$REPO_ROOT/pnpm-workspace.yaml" ]] || die "depo kökü bulunamadı ($REPO_ROOT)"

say "1/5 çalışma zamanı kontrolü"
command -v node >/dev/null 2>&1 || die "node kurulu değil (v22+ gerekli)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 22 )) || die "node v$NODE_MAJOR — en az v22 gerekli"
if ! command -v pnpm >/dev/null 2>&1; then
  say "    pnpm yok, corepack ile etkinleştiriliyor"
  corepack enable >/dev/null 2>&1 || die "pnpm kurulamadı; elle kurun: npm i -g pnpm"
fi
echo "    node $(node -v), pnpm $(pnpm -v)"

say "2/5 depo -> $ALTAI_DIR"
if [[ "$REPO_ROOT" != "$ALTAI_DIR" ]]; then
  mkdir -p "$ALTAI_DIR"
  # node_modules ve yerel arşivler kopyalanmaz; bağımlılıklar hedefte kurulur.
  tar -C "$REPO_ROOT" \
      --exclude='node_modules' --exclude='.git' --exclude='.next' \
      --exclude='dist' --exclude='.turbo' --exclude='bm-archive' \
      -cf - . | tar -C "$ALTAI_DIR" -xf -
else
  echo "    zaten yerinde"
fi
chown -R "$RUN_USER:$RUN_GROUP" "$ALTAI_DIR"

say "3/5 agent bağımlılıkları"
# Sadece agent ve bağımlı olduğu workspace paketleri kurulur (web/bot gereksiz).
sudo -u "$RUN_USER" env HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)" \
  pnpm --dir "$ALTAI_DIR" install --frozen-lockfile --filter '@altai/agent...'
TSX_BIN="$ALTAI_DIR/apps/agent/node_modules/.bin/tsx"
[[ -x "$TSX_BIN" ]] || die "tsx bulunamadı ($TSX_BIN) — pnpm install başarısız olmuş olabilir"

say "4/5 env dosyası"
mkdir -p /etc/altai
chmod 750 /etc/altai
ENV_FILE="/etc/altai/agent-$SLUG.env"
if [[ -e "$ENV_FILE" ]]; then
  echo "    $ENV_FILE zaten var — DOKUNULMADI"
else
  sed -e "s|^SERVER_SLUG=.*|SERVER_SLUG=$SLUG|" \
      -e "s|^SQUADJS_VENDOR_ENTRY=.*|SQUADJS_VENDOR_ENTRY=$ALTAI_DIR/packages/squad/vendor/agent-entry/index.js|" \
      "$ALTAI_DIR/infra/setup/agent.env.example" > "$ENV_FILE"
  chown root:"$RUN_GROUP" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "    oluşturuldu: $ENV_FILE (şifreleri DOLDURUN)"
fi

say "5/5 systemd"
sed -e "s|__RUN_USER__|$RUN_USER|" \
    -e "s|__RUN_GROUP__|$RUN_GROUP|" \
    -e "s|__ALTAI_DIR__|$ALTAI_DIR|g" \
    "$ALTAI_DIR/infra/setup/altai-agent@.service" > /etc/systemd/system/altai-agent@.service
systemctl daemon-reload
echo "    altai-agent@.service kuruldu (henüz başlatılmadı)"

cat <<EOF

Kurulum bitti. Sıradaki adımlar:

  1. Şifreleri doldurun:
       sudoedit $ENV_FILE
     (DATABASE_URL, AGENT_SHARED_SECRET, RCON_PASSWORD, SQUAD_LOG_DIR)

  2. Ön kontrol — servisi açmadan önce her bağımlılığı doğrular:
       $ALTAI_DIR/infra/setup/preflight.sh $ENV_FILE

  3. Hepsi yeşilse başlatın:
       systemctl enable --now altai-agent@$SLUG
       journalctl -u altai-agent@$SLUG -f

İkinci sunucu için aynı script'i farklı slug ile çalıştırın:
  sudo $ALTAI_DIR/infra/setup/install-agent.sh --slug squad-02 --user $RUN_USER
EOF
