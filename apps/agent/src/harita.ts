import { type HaritaBilgisi, KATMAN_ADI } from '@altai/contracts';

/**
 * Harita RCON cevaplarının ayrıştırılması.
 *
 * Saf fonksiyonlar: Squad'ın metin çıktısının biçimi sürümden sürüme
 * değişebiliyor (10.6'da ListPlayers'a "Party ID" eklendi ve oyuncu listesi
 * sessizce boşaldı). Ayrıştırma ayrı ve testli olursa bir sonraki
 * değişiklik hata olarak görünür.
 */

/**
 * `ShowCurrentMap` / `ShowNextMap` cevabı.
 *
 * "Current level is Narva, layer is Narva_RAAS_v1, factions ..." biçimi;
 * kalıp SquadJS'in kendi ayrıştırıcısıyla aynı (vendor/squad-server/rcon.js).
 * Sıradaki harita oylamaya bırakıldıysa katman "To be voted" yazıyor —
 * bu bir harita adı değil, null.
 */
function haritaSatiri(cevap: string, onEk: 'Current' | 'Next') {
  const m = cevap.match(new RegExp(`^${onEk} level is ([^,]*), layer is ([^,]*)`));
  if (!m) return { level: null, layer: null };
  const level = (m[1] ?? '').trim() || null;
  const layer = (m[2] ?? '').trim();
  return { level, layer: layer && layer !== 'To be voted' ? layer : null };
}

export function haritaBilgisiAyikla(simdiki: string, sonraki: string): HaritaBilgisi {
  return { simdiki: haritaSatiri(simdiki, 'Current'), sonraki: haritaSatiri(sonraki, 'Next') };
}

/**
 * `ListLayers` cevabı.
 *
 * İlk satır başlık ("List of available layers :"), sonra satır başına bir
 * katman. Bazı sürümlerde katmanın ardından açıklama geliyor; ilk sözcük
 * alınıyor. Katman adı her zaman alt çizgi içeriyor (`Harita_Mod_vN`),
 * başlığı ve boş satırları eleyen de bu.
 */
export function katmanlariAyikla(cevap: string): string[] {
  const katmanlar = new Set<string>();
  for (const satir of cevap.split(/\r?\n/)) {
    const ilk = satir.trim().split(/\s+/)[0] ?? '';
    if (KATMAN_ADI.test(ilk)) katmanlar.add(ilk);
  }
  return [...katmanlar].sort((a, b) => a.localeCompare(b));
}
