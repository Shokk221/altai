# Agent kurulumu (oyun sunucusu)

Agent, **Squad sunucusunun üstünde** çalışır. Eski sistemin en kırılgan yanı
logları SSH ile uzaktan tail etmesiydi; agent lokal olduğu için log tail lokal
ve SFTP yok (plan Bölüm 3).

## Hangi kurulumu kullanacaksınız?

| Ortam | Yol |
|---|---|
| **Altai barındırma ortamı** (178.63.113.47, oyun konteyneri) | `install-agent-container.sh` + `agent-supervisor.sh` — **bunu kullanın** |
| Düz Linux VM (systemd var, kök erişimi var) | `install-agent.sh` + `altai-agent@.service` |

Aşağıdaki "Konteyner kurulumu" bölümü sizin ortamınız için. systemd bölümü
ileride başka bir sunucuya taşınırsa diye duruyor.

---

## Konteyner kurulumu (mevcut ortam)

Ortam 2026-08-08'de sunucuda ölçüldü. Önemli farklar:

| Gerçek | Sonuç |
|---|---|
| **systemd yok** (PID 1 = bash) | Servis birimi yerine `agent-supervisor.sh` |
| **Sadece `/data` kalıcı** | Kurulum `/data/altai`, env `/data/altai-env`, tetikleme `/data/bootstrap.sh` |
| **localhost kapalı** — `nc 127.0.0.1 21114` → refused, `nc 178.63.113.47 21114` → OK | `RCON_HOST=178.63.113.47` |
| Node **v20** (v22 değil), pnpm yok ama corepack var | Kurulum corepack ile pnpm etkinleştirir |
| LinuxGSM tamamen `/data` altında | `SQUAD_LOG_DIR=/data/serverfiles/SquadGame/Saved/Logs` |
| `/data` üzerinde 1,3 TB boş, 128 GB RAM | Yer sorunu yok |

### Adımlar

```bash
ssh altai shell
git clone <repo> /data/altai
bash /data/altai/infra/setup/install-agent-container.sh
nano /data/altai-env/agent-squad-01.env     # şifreleri doldur
bash /data/altai/infra/setup/preflight.sh /data/altai-env/agent-squad-01.env
bash /data/altai/infra/setup/agent-supervisor.sh start squad-01
```

Kurulum script'i `/data/bootstrap.sh` sonuna bir satır ekler, böylece konteyner
her yeniden yaratıldığında (`update` dahil) agent'lar otomatik başlar.

### Süpervizör

```bash
agent-supervisor.sh start|stop <slug>    tek agent
agent-supervisor.sh start-all|stop-all   yapılandırılmış hepsi
agent-supervisor.sh status
agent-supervisor.sh logs <slug> [n]
```

Agent çökerse 10 saniye sonra kendini yeniden başlatır. `stop`, önce agent
sürecine SIGTERM gönderip 30 saniye bekler — agent kapanırken açık session'ları
kapatmak zorunda, yarıda kesilirse veri kaybolur (plan Bölüm 6).

`start-all` yalnızca **gerçekten doldurulmuş** env dosyalarını başlatır
(`AGENT_SHARED_SECRET` ve `RCON_PASSWORD` boş olmayanlar). Yoksa bootstrap her
açılışta yarım yapılandırılmış agent'ları başlatmaya çalışırdı.

---

## Önce: panel hazır mı?

Agent'ın **tek** bağımlılığı var: panel konteynerindeki api'ye ulaşabilmek.

| Bağımlılık | Ne için | Hazır olmalı |
|---|---|---|
| **api** (`/agent-ws`) | Hem canlı event yayını hem kalıcı veri | `/health` cevap vermeli |

Agent **Postgres'e hiç bağlanmaz.** Kalıcı veri de bu WS üzerinden gider; api
veritabanına yazan tek yerdir (bkz. [deploy/README.md](../../deploy/README.md)).
Bunun iki faydası var:

- Postgres ağa hiç açılmıyor — api ile aynı konteynerde, yalnızca loopback.
  Firewall kuralı, `sslmode`, açık port yok.
- Oyun sunucusundaki bir süreç veritabanı kimlik bilgisi taşımıyor.

Bağlantı koptuğunda eventler diske spool edilir (`AGENT_SPOOL_DIR`), bağlantı
gelince sırayla gönderilir — panel saatlerce kapalı kalsa da veri kaybolmaz.

## systemd kurulumu (düz Linux VM)

## Kurulum

Oyun sunucusunda, root olarak:

```bash
git clone <repo> /tmp/altai && cd /tmp/altai
sudo ./infra/setup/install-agent.sh --slug squad-01 --user sqserver
```

`--user`, **Squad loglarını okuyabilen** kullanıcı olmalı — LinuxGSM kurulumunda
tipik olarak `sqserver`. Agent'a başka bir yetki gerekmiyor: log okur, RCON'a
bağlanır, dışarı WS açar.

Script neyi yapar:
1. node v22+ ve pnpm doğrular
2. depoyu `/opt/altai`'ye kopyalar, sadece agent bağımlılıklarını kurar
3. `/etc/altai/agent-squad-01.env` dosyasını şablondan üretir (0640)
4. `altai-agent@.service` template unit'ini kurar — **başlatmaz**

Tekrar çalıştırılabilir; mevcut env dosyalarının üzerine yazmaz.

### İkinci sunucu

Aynı script, farklı slug:

```bash
sudo /opt/altai/infra/setup/install-agent.sh --slug squad-02 --user sqserver
```

Her sunucu kendi env dosyasını ve kendi systemd instance'ını alır.

## Env dosyasını doldurma

```bash
sudoedit /etc/altai/agent-squad-01.env
```

Doldurulması zorunlu olanlar:

- `DATABASE_URL` — uygulama sunucusundaki Postgres, `sslmode=require` ile
- `AGENT_SHARED_SECRET` — api'dekiyle **birebir aynı**
- `RCON_PASSWORD` — Squad `Rcon.cfg` içindeki şifre
- `SQUAD_LOG_DIR` — `SquadGame.log`'un bulunduğu **klasör**, dosyanın kendisi değil

`SQUAD_LOG_DIR`'i bulmak için:

```bash
find /home -name SquadGame.log 2>/dev/null
```

> İki sunucu aynı makinedeyse **ayrı log dizinleri** olmalı. Eski sistemde
> bilinen bir hata vardı: sunucu 2/3 logları `SquadGame2.log`'a yazarken parser
> `SquadGame.log` arıyordu, yani S2/S3 muhtemelen sadece RCON verisiyle
> çalışıyordu (plan Bölüm 6). Her instance'ın `SQUAD_LOG_DIR`'inin gerçekten o
> sunucunun logunu gösterdiğini doğrulayın.

## Başlatmadan önce: ön kontrol

Agent gerçek bir Squad sunucusuna karşı **ilk kez** çalıştırılıyor. Servisi
açıp journalctl'de hata aramak yerine bağımlılıkları tek tek doğrulayın:

```bash
sudo /opt/altai/infra/setup/preflight.sh /etc/altai/agent-squad-01.env
```

Kontrol ettikleri: env değişkenleri, log dosyasının okunabilirliği ve
canlılığı, RCON portu, Postgres bağlantısı + şema, api `/health`, node sürümü,
vendor giriş dosyası. Ayrıca varsayılan Postgres şifresi ve eksik `sslmode`
gibi güvenlik hatalarını da yakalar.

## İlk çalıştırma — önce ön planda

Hepsi yeşilse, önce **servis olarak değil**, elle çalıştırın ki çıktıyı canlı
görün:

```bash
cd /opt/altai/apps/agent
sudo -u sqserver env $(grep -v '^#' /etc/altai/agent-squad-01.env | xargs) \
  ./node_modules/.bin/tsx src/index.ts
```

Görmeniz gerekenler:
- `agent başladı` (engine: **real** — `fixture` yazıyorsa env yanlış)
- `gerçek SquadJS vendor modülü yükleniyor`
- Oyuncu girip çıktıkça event logları

Ctrl+C ile durdurun. Agent kapanırken açık session'ları kapatır — bu mesajı da
görmelisiniz.

## Servis olarak açma

```bash
sudo systemctl enable --now altai-agent@squad-01
sudo journalctl -u altai-agent@squad-01 -f
```

Unit, oyun sunucusunu etkilememesi için sınırlı çalışır (plan Bölüm 9'daki
"gölge dönemde çifte yük" riski): `Nice=10`, `IOSchedulingClass=idle`,
`CPUQuota=50%`, `MemoryMax=512M`.

`KillSignal=SIGTERM` + `TimeoutStopSec=30` bilinçli: agent kapanırken açık
session'ları kapatmak zorunda, yarıda kesilirse her restart'ta session verisi
kaybolur.

## Doğrulama (gölge mod)

Faz 1 milestone'u "agent 2+ hafta gölge modda, session verileri BM
rakamlarıyla doğrulandı" diyor. Karşılaştırma cetveli elimizde:
BM arşivinde **111.327 oyuncu / 422.799 session** var.

Birkaç gün sonra:

```sql
-- Agent kaç session açtı?
SELECT s.slug, count(*), min(joined_at), max(joined_at)
FROM game_sessions g JOIN servers s ON s.id = g.server_id
GROUP BY s.slug;

-- Kapanmamış session var mı? (reconciler'ın işini yapması gerek)
SELECT s.slug, count(*) FROM game_sessions g JOIN servers s ON s.id = g.server_id
WHERE g.left_at IS NULL GROUP BY s.slug;

-- Snapshot'lar düzenli mi? (60 sn'de bir olmalı)
SELECT date_trunc('hour', taken_at) AS saat, count(*)
FROM server_snapshots GROUP BY 1 ORDER BY 1 DESC LIMIT 24;
```

Aynı dönemin BM tarafındaki sayısını `bm-archive/sessions.ndjson` içinden
sayıp karşılaştırın. Tutuyorsa Faz 1 kapanır.

## Sorun giderme

| Belirti | Muhtemel sebep |
|---|---|
| `engine: fixture` yazıyor | `AGENT_ENGINE=real` değil |
| `SQUADJS_VENDOR_ENTRY okunamıyor` | Yol yanlış veya `pnpm install` eksik |
| Oyuncu event'i yok ama RCON çalışıyor | `SQUAD_LOG_DIR` yanlış sunucunun logunu gösteriyor |
| `hello_reject: server_error` | Panelde `pnpm db:migrate` çalıştırılmadı |
| Spool büyüyor, DB boş | api'ye ulaşılamıyor — `panelctl status`, reverse proxy'de `/agent-ws` |
| WS sürekli yeniden bağlanıyor | `AGENT_SHARED_SECRET` api'dekiyle aynı değil |
| Sürekli restart | `StartLimitBurst=5` devreye girer; `journalctl -u altai-agent@<slug> -n 100` |

## Bilinen sınırlar (bu aşamada)

- **RCON komutları henüz çalışmıyor.** Protokol tanımlı ama agent gelen
  komutu sadece logluyor — kick/ban/warn Faz 2/3'te bağlanacak.
- **Event kapsamı minimal**: connect/disconnect/chat/snapshot. Kill, revive,
  round ve 4 özel event (role change, leader, admin cam) henüz adapter
  arayüzünde yok.
- **Pozisyon takibi yok ve olmayacak** — canlı harita/replay ihtiyacını Squad
  Replayer (`altaisquad.com/sqr1`) karşılıyor. Bu sayede sunucuda
  `VeryVerbose` log şartı yok ve agent'ın işlediği log hacmi çok daha düşük.
