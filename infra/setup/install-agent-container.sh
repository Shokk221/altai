#!/usr/bin/env bash
# Altai v2 agent kurulumu — OYUN KONTEYNERİ İÇİN (Altai barındırma ortamı).
#
# Bu, systemd'li düz bir Linux sunucusu DEĞİL. Ortamın gerçekleri
# (178.63.113.47 üzerinde ölçüldü):
#
#   * systemd YOK — PID 1 bash. Servis birimi kuramayız, kendi süpervizörümüzü
#     yazarız.
#   * SADECE /data kalıcı. apt/npm -g ile kurulan her şey `update` sonrası
#     silinir → kurulum /data içine, tetikleme /data/bootstrap.sh'e.
#   * localhost KAPALI. 127.0.0.1:21114 "connection refused" veriyor ama
#     178.63.113.47:21114 çalışıyor — konteyner host ağını paylaşıyor ve
#     loopback diğer müşterileri korumak için filtrelenmiş.
#   * Node v20 kurulu (v22 değil), pnpm yok ama corepack var.
#
# Kullanım (konteyner içinde, `ssh altai shell` ile girdikten sonra):
#   bash /data/altai/infra/setup/install-agent-container.sh
#
# Tekrar tekrar çalıştırılabilir.

set -euo pipefail

ALTAI_DIR="${ALTAI_DIR:-/data/altai}"
ENV_DIR="${ENV_DIR:-/data/altai-env}"

die() { echo "HATA: $*" >&2; exit 1; }
say() { printf '\033[36m==>\033[0m %s\n' "$*"; }

[[ -d /data ]] || die "/data yok — bu script oyun konteynerinde çalıştırılmalı"
[[ -f "$ALTAI_DIR/pnpm-workspace.yaml" ]] || die "depo $ALTAI_DIR içinde değil (önce git clone)"

say "1/4 çalışma zamanı"
command -v node >/dev/null || die "node yok"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || die "node v$NODE_MAJOR — en az v20 gerekli"
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || die "corepack ile pnpm etkinleştirilemedi"
fi
# pnpm store'u /data içinde tut, yoksa `update` sonrası tüm paketler gider.
export PNPM_HOME="/data/.pnpm"
pnpm config set store-dir /data/.pnpm-store --global >/dev/null 2>&1 || true
echo "    node $(node -v), pnpm $(pnpm -v)"

say "2/4 bağımlılıklar (/data içine, kalıcı)"
pnpm --dir "$ALTAI_DIR" install --frozen-lockfile --filter '@altai/agent...'
TSX_BIN="$ALTAI_DIR/apps/agent/node_modules/.bin/tsx"
[[ -x "$TSX_BIN" ]] || die "tsx bulunamadı ($TSX_BIN)"

say "3/4 env dosyaları"
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
for slug in squad-01 squad-02; do
  ENV_FILE="$ENV_DIR/agent-$slug.env"
  if [[ -e "$ENV_FILE" ]]; then
    echo "    $ENV_FILE zaten var — dokunulmadı"
  else
    sed -e "s|^SERVER_SLUG=.*|SERVER_SLUG=$slug|" \
        -e "s|^SQUADJS_VENDOR_ENTRY=.*|SQUADJS_VENDOR_ENTRY=$ALTAI_DIR/packages/squad/vendor/agent-entry/index.js|" \
        "$ALTAI_DIR/infra/setup/agent.env.example" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "    oluşturuldu: $ENV_FILE"
  fi
done

say "4/4 bootstrap kancası"
BOOT_LINE="bash $ALTAI_DIR/infra/setup/agent-supervisor.sh start-all"
if grep -qF "$BOOT_LINE" /data/bootstrap.sh 2>/dev/null; then
  echo "    /data/bootstrap.sh zaten çağırıyor"
else
  # Mevcut bootstrap.sh'in üstüne yazmıyoruz, sonuna ekliyoruz.
  printf '\n# --- Altai v2 agent (otomatik eklendi) ---\n%s\n' "$BOOT_LINE" >> /data/bootstrap.sh
  chmod +x /data/bootstrap.sh
  echo "    /data/bootstrap.sh sonuna eklendi"
fi

cat <<EOF

Kurulum bitti.

Sıradaki adımlar:
  1. Env dosyalarını doldurun (DATABASE_URL, AGENT_SHARED_SECRET, RCON_PASSWORD):
       nano $ENV_DIR/agent-squad-01.env

     DİKKAT: RCON_HOST=127.0.0.1 ÇALIŞMAZ (bu ortamda loopback kapalı).
             RCON_HOST=178.63.113.47 kullanın.

  2. Ön kontrol:
       bash $ALTAI_DIR/infra/setup/preflight.sh $ENV_DIR/agent-squad-01.env

  3. Elle başlat / durdur / durum:
       bash $ALTAI_DIR/infra/setup/agent-supervisor.sh start squad-01
       bash $ALTAI_DIR/infra/setup/agent-supervisor.sh status
       bash $ALTAI_DIR/infra/setup/agent-supervisor.sh stop squad-01

Konteyner her yeniden yaratıldığında bootstrap.sh agent'ları otomatik başlatır.
EOF
