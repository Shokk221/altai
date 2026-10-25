/**
 * Ban sebebindeki şablon yer tutucularının doldurulması — TEK tanım.
 *
 * Sebep metni veritabanında yer tutucu taşıyor (`{{expires}}`,
 * `{{timeLeft}}`); BM'den devralınan bir biçim ve panelin ban penceresi de
 * aynı biçimi üretiyor. Metin bir yere YAZILIRKEN değil, bir yere
 * GÖNDERİLİRKEN dolduruluyor, çünkü "ne kadar kaldı" gönderildiği ana göre
 * değişiyor.
 *
 * NEDEN PAYLAŞILAN PAKETTE: bu fonksiyon `apps/api` içindeydi ve aynı
 * metni gönderen dördüncü yol (bot'un Discord kanıt gönderisi) ona
 * erişemediği için ham yer tutucu Discord'a gitti — kanalda eski sistemin
 * bıraktığı `{{player.steamID}}` hatasının aynısı. Kopyalamak yerine
 * taşındı: aynı kuralın iki kopyası, birinde yapılan düzeltmenin
 * diğerine geçmemesi demek.
 *
 * Bu hata ÜÇ KEZ canlıya çıktı (ban listesi, periyodik kick, anlık kick) ve
 * her seferinde oyuncunun ekran görüntüsüyle öğrenildi. Çağrı yerleri
 * `apps/api/test/ban-sebebi-renderlenir.test.ts` ile korunuyor.
 */

/** Squad ban listesi satırı için üst sınır. */
export const BAN_SEBEBI_SINIRI = 180;

function insanOkur(ms: number): string {
  if (ms <= 0) return 'süresi doldu';
  const saat = Math.floor(ms / 3_600_000);
  if (saat < 24) return `${saat} saat`;
  const gun = Math.floor(saat / 24);
  if (gun < 30) return `${gun} gün`;
  return `${Math.floor(gun / 30)} ay`;
}

/**
 * Yer tutucuları doldurur.
 *
 * `enFazla` parametre: Squad'ın ban listesi satırı kısa olmak zorunda (180),
 * ama Discord gönderisinde metni kırpmanın sebebi yok — kanıt gönderisinde
 * sebebin yarısını göstermek, yetkilinin aradığı bilgiyi gizler.
 */
export function renderReason(
  reason: string,
  expiresAt: Date | null,
  now: Date,
  enFazla: number = BAN_SEBEBI_SINIRI,
): string {
  const bitisMetni = expiresAt ? expiresAt.toISOString().slice(0, 16).replace('T', ' ') : 'kalıcı';
  const kalanMetni = expiresAt ? insanOkur(expiresAt.getTime() - now.getTime()) : 'kalıcı';

  const out = reason
    .replaceAll('{{expires}}', bitisMetni)
    .replaceAll('{{timeLeft}}', kalanMetni)
    // Satır sonu ban listesini bozar: bir sonraki satır geçersiz kayıt olur.
    .replace(/[\r\n]+/g, ' ')
    .trim();

  return out.length > enFazla ? `${out.slice(0, enFazla - 1)}…` : out;
}
