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
# Depo dizinine geçmek ŞART. Corepack pnpm sürümünü ÇALIŞMA DİZİNİNDEKİ
# package.json'ın "packageManager" alanından okur — `pnpm --dir X` yetmez.
# Dışarıdan çağrılınca alanı göremiyor, en son pnpm'i (Node 22 isteyen,
# node:sqlite kullanan 11.x) indiriyor ve konteynerin Node 20'sinde patlıyor.
cd "$ALTAI_DIR"
if ! command -v pnpm >/dev/null 2>&1; then
  # Prompt'suz: corepack indirme onayı sorarsa kurulum askıda kalır.
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  corepack enable >/dev/null 2>&1 || die "corepack ile pnpm etkinleştirilemedi"
fi
# pnpm store'u /data içinde tut, yoksa `update` sonrası tüm paketler gider.
export PNPM_HOME="/data/.pnpm"
pnpm config set store-dir /data/.pnpm-store --global >/dev/null 2>&1 || true
echo "    node $(node -v), pnpm $(pnpm -v)"

say "2/4 bağımlılıklar (/data içine, kalıcı)"
# --prod=false ŞART. Ortamda NODE_ENV=production varsa pnpm
# devDependencies'i atlıyor — ama agent TypeScript'i doğrudan tsx ile
# çalıştırdığı için tsx bir RUNTIME bağımlılığı. Panel kurulumunda tam bu
# yüzden "tsx: not found" alınmıştı.
# pnpm'i DEPONUN SAHİBİ olarak çalıştırıyoruz.
#
# Sebep: pnpm paketleri mağazadan sabit bağ (hardlink) ile kuruyor ve bağ,
# mağazadaki dosyanın sahipliğini taşıyor. Mağaza `linuxgsm` kullanıcısına
# ait; biz root olarak kurunca pnpm bin dosyalarına chmod atmaya çalışıyor ve
# bu konteyner kullanıcı ad alanında olduğu için "EPERM: operation not
# permitted" alıyor — root olmamıza rağmen. Dosyayı silip yeniden kurmak da
# çözmüyor, çünkü yeni bağ yine aynı inode'a düşüyor.
SAHIP="$(stat -c '%U' "$ALTAI_DIR")"
KURULUM=(pnpm install --frozen-lockfile --prod=false --filter '@altai/agent...')
if [[ "$SAHIP" != "$(id -un)" ]] && id "$SAHIP" >/dev/null 2>&1; then
  echo "    pnpm '$SAHIP' kullanıcısıyla çalıştırılıyor (depo sahibi)"
  su -s /bin/bash "$SAHIP" -c \
    "cd '$ALTAI_DIR' && export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 && ${KURULUM[*]}"
else
  "${KURULUM[@]}"
fi
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
    # RCON parolasını elle girmeye gerek yok: Squad'ın kendi Rcon.cfg'si
    # tek doğru kaynak. Elle yazınca yanlış parola giriliyor ve teşhisi zor
    # bir hataya dönüşüyor — sunucu TCP'yi kabul edip auth sonrası soketi
    # sessizce kapatıyor, SquadJS ise "Authentication succeeded" yazıyor.
    RCON_CFG=/data/serverfiles/SquadGame/ServerConfig/Rcon.cfg
    if [[ -r "$RCON_CFG" ]]; then
      RCON_PW="$(sed -n 's/\r$//; s/^Password=//p' "$RCON_CFG" | head -1)"
      RCON_PORT_CFG="$(sed -n 's/\r$//; s/^Port=//p' "$RCON_CFG" | head -1)"
      if [[ -n "$RCON_PW" ]]; then
        # sed ayracını bozabilecek karakterleri kaçır.
        ESC="$(printf '%s' "$RCON_PW" | sed -e 's/[\/&|]/\\&/g')"
        sed -i "s|^RCON_PASSWORD=.*|RCON_PASSWORD=$ESC|" "$ENV_FILE"
        echo "    RCON parolası Rcon.cfg'den alındı (${#RCON_PW} karakter)"
      fi
      if [[ -n "$RCON_PORT_CFG" ]]; then
        sed -i "s|^RCON_PORT=.*|RCON_PORT=$RCON_PORT_CFG|" "$ENV_FILE"
      fi
    fi
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
  # Dosya barındırıcıya ait; chmod "Operation not permitted" veriyor. Zaten
  # çalıştırılabilir olduğu için bu ölümcül değil — kurulumu düşürmesin.
  chmod +x /data/bootstrap.sh 2>/dev/null || true
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
