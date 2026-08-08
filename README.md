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
              /agent-ws (agent bağlantısı + KALICI YAZIM), /ws (tarayıcı
              yayını), /servers. Veritabanına yazan TEK yer.
  agent/      SquadJSAdapter'ı motor olarak kullanır, uplink (api'ye kalıcı WS)
              + spool (bağlantı kopukken diske kuyruk). Postgres'e ERİŞMEZ.
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
  bm-export/     BattleMetrics ham arşiv çekimi (bkz. aşağıdaki bölüm) —
                 sunucular, oyuncular, session'lar, banlar, ban listeleri,
                 flag tanımları + atamaları, notlar, reserved slot'lar,
                 sunucu geçmişi. Devam edilebilir, --probe ile önden doğrulanır
  hash-password/ break-glass şifresi için hash üretme CLI'ı
deploy/       panel konteyneri: supervisord tanımları (api/web/bot),
              deploy.sh, env örneği, rehber
infra/
  compose/    docker-compose.yml + Caddyfile (yerel geliştirme)
  setup/      oyun sunucusuna agent kurulumu: konteyner ortamı için
              install-agent-container.sh + agent-supervisor.sh,
              düz Linux VM için install-agent.sh + systemd unit,
              her ikisi için preflight.sh (kurulum öncesi doğrulama)
```

## Dağıtım mimarisi (üretim)

```
┌─ OYUN KONTEYNERİ ────────────┐        ┌─ PANEL KONTEYNERİ ───────────┐
│ agent (× sunucu sayısı)      │        │ postgres (SADECE loopback)   │
│  ├─ SquadGame.log lokal tail │        │ api      ─ DB'ye yazan tek yer│
│  ├─ RCON 178.63.113.47:21114 │  WSS   │ web                          │
│  └─ spool (/data, kesintide) ├───────>│ bot                          │
└──────────────────────────────┘        │ 4'ünü supervisord yönetir    │
                                        └──────────────────────────────┘
```

**Agent Postgres'e erişmez.** Kalıcı veri de tek bir WS üzerinden api'ye gider.
İki sebebi var: Postgres ağa hiç açılmaz (api ile aynı konteynerde, yalnızca
`127.0.0.1`), ve oyun sunucusundaki bir süreç veritabanı kimlik bilgisi
taşımaz. Bağlantı koptuğunda eventler diske spool edilir ve bağlantı gelince
sırayla gönderilir — panel saatlerce kapalı kalsa da veri kaybolmaz.

Kurulum: [deploy/README.md](deploy/README.md) (panel konteyneri) ve
[infra/setup/README.md](infra/setup/README.md).

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
      server_snapshots. **api'de çalışır** (başta agent'taydı; tek konteyner
      kararıyla taşındı, bkz. "Dağıtım mimarisi")
- [x] Agent spool — bağlantı kopukken eventler diske yazılır, gelince sırayla
      gönderilir. Sıra korunur, yarıda kesilme kaldığı yerden sürer, üst sınır
      dolunca kesintinin BAŞI korunur. 8 test
- [x] Reconciler (crash sonrası açık kalan session'ları 4 saat üst sınırıyla
      kapatır) hello anında api'de çalışır + agent düzgün kapanışta `shutdown`
      mesajı gönderir, api açık session'ları gerçek zamanla kapatır.
      WS'in kopması tek başına session kapatmaz (geçici kesinti de aynı görünür)
- [x] agent → api kalıcı WS (`uplink.ts`, auto-reconnect + üstel geri çekilme)
      + hello handshake (`AGENT_SHARED_SECRET` ile doğrulama)
- [x] api'de in-memory sunucu durumu + `/ws` ile tarayıcıya canlı yayın +
      `/servers` REST fallback
- [x] Web'de canlı sunucu durumu widget'ı (oyuncu sayısı + liste, WS ile,
      F5 gerekmez)
- [x] `dev-fixture-engine` — gerçek SquadJS olmadan tüm zinciri test etme
- [x] `tools/bm-export` — tam BM arşivi (aşağıdaki bölüm)
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
- [x] `tools/bm-export` tamamlandı — notes/flags/reserved-slots/sessions/
      server-history uçları dahil (bkz. "BattleMetrics arşivi" bölümü)
- [ ] Gerçek bir Postgres + agent + BM token ile uçtan uca test edilmedi (bu
      ortamda yok); `AGENT_ENGINE=fixture` ile agent→api→web zinciri
      test edilebilir durumda, ama gerçek DB'ye yazım sizin ortamınızda
      doğrulanmalı

## BattleMetrics arşivi (`tools/bm-export`) — plan Bölüm 5.5-A

> **BM aboneliği, kritik kaynaklar arşivlenmeden İPTAL EDİLMEZ.** Bu projedeki
> tek geri dönüşü olmayan iş budur: kod her zaman yeniden yazılabilir, iptal
> edilmiş bir BM aboneliğinin ardındaki notlar ve flag'ler geri gelmez.

### Sıra

```bash
# 1) Uçları yokla — hiçbir şey indirmez, ~20 saniye sürer.
pnpm bm:probe

# 2) Oyuncuları çek (per-player uçları bu listeye dayanır).
pnpm bm:export -- --only players

# 3) Tekrar yokla: artık notlar/flag atamaları da örnek bir oyuncuyla test edilir.
pnpm bm:probe

# 4) Tam arşiv. Saatler sürebilir; Ctrl+C serbest, tekrar çalıştırınca devam eder.
pnpm bm:export

# 5) Durum raporu (token gerektirmez).
pnpm bm:report
```

`--probe` çıktısındaki **kritik** işaretli her kaynak `✓ OK` olmalı. Değilse
token'ın org sahibi bir hesaba ait olduğunu ve BM planınızın o özelliği
kapsadığını doğrulayın (flag'ler ve notlar Premium/RCON aboneliği ister).

### Neler arşivleniyor

| Kaynak | BM ucu | Kritik |
|---|---|---|
| `servers` | `/servers/{id}` | evet |
| `players` | `/players?filter[servers]=…&include=identifier,server` | evet |
| `sessions` | `/sessions?filter[servers]=…` | evet |
| `bans` | `/bans?filter[organization]=…&filter[expired]=true` | evet |
| `ban-lists` | `/ban-lists` | evet |
| `bans-native` | `/bans-native` | hayır |
| `player-flags` | `/player-flags` (tanımlar) | evet |
| `player-flag-assignments` | `/players?filter[playerFlags]=…&include=flagPlayer` | evet |
| `player-notes` | `/players/{id}/relationships/notes` | evet |
| `reserved-slots` | `/reserved-slots?filter[organization]=…` | evet |
| `player-queries` | `/player-queries` | hayır |
| `player-count-history` vb. | `/servers/{id}/…-history` (ay ay) | hayır |
| `outages`, `leaderboard-time` | `/servers/{id}/relationships/…` | hayır |

Bilinçli olarak atlanan: **coplay** — `/players/{id}/relationships/coplay`
oyuncu başına ayrı istek gerektiriyor ve aynı bilgi kesişen session
aralıklarından SQL ile türetilebiliyor (plan Bölüm 5).

### Çıktı formatı

```
bm-archive/
  manifest.json              her kaynağın durumu, kayıt sayısı, cursor'ı
  players.ndjson             satır başına bir JSON:API kaynağı (ham, dönüştürülmemiş)
  players.included.ndjson    include= ile gelen yan kayıtlar (type+id ile tekilleştirilmiş)
  player-notes.done          işlenmiş oyuncu ID'leri — per-player fazının resume dosyası
  ...
```

Ham JSON bilerek olduğu gibi saklanıyor: dönüştürme/temizleme Faz 2 ETL'inin
işi. Arşivde bir alan eksik kalırsa geri dönüp BM'den çekemeyiz, ama ham
arşivden istediğimiz kadar yeniden ETL koşabiliriz.

### Tasarım notları

- **`filter[servers]` zorunlu**: filtresiz `/players` BM'nin *global* oyuncu
  veritabanını sayfalamaya kalkar. Sunucu ID'leri bu yüzden ilk adımda çözülür.
- **`BM_SERVER_IDS` tercih edilir**: verilmezse
  `/servers?filter[organizations]=` denenir, ama bu filtre BM
  dokümantasyonunda yok — keşfedilen liste log'a basılır, gözle doğrulayın.
- **Her sayfadan sonra cursor kaydedilir** (yol+sorgu olarak, host'a bağlı
  değil), yani süreç her an öldürülebilir.
- **403/404 arşivi durdurmaz**: o kaynak `unsupported` işaretlenir, diğerleri
  devam eder. Kritik bir kaynak böyle işaretlenirse rapor uyarır.
- **429 global yavaşlatır**: paralel işçilerin hepsi birden geri çekilir.
- **Flag atamaları ters yönden çekilir**: "her oyuncuda hangi flag var" yerine
  "her flag kimlerde var" (`filter[playerFlags]`). 111.327 istek yerine 14
  tarama — 2 dakika, veri kaybı sıfır (`addedAt`/`removedAt`/ekleyen admin
  dahil). Bkz. `flag-assignments.ts`.
- **Notlar tek pahalı kaynak**: not filtresi yok (`filter[playerNotes]`,
  `[hasNotes]`, `[notes]` hepsi 400), tam kapsam için her oyuncu tek tek
  sorulmalı — 111.327 istek ≈ 6,2 saat. Varsayılan `--notes-scope candidates`
  sadece flag'i veya banı olan oyunculara sorar (~8 bin, ~30 dk) ve pratikte
  notların neredeyse tamamını yakalar; tam kapsam için `--notes-scope all`.
- **`--skip` bir karardır, eksiklik değil**: atlanan kaynak manifest'te
  `skipped` olarak işaretlenir ve raporda ayrı bir başlıkta gösterilir.
  Yoksa rapor sonsuza kadar "eksik kritik kaynak" diye uyarır ve tam da
  güvenilmesi gereken anda (abonelik iptali) görmezden gelinen bir gürültüye
  dönüşür.

### Gerçek çekim sonucu (2026-08-08, org 93788)

Arşiv gerçek API'ye karşı bir kez baştan sona çalıştırıldı. Sonuç:

| Kaynak | Kayıt |
|---|---|
| players | 111.327 |
| sessions | 422.799 |
| bans | 25.759 |
| player-flag-assignments | 11.433 |
| leaderboard-time (2 sunucu) | 117.953 |
| player-count-history | 1.442 |
| ban-lists / player-flags / servers | 5 / 14 / 2 |
| outages | 27 |

Toplam 1,26 GB, ~5.600 istek. Org'un **iki** sunucusu da dahil
(27133078, 28022344).

### Gerçek API'de ortaya çıkan sınırlar

Bunlar kod hatası değil, BM'nin kendi kısıtları — ETL yazarken bilinmesi gerekir:

- **Sunucu geçmişi 90 günle sınırlı**: `"Start may not be more than 90 days ago"`.
  2024–2026 arası popülasyon grafiği API'den ALINAMIYOR. Araç başlangıcı
  otomatik olarak sınıra kırpar (`BM_HISTORY_MAX_DAYS`, varsayılan 90).
- **`unique-player-history`, `first-time-history`, `time-played-history`**:
  90 gün içinde bile boş dönüyor — bu org'un planında yok.
- **`player-queries`**: 403, planda yok.
- **`bans-native` / `reserved-slots`**: 0 kayıt — bu özellikler kullanılmıyor.
- **`/bans-native` `filter[organization]` kabul etmiyor**, geçmiş uçları
  `page[size]` kabul etmiyor (ikisi de "must NOT have additional properties").
- **Rate limit**: `x-rate-limit-limit: 300` (dakika başına). Client kota
  %25'in altına inince yavaşlar, %10'un altında 10 sn bekler.
- **Oyuncu bazlı oynama süresi kaybolmuyor**: `include=server` ile her
  oyuncunun her sunucudaki `timePlayed`/`firstSeen`/`lastSeen` değeri
  `players.included.ndjson`'da duruyor — 90 gün sınırından etkilenmiyor.

### Test durumu

`pnpm --filter @altai/bm-export test` — 11 test, sahte bir BM sunucusuna
(`test/bm-mock-server.ts`) karşı uçtan uca: links.next sayfalaması, included
tekilleştirme, ağ kesintisi sonrası resume, 429 + Retry-After, 403'te
`unsupported` işaretleme, oyuncu başına fan-out + `.done` ile atlama, flag
atamalarının oyuncu başına DEĞİL flag başına taranması, not aday kümesinin
doğru birleşmesi, yanlış org'a yazmayı reddetme.

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
