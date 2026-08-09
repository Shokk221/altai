import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

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
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Ban listesini oyun sunucusu çekiyor; onu genel sınırın dışında
    // tutmuyoruz ama 300/dk zaten fazlasıyla yeterli (Squad dakikada bir çeker).
    // Kimlik doğrulanmış oturumlar için anahtar kullanıcı, değilse IP.
    keyGenerator: (req) => req.authSession?.id ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'too_many_requests',
      message: `Çok fazla istek. ${context.after} sonra tekrar deneyin.`,
    }),
  });
}
