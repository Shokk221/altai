#!/usr/bin/env bash
# Panel konteynerinde deploy — kod çekildikten sonra çalıştırılır.
#
#   bash /app/deploy/deploy.sh
#
# Sırayla: bağımlılıklar -> veritabanı şeması -> web build -> supervisord.
#
# Neden script: `git pull` sonrası restart etmek YETMEZ. Next.js önceden
# build edilmiş çıktıyı sunuyor, yani build atlanırsa panel eski arayüzü
# sunmaya devam eder — hata vermeden. Migration atlanırsa api açılışta
# patlar. Bu adımların sırası ve tamamı önemli.

set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
say() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { echo "HATA: $*" >&2; exit 1; }

cd "$APP_DIR" || die "$APP_DIR yok"
[[ -f pnpm-workspace.yaml ]] || die "$APP_DIR depo kökü değil"

say "0/5 ortam kontrolü"
command -v node >/dev/null || die "node yok"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || die "node v$NODE_MAJOR — en az v20 gerekli"
if ! command -v pnpm >/dev/null 2>&1; then
  say "    pnpm yok, corepack ile etkinleştiriliyor"
  corepack enable
fi
# DATABASE_URL'i konteyner sağlıyor; .env'de OLMAMALI (bkz. deploy/README.md).
[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL ortamda yok — konteyner içinde misiniz?"
if [[ -f "$APP_DIR/.env" ]] && grep -qE '^DATABASE_URL=' "$APP_DIR/.env"; then
  die ".env içinde DATABASE_URL var — silin, konteynerinki kullanılmalı"
fi
echo "    node $(node -v), pnpm $(pnpm -v)"

say "1/5 bağımlılıklar"
pnpm install --frozen-lockfile

say "2/5 veritabanı şeması"
pnpm db:migrate

say "3/5 web build"
# NEXT_PUBLIC_* değişkenleri build anında gömülür, o yüzden .env burada yüklenir.
if [[ -f "$APP_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP_DIR/.env"
  set +a
fi
pnpm --filter @altai/web build

say "4/5 supervisord tanımları"
# Sağlayıcının supervisord'u /app/deploy/supervisor/*.conf dosyalarını okuyor.
supervisorctl reread
supervisorctl update

say "5/5 servisleri yeniden başlat"
# api önce: web ve bot ona bağlı.
supervisorctl restart api
supervisorctl restart web
supervisorctl restart bot

echo
supervisorctl status
echo
cat <<'EOF'
Doğrulama:
  curl -fsS localhost:3001/health     # api ayakta mı
  curl -fsSI localhost:3000 | head -1 # web cevap veriyor mu
  supervisorctl tail -f api           # canlı log
EOF
