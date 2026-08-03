# Altai v2 — Faz 0 + Faz 1 İskeleti

Bu, Altai Core System v2 planının **Faz 0** (monorepo + CI + Docker Compose +
auth) ve **Faz 1** (SquadJSAdapter + PersistenceWriter + agent↔api WS +
canlı sunucu durumu + bm-export) iskeletidir.

## Yapı

```
apps/
  web/        Next.js (App Router) — login/logout + break-glass form +
              canlı sunucu durumu widget'ı (WS)
  api/        Fastify 5 — Discord OAuth, session, break-glass, /health,
              /agent-ws (agent bağlantısı), /ws (tarayıcı yayını), /servers
  agent/      SquadJSAdapter'ı motor olarak kullanır (şimdilik dev-fixture),
              PersistenceWriter (doğrudan Postgres'e batch yazım),
              uplink (api'ye kalıcı WS)
  bot/        discord.js iskeleti, token yoksa bağlanmadan durur
packages/
  db/         Drizzle şeması: identity (players, users, role_mappings,
              sessions) + presence (servers, game_sessions,
              server_snapshots, raw_events) + bootstrap-admin seed script'i
  contracts/  Zod şemaları: izin enum'u, agent event'leri, agent<->api
              WS protokolü (hello/event/command)
  squad/      SquadJSEngine arayüzü + SquadJSAdapter + dev-fixture-engine
              (gerçek Squad sunucusu olmadan uçtan uca test için) +
              real-engine-adapter.ts (gerçek SquadServer'ı sarar)
              vendor/   Ported gerçek SquadJS (core + squad-server + agent-entry) —
                        gerçek RCON/log-parser, çalışır durumda
  shared/     logger (pino), config loader (Zod), hata tipleri, password hashing
tools/
  bm-export/     BattleMetrics ham arşiv çekimi — cursor pagination +
                 429 rate-limit backoff + resume desteği (players, bans)
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

### Faz 1'i fixture ile deneme (gerçek Squad sunucusu olmadan)

Agent'ı ayrı bir `.env` ile (oyun sunucusu host'unu simüle ederek) çalıştırın:

```bash
# apps/agent için gerekenler: DATABASE_URL, AGENT_API_WS_URL,
# AGENT_SHARED_SECRET (api'deki ile aynı), SERVER_SLUG, AGENT_ENGINE=fixture (varsayılan)
pnpm --filter @altai/agent dev
```

`AGENT_ENGINE=fixture` (varsayılan) olduğunda gerçek SquadJS yerine sahte oyuncu
connect/disconnect/chat eventleri üreten bir fixture motor devreye girer.
Bu, agent → adapter → PersistenceWriter (Postgres'e yazım) → uplink →
api → tarayıcı WS zincirinin tamamını gerçek bir Squad sunucusu olmadan
uçtan uca test etmeyi sağlar. Ana sayfadaki "Canlı sunucu durumu" kutusunda
birkaç saniye içinde sahte oyuncular görünmeye başlar.

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

## Faz 1 milestone durumu

- [x] SquadJSAdapter — ham SquadJS eventlerini (`PLAYER_CONNECTED`,
      `PLAYER_DISCONNECTED`, `CHAT_MESSAGE`) Zod ile tipli `AgentEvent`'e
      çevirir + 60 sn'de bir `SERVER_SNAPSHOT` üretir
- [x] PersistenceWriter — raw_events batch insert (2 sn/200 kayıt), player
      upsert (EOS çakışması tarihçeye yazılır), game_sessions aç/kapa,
      server_snapshots
- [x] Reconciler (crash sonrası açık kalan session'ları 4 saat üst sınırıyla
      kapatır) + graceful shutdown (SIGTERM/SIGINT'te açık session'ları kapatır)
- [x] agent → api kalıcı WS (`uplink.ts`, auto-reconnect + üstel geri çekilme)
      + hello handshake (`AGENT_SHARED_SECRET` ile doğrulama)
- [x] api'de in-memory sunucu durumu + `/ws` ile tarayıcıya canlı yayın +
      `/servers` REST fallback
- [x] Web'de canlı sunucu durumu widget'ı (oyuncu sayısı + liste, WS ile,
      F5 gerekmez)
- [x] `dev-fixture-engine` — gerçek SquadJS olmadan tüm zinciri test etme
- [x] `tools/bm-export` — players + bans için cursor pagination + 429
      rate-limit backoff + resume (yarıda kesilirse kaldığı yerden devam eder)
- [x] **Gerçek SquadJS entegrasyonu — porting tamamlandı.** Vendored fork'unuz
      (`squad-server/core` + `squad-server/squad-server`) `packages/squad/vendor/`
      altına taşındı ve gerçekten çalışır durumda:
      - `core`/`squad-server` gerçek pnpm workspace paketleri (bare `core/...`
        import'ları `exports` map'iyle çözülüyor, uydurma değil)
      - `loadAdminsFromDB` (Mongo) kaldırıldı → boş liste dönen stub (RBAC
        bağlantısı Faz 2)
      - `pingSquadJSAPI()` telemetrisi tamamen silindi
      - admin-cam süre kurtarmanın DB katmanı no-op (tablo Faz 6'da geliyor),
        in-memory katman + "kayıp session" fallback'i duruyor
      - ftp/sftp log reader'ları hiç yok (v2 her zaman lokal tail kullanır)
      - ölü kod (`fob-created` rule) atıldı, plan Bölüm 6'daki karara uygun
      - **Doğrulama**: `node --check` ile tüm dosyalar sözdizimi temiz;
        gerçek `import('squad-server')` zinciri (core → rcon/log-parser/layers)
        çalışıyor; sahte bir `SquadGame.log` ile gerçek `new SquadServer()` +
        tüm alt sınıfların (RCON, LogParser, Layers) kurulumu uçtan uca test
        edildi ve geçti — sadece statik analiz değil, gerçek çalışma zamanı testi.
      - `packages/squad/vendor/agent-entry/` bu motoru `SQUADJS_VENDOR_ENTRY`
        sözleşmesine uygun şekilde kurup `watch()` eden gerçek giriş noktası
      - **Test edilmeyen tek şey**: gerçek bir Squad oyun sunucusuna karşı
        çalıştırmak (RCON bağlantısı, gerçek log satırları) — bu ortamda
        böyle bir sunucu yok
      - 4 özel event (`PLAYER_ROLE_CHANGE`, `PLAYER_NOW_IS_LEADER/NOT_LEADER`,
        sentetik `UNPOSSESSED_ADMIN_CAMERA`) henüz `SquadJSEngine` arayüzüne
        dahil değil (Faz 1 minimal kapsamı sadece connect/disconnect/chat/
        snapshot) — plugin sistemi (Faz 3) bunları kullanmaya başlayınca
        arayüze eklenmesi gerekecek
- [ ] RCON komutları (kick/ban/warn/broadcast/setLayer/restart) — protokol
      tanımlı (`AgentCommand`), agent tarafında sadece loglanıyor, gerçek
      `rconExecute` çağrısı yok (Faz 2/3'te UI ile birlikte gelecek)
- [ ] `notes/flags/reserved-slot/server-history` BM export uçları eklenmedi —
      players/bans deseni doğrulandı, aynı `exportBmResource()` fonksiyonuyla
      genişletilmesi kolay ama BM'nin org-scoped API dokümantasyonundan
      doğrulanması gerekiyor
- [ ] Gerçek bir Postgres + agent + BM token ile uçtan uca test edilmedi (bu
      ortamda yok); `AGENT_ENGINE=fixture` ile agent→api→web zinciri
      test edilebilir durumda, ama gerçek DB'ye yazım sizin ortamınızda
      doğrulanmalı

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
yapılır. Discord/Postgres/gerçek Squad sunucusu bağlantısı gerektiren uçtan
uca akışlar (`pnpm dev` + gerçek giriş, gerçek agent→DB yazımı) bu ortamda
test edilmedi — sadece statik analiz (tip + lint) doğrulandı.
