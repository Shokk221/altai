/**
 * Loglardan sır temizleme.
 *
 * Fastify her istek için req.url'i logluyor. Ban listesi ucunun kimlik
 * doğrulaması URL'deki token ile yapılıyor (Squad düz GET atıyor, header
 * ekleyemiyoruz) — yani token her istekte düz metin olarak loga düşüyordu.
 * Squad sunucusu listeyi periyodik çektiği için bu sürekli tekrarlanıyor ve
 * loglara erişebilen herkes 112 bin oyuncunun kimliğine açılan anahtarı
 * görebiliyordu. Gerçek kurulumda doğrulandı, sonra bu dosya yazıldı.
 */

/** URL'deki sırları maskele. Yol parçası ve sorgu değerleri dahil. */
export function redactUrl(url: string): string {
  let out = url;

  // /ban-list/<token> ve /ban-list/<token>.cfg
  out = out.replace(/(\/ban-list\/)[^/?#]+/i, '$1***');

  // ?token=... &secret=... &key=... gibi yaygın adlar
  out = out.replace(/([?&](?:token|secret|key|password|pass|auth)=)[^&#]*/gi, '$1***');

  return out;
}

// Alanlar `| undefined` ile yazılıyor: tsconfig'de exactOptionalPropertyTypes
// açık, yani `?: string` ile `string | undefined` aynı şey değil ve Fastify'ın
// kendi tipiyle uyuşmaz.
export interface LoggableRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, unknown> | undefined;
  socket?: { remoteAddress?: string | undefined; remotePort?: number | undefined } | undefined;
}

/** Fastify'ın beklediği serileştirici çıktısı. */
interface SerializedRequest {
  [key: string]: unknown;
  method?: string;
  url?: string;
  host?: string;
  remoteAddress?: string;
  remotePort?: number;
}

/**
 * Fastify'ın varsayılan req serileştiricisinin yerine geçer. Varsayılanla
 * aynı alanları verir, tek farkı url'in maskelenmiş olması.
 *
 * Tanımsız alanlar nesneye hiç konmuyor: exactOptionalPropertyTypes açıkken
 * `method: undefined` ile `method` alanının olmaması aynı şey değil.
 */
export function redactedRequestSerializer(req: LoggableRequest): SerializedRequest {
  const out: SerializedRequest = { url: redactUrl(req.url ?? '') };

  if (typeof req.method === 'string') out.method = req.method;
  const host = req.headers?.host;
  if (typeof host === 'string') out.host = host;
  if (typeof req.socket?.remoteAddress === 'string') out.remoteAddress = req.socket.remoteAddress;
  if (typeof req.socket?.remotePort === 'number') out.remotePort = req.socket.remotePort;

  return out;
}
