import type { FastifyInstance } from 'fastify';
import { gunlukYolu, kayitKarari, sirTemizle } from '../lib/activity-http.js';
import { anlamliTuket, kaydet } from '../lib/activity-log.js';

/**
 * Her HTTP isteğini sistem günlüğüne yazan genel kanca.
 *
 * Neden rota rota değil de tek yerde: eskiden yalnızca kodun açıkça
 * `writeAudit` çağırdığı yerler kayda düşüyordu, yani yeni bir uç yazan
 * herkesin bunu hatırlaması gerekiyordu — ve hatırlanmadığında eksiklik
 * ancak "bunu kim yaptı" diye sorulduğu gün fark ediliyordu. Kanca
 * kaydetmeyi varsayılan hâle getiriyor: unutmak artık mümkün değil.
 *
 * Kayıt YANITTAN SONRA yazılıyor (onResponse) ve tamponlu: istemci
 * günlüğü beklemiyor.
 */
export function registerActivityLog(app: FastifyInstance) {
  app.addHook('onResponse', async (req, reply) => {
    const oturum = req.authSession;
    const karar = kayitKarari({
      method: req.method,
      route: req.routeOptions?.url,
      url: req.url,
      statusCode: reply.statusCode,
      oturumVar: Boolean(oturum),
    });
    if (!karar.kaydet) return;

    // Bu istek zaten anlamlı bir satır yazdıysa (ban, uyarı, rol eşlemesi)
    // genel satırı atlıyoruz; ikisi birlikte aynı olayı iki kez gösterirdi.
    if (anlamliTuket(String(req.id))) return;

    // Yazma isteklerinde girdinin kendisi de saklanıyor: "ban attı" ile
    // "şu sebeple 30 gün ban attı" arasındaki fark denetimin bütün değeri.
    const payload: Record<string, unknown> = {};
    if (req.params && Object.keys(req.params).length > 0) {
      payload.params = sirTemizle(req.params);
    }
    if (req.query && Object.keys(req.query as object).length > 0) {
      payload.query = sirTemizle(req.query);
    }
    if (req.body !== undefined && req.body !== null && karar.category !== 'okuma') {
      payload.body = sirTemizle(req.body);
    }

    kaydet({
      actorType: karar.actorType,
      actorUserId: oturum?.id ?? null,
      actorLabel: oturum?.discordUsername ?? null,
      action: karar.action,
      category: karar.category,
      method: req.method,
      path: gunlukYolu(req.url),
      route: req.routeOptions?.url ?? null,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      payload: Object.keys(payload).length > 0 ? payload : null,
      requestId: String(req.id),
    });
  });
}
