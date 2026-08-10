import { sql } from 'drizzle-orm';
import { createDb } from './client.js';

/**
 * raw_events içinde kalmış sohbet mesajlarını chat_messages'a taşır.
 *
 * Agent 9 Ağustos'ta canlıya alındı ama sohbet tablosu yoktu; mesajlar o
 * tarihten beri yalnızca ham olay arşivinde duruyor. Bu script onları
 * kurtarıyor. Ham arşiv SİLİNMİYOR — o, yapısal tablolarda bir eksik
 * çıktığında başvurulacak kaynak.
 *
 * Tekrar çalıştırılabilir: aynı ham olay iki kez taşınmasın diye
 * (source, external_id) çifti kullanılıyor, external_id = raw_events.id.
 *
 * Kullanım: DATABASE_URL=... pnpm db:backfill:chat
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL tanımlı değil');

const db = createDb(databaseUrl);

// Tek INSERT ... SELECT: satırları uygulamaya taşımaya gerek yok.
// player_id doğrudan join ile çözülüyor; eşleşmezse null kalır ve mesaj
// yine kaydedilir (kimliği bilinmeyen mesajı atmak veri kaybı olurdu).
const sonuc = await db.execute(sql`
  insert into chat_messages
    (server_id, player_id, steam_id, name, channel, message, sent_at, source, external_id)
  select
    e.server_id,
    p.id,
    e.payload->>'steamId',
    null,
    e.payload->>'channel',
    e.payload->>'message',
    (e.payload->>'timestamp')::timestamptz,
    'raw_events',
    e.id::text
  from raw_events e
  left join players p on p.steam_id = e.payload->>'steamId'
  where e.event_type = 'CHAT_MESSAGE'
    and e.payload->>'message' is not null
    and e.payload->>'timestamp' is not null
  on conflict (source, external_id) do nothing
`);

const [say] = (await db.execute(sql`
  select
    (select count(*) from chat_messages) as toplam,
    (select count(*) from chat_messages where player_id is null) as oyuncusuz,
    (select count(*) from raw_events where event_type = 'CHAT_MESSAGE') as ham
`)) as unknown as { toplam: string; oyuncusuz: string; ham: string }[];

console.log('sohbet kurtarma tamamlandı');
console.log(`  ham olaydaki mesaj : ${say?.ham ?? '?'}`);
console.log(`  chat_messages       : ${say?.toplam ?? '?'}`);
console.log(`  oyuncuya bağlanmayan: ${say?.oyuncusuz ?? '?'}`);
void sonuc;

process.exit(0);
