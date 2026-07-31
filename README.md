# Altai v2 — Faz 0 İskeleti

Bu, Altai Core System v2 planının **Faz 0** iskeletidir: monorepo + CI + Docker
Compose (PG + Caddy) + `packages/db` iskeleti + auth iskeleti (Discord OAuth +
break-glass) + temel config/logger.

## Yapı

```
apps/
  web/        Next.js (App Router) — login/logout + break-glass form
  api/        Fastify 5 — Discord OAuth, session, break-glass, /health
  agent/      Faz 1'de SquadJS entegrasyonu gelecek, şimdilik boş
  bot/        discord.js iskeleti, token yoksa bağlanmadan durur
packages/
  db/         Drizzle şeması (players, users, role_mappings, sessions)
              + tek seferlik bootstrap-admin seed script'i
  contracts/  Zod şemaları: izin enum'u, agent<->api event/komut tipleri
  squad/      Faz 1'e kadar boş — SquadJSAdapter buraya gelecek
  shared/     logger (pino), config loader (Zod), hata tipleri, password hashing
tools/
  bm-export/     Faz 1'de BattleMetrics ham arşiv çekimi buraya yazılacak
  hash-password/ break-glass şifresi için hash üretme CLI'ı
infra/
  compose/    docker-compose.yml + Caddyfile
```

## İlk çalıştırma

```bash
cp .env.example .env      # değerleri doldur
pnpm install
docker compose -f infra/compose/docker-compose.yml up -d postgres
pnpm db:generate
pnpm db:migrate
```

### İlk admin nasıl oluşur? (role_mappings başta boş)

`role_mappings` tablosu başlangıçta boştur — hiçbir Discord rolü hiçbir izne
sahip değildir, o yüzden ilk kurulumda kimse panelde bir şey yapamaz. İki yol var:

**A) Discord üzerinden (önerilen, kalıcı çözüm)**
```bash
BOOTSTRAP_DISCORD_ROLE_ID=<discord-rol-id> pnpm db:seed:bootstrap-admin
```
Bu, verilen Discord rolünü `super_admin` + tüm izinlerle eşler. O rolü taşıyan
biri Discord ile giriş yapınca tam yetkili olur ve artık `role_mappings`'i
panelden (Faz 2'de gelecek) yönetebilir.

**B) Break-glass hesabı (Discord'dan tamamen bağımsız, acil durum için)**
```bash
pnpm hash-password 'seçtiğin-şifre'
# çıktıyı .env'e yapıştır:
# BREAK_GLASS_USER=admin
# BREAK_GLASS_PASSWORD_HASH=scrypt$...$...
```
Web'de "Discord kullanılamıyor mu?" linkinden bu bilgilerle giriş yapılabilir;
otomatik olarak `super_admin` + tüm izinlerle bir session açılır
(`sessions.is_break_glass = true` ile işaretlenir, denetim için).

```bash
pnpm dev
```

## Faz 0 milestone durumu

- [x] Discord OAuth token exchange (`@fastify/oauth2`)
- [x] Discord guild rollerini çek, `role_mappings` ile eşleştir, izinleri
      session'a yaz (login-anı senkron — bkz. aşağıdaki not)
- [x] `users` upsert + opak session token + HttpOnly cookie
- [x] `role_mappings` bootstrap seed script'i (`pnpm db:seed:bootstrap-admin`)
- [x] Break-glass süper admin girişi (`/auth/break-glass` + web formu +
      `pnpm hash-password` CLI'ı)
- [x] `apps/web`'de login/logout + break-glass formu + `/auth/me` ile oturum
      kontrolü (systemRole + permissions dahil)
- [ ] Gerçek bir Discord app + guild ile uçtan uca test edilmedi (bu ortamda
      Discord kimlik bilgisi yok, sizin `.env`'inizle denemeniz gerekiyor)

### Bilerek basit bırakılanlar (Faz 0 kapsamı dışı)
- Discord rol senkronu sadece login anında oluyor (session'a snapshot olarak
  yazılıyor); `guildMemberUpdate` ile anlık senkron Faz 3'te bot'a taşınacak
  (plan Bölüm 8) — o zamana kadar rol değişikliği için tekrar giriş gerekir
- `role_mappings` panelden düzenleme UI'ı yok (Faz 2'de web panelinde gelecek);
  şimdilik doğrudan SQL veya bootstrap script ile yönetiliyor

Bundan sonrası (Faz 1: SquadJSAdapter + PersistenceWriter + bm-export) plandaki
Bölüm 7'de tarif edildiği gibi devam eder.

## Eski sistemle hizalanan bağımlılık sürümleri

Eski (v1) Altai kod tabanı incelenip, v2'de de kullanılan paketlerin
sürümleri production'da kanıtlanmış olanlarla hizalandı:
- `discord.js`: `^14.14.1` (hem eski `discordBot.js` hem vendored SquadJS
  fork'u bu sürümü kullanıyor, `package-lock.json`'da da bu çözümleniyor)
- `ws`: `^8.18.3` (eski sistemde `socket.io`'nun transitive bağımlılığı
  olarak bu sürüm çözümleniyor)

Not: Eski sistem Express + MongoDB + kullanıcı adı/şifre login (`WebUser`)
kullanıyor — bunlar v2'de bilerek kaldırılan/değiştirilen parçalar (plan
Bölüm 8), o yüzden versiyon hizalaması sadece gerçekten örtüşen paketler
için yapıldı; mimari farklar korunuyor.

## Doğrulama durumu (bu zip için)

`pnpm install`, `pnpm lint` (Biome) ve `pnpm typecheck` (10/10 paket) bu
haliyle hatasız geçiyor. `pnpm-lock.yaml` dahil edildi, aynı sürümlerle kurulum
yapılır. Discord/Postgres bağlantısı gerektiren uçtan uca akış (`pnpm dev` +
gerçek giriş) bu ortamda test edilmedi.
