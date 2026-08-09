import { createHash } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '../lib/auth-guard.js';

/**
 * Hız sınırı.
 *
 * Asıl sebep break-glass girişi: Discord'u tamamen atlayıp tüm izinlere açılan
 * bir hesap ve sınırsız şifre denemesine açıktı (10 art arda deneme yapıldı,
 * hepsi işlendi). Süper admin şifresine karşı kaba kuvvet saldırısını
 * engelleyen hiçbir şey yoktu.
 *
 * Genel sınır cömert: panel WS ile çalışıyor, normal kullanımda kimse buna
 * yaklaşmaz. Asıl kısıt rota bazında (bkz. auth.ts break-glass config'i).
 */

/** İstek başına hız sınırı anahtarı. Saf fonksiyon — testten çağrılıyor. */
export function rateLimitKey(req: Pick<FastifyRequest, 'cookies' | 'ip'>): string {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    // Oturum çerezi doğrudan okunuyor, req.authSession DEĞİL: authSession'ı
    // dolduran requireSession bir rota preHandler'ı, bu plugin ise genel bir
    // onRequest kancası. onRequest her zaman preHandler'dan önce çalıştığı
    // için authSession burada daima undefined olurdu — eski hâli sessizce
    // her istekte IP'ye düşüyordu.
    //
    // Ham token anahtar olarak kullanılmıyor: hız sınırı deposunda geçerli
    // oturum token'ları düz metin birikirdi. Özet, aynı oturumu ayırt etmek
    // için yeterli.
    return `sess:${createHash('sha256').update(token).digest('hex')}`;
  }
  return req.ip;
}

export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Ban listesini oyun sunucusu çekiyor; onu genel sınırın dışında
    // tutmuyoruz ama 300/dk zaten fazlasıyla yeterli (Squad dakikada bir çeker).
    // Oturumu olan istekler oturum başına, olmayanlar IP başına sayılır.
    //
    // SIRALAMA ÖNEMLİ: @fastify/cookie bu plugin'den ÖNCE kaydedilmeli
    // (bkz. index.ts), yoksa req.cookies boş olur ve anahtar sessizce
    // IP'ye düşer. IP'nin doğru olması da TRUST_PROXY'ye bağlı.
    keyGenerator: rateLimitKey,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'too_many_requests',
      message: `Çok fazla istek. ${context.after} sonra tekrar deneyin.`,
    }),
  });
}
