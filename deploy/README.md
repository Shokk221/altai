# Panel konteyneri kurulumu

Barındırma sağlayıcısının teslim ettiği `altai-panel` konteyneri için.
Yönetim: `ssh altai panel <komut>` (menüde 8. sıra).

Sağlayıcı şunları kurdu ve **onlar yönetiyor**: Node 22.23.2, PostgreSQL 16.14
(sadece `127.0.0.1`), supervisord, gecelik `pg_dump` yedeği (14 gün), Caddy +
TLS. Bize düşen: kod, üç süreç tanımı, sırlar.

## İlk kurulum

```bash
ssh altai panel                    # konteynerde root shell, kod dizini /app
cd /app
git clone git@github.com:Shokk221/altai.git .

cp deploy/env.example .env
chmod 600 .env
nano .env                          # sırları doldur (aşağıya bakın)

bash deploy/deploy.sh
```

`deploy.sh` sırayla: bağımlılıklar → migration → web build → supervisord
yeniden yükleme → servisleri başlatma.

> **Önce GitHub deploy anahtarı eklenmeli** — sağlayıcının verdiği
> `altai-panel-deploy` açık anahtarını repo Settings → Deploy keys'e ekleyin.
> Eklemeden `git clone` `Permission denied (publickey)` verir.

## Sırlar nerede duruyor

`/app/.env` — gitignore'da, ama `/app` host diskine bağlı olduğu için kalıcı.
`rebuild` ve `restart` silmez.

**`DATABASE_URL`'i .env'e YAZMAYIN.** Konteyner onu zaten ortamda veriyor
(`echo $DATABASE_URL`) ve supervisord alt süreçlere aktarıyor. İkisinde birden
tanımlı olursa hangisinin kazandığı belirsizleşir; `deploy.sh` bunu yakalar
ve durur.

## Süreçler

Tanımlar `deploy/supervisor/*.conf` — kodun içinde, yani kalıcı ve
sürüm kontrollü.

| Süreç | Port | Öncelik | Notu |
|---|---|---|---|
| `api` | 3001 | 10 | Veritabanına yazan tek süreç |
| `web` | 3000 | 20 | Next.js, **önceden build edilmiş** çıktıyı sunar |
| `bot` | — | 30 | Sadece dışarı bağlanır |

```bash
supervisorctl status
supervisorctl restart api          # tek süreç; postgres etkilenmez
supervisorctl tail -f api
```

### İki tuzak

**`git pull` sonrası sadece restart YETMEZ.** `next start` önceden build
edilmiş çıktıyı sunar — build atlanırsa panel eski arayüzü sunmaya devam
eder, hata da vermez. Her kod güncellemesinden sonra `deploy/deploy.sh`.

**`NEXT_PUBLIC_*` değişkenleri build anında gömülür.** Adresi değiştirdiyseniz
restart değil, yeniden deploy gerekir.

## İlk admin

`role_mappings` başta boş — kimsenin yetkisi yok. İki yol:

```bash
# A) Discord rolü üzerinden (kalıcı çözüm)
cd /app && BOOTSTRAP_DISCORD_ROLE_ID=<rol-id> pnpm db:seed:bootstrap-admin

# B) Break-glass (Discord'dan bağımsız acil giriş)
cd /app && pnpm hash-password 'sectigin-sifre'
# çıktıyı /app/.env içine BREAK_GLASS_PASSWORD_HASH olarak yapıştır, sonra:
supervisorctl restart api
```

## Doğrulama

DNS (`panel.altaisquad.com → 178.63.113.47`) eklenene kadar dışarıdan
erişilemez, ama konteyner içinden test edilebilir:

```bash
curl -fsS localhost:3001/health
curl -fsSI localhost:3000 | head -1
psql "$DATABASE_URL" -c '\dt'        # 14 tablo görünmeli
```

DNS geldikten sonra:

```bash
curl -fsS https://panel.altaisquad.com/api/health
```

## Güncelleme

```bash
cd /app && git pull
bash deploy/deploy.sh
```

## Yedekleme

Sağlayıcı hallediyor: her gece 04:30, `pg_dump`, 14 gün,
`/backups/altaipanel-<tarih>.sql.gz`.

Geri yükleme:
```bash
zcat /backups/altaipanel-<tarih>.sql.gz | psql "$DATABASE_URL"
```

Plan Bölüm 8 ayrıca **host dışına kopya** ve **3 ayda bir restore tatbikatı**
istiyor — ikisi de henüz yok, kurulum oturunca eklenmeli.

## Agent tarafı

Oyun sunucusundaki agent bu panele bağlanır:
`wss://panel.altaisquad.com/agent-ws`. `AGENT_SHARED_SECRET` iki tarafta da
aynı olmalı. Kurulumu: [infra/setup/README.md](../infra/setup/README.md).
