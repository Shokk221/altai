import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import Logger from 'core/logger';

import Layer from './layer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, 'layers-cache.json');
// Multiple sources — birincisi (GitHub raw) erişilemezse fallback'ler denenir.
const SOURCE_URLS = [
  'https://cdn.jsdelivr.net/gh/Squad-Wiki/squad-wiki-pipeline-map-data@master/completed_output/_Current%20Version/finished.json',
  'https://raw.githubusercontent.com/Squad-Wiki/squad-wiki-pipeline-map-data/master/completed_output/_Current%20Version/finished.json'
];
const FETCH_TIMEOUT_MS = 15000;
const RETRY_ATTEMPTS = 2; // per source
const RETRY_DELAY_MS = 1500;
// Pull başarısız olduktan sonra başka pull denemeden önce beklenecek süre (spam önleme)
const FAILED_PULL_COOLDOWN_MS = 5 * 60 * 1000; // 5 dakika

class Layers {
  constructor() {
    this.layers = [];
    this.pulled = false;
    this._lastFailedAt = 0; // En son başarısız pull zamanı (cool-down için)
    this._inFlightPull = null; // Eşzamanlı çağrılar tek pull paylaşsın
  }

  async _fetchWithRetry() {
    let lastErr = null;
    // Tüm source'ları sırayla dene; her source için RETRY_ATTEMPTS deneme
    for (let srcIdx = 0; srcIdx < SOURCE_URLS.length; srcIdx++) {
      const url = SOURCE_URLS[srcIdx];
      const sourceName = new URL(url).hostname;
      for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
        try {
          Logger.verbose('Layers', 2,
            `Fetching layer data from ${sourceName} (kaynak ${srcIdx + 1}/${SOURCE_URLS.length}, deneme ${attempt}/${RETRY_ATTEMPTS})...`
          );
          const response = await axios.get(url, {
            timeout: FETCH_TIMEOUT_MS,
            headers: { 'User-Agent': 'AltaiSquadJS/1.0' }
          });
          if (!response?.data?.Maps || !Array.isArray(response.data.Maps)) {
            throw new Error('Beklenmeyen yanıt formatı (data.Maps array değil)');
          }
          Logger.verbose('Layers', 1, `✅ Layer data ${sourceName} kaynağından alındı.`);
          return response.data;
        } catch (err) {
          lastErr = err;
          const code = err?.code || err?.response?.status || 'unknown';
          Logger.verbose('Layers', 1,
            `Fetch ${sourceName} deneme ${attempt} başarısız: ${err?.message || err} (code: ${code})`
          );
          if (attempt < RETRY_ATTEMPTS) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }
      Logger.verbose('Layers', 1, `Kaynak ${sourceName} tamamen başarısız, sonrakine geçiliyor.`);
    }
    throw lastErr || new Error('Tüm layer kaynaklarına erişilemedi');
  }

  _loadCache() {
    try {
      if (!fs.existsSync(CACHE_FILE)) return null;
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (!data?.Maps || !Array.isArray(data.Maps)) return null;
      return data;
    } catch (e) {
      Logger.verbose('Layers', 1, `Cache okuma hatası: ${e.message}`);
      return null;
    }
  }

  _saveCache(data) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
      Logger.verbose('Layers', 2, `Layer cache kaydedildi (${CACHE_FILE})`);
    } catch (e) {
      Logger.verbose('Layers', 1, `Cache yazma hatası: ${e.message}`);
    }
  }

  async pull(force = false) {
    if (this.pulled && !force) {
      Logger.verbose('Layers', 2, 'Already pulled layers.');
      return this.layers;
    }

    // Eşzamanlı pull spam'i önle: zaten bir pull devam ediyorsa onun sonucunu paylaş
    if (this._inFlightPull) {
      return this._inFlightPull;
    }

    // Son başarısız denemeden sonra cool-down — spam ETIMEDOUT loop önle
    if (!force && this._lastFailedAt > 0) {
      const sinceLastFail = Date.now() - this._lastFailedAt;
      if (sinceLastFail < FAILED_PULL_COOLDOWN_MS) {
        const remaining = Math.ceil((FAILED_PULL_COOLDOWN_MS - sinceLastFail) / 1000);
        Logger.verbose('Layers', 3, `Pull cool-down (${remaining}s kaldı), atlanıyor — mevcut ${this.layers.length} layer ile devam.`);
        return this.layers;
      }
    }

    if (force) Logger.verbose('Layers', 1, 'Forcing update to layer information...');
    Logger.verbose('Layers', 1, 'Pulling layers...');

    this._inFlightPull = this._doPull();
    try {
      return await this._inFlightPull;
    } finally {
      this._inFlightPull = null;
    }
  }

  async _doPull() {

    let data = null;
    try {
      data = await this._fetchWithRetry();
      this._saveCache(data); // Sonraki başlatmalar için cache'le
    } catch (err) {
      // Network başarısız: cache'den oku
      Logger.verbose('Layers', 1,
        `⚠️ Squad Wiki layer fetch başarısız (${err?.message || err}). Cache'den yükleme deneniyor.`
      );
      data = this._loadCache();
      if (!data) {
        Logger.verbose('Layers', 1,
          '❌ Cache de yok — layer veritabanı YÜKLENEMEDİ. Squad sunucusu çalışmaya devam edecek ama harita meta verisi (faction, gamemode parse vs.) erişilemez. ' +
          `Sonraki deneme ${Math.round(FAILED_PULL_COOLDOWN_MS / 60000)} dakika sonra. ` +
          'Manuel cache koymak için: curl -4 -o squad-server/squad-server/layers/layers-cache.json ' + SOURCE_URLS[0]
        );
        // Cool-down etkinleştir: spam loop'u engelle
        this._lastFailedAt = Date.now();
        this.layers = [];
        return this.layers;
      }
      Logger.verbose('Layers', 1, '✅ Cache başarıyla yüklendi (network olmadan).');
      // Cache var ama upstream fail — yine de cool-down koy ki sürekli denemesin
      this._lastFailedAt = Date.now();
    }

    this.layers = [];
    for (const layer of data.Maps) {
      try {
        this.layers.push(new Layer(layer));
      } catch (e) {
        Logger.verbose('Layers', 2, `Layer parse hatası (${layer?.classname || layer?.name || '?'}): ${e.message}`);
      }
    }

    Logger.verbose('Layers', 1, `Pulled ${this.layers.length} layers.`);
    this.pulled = true;
    this._lastFailedAt = 0; // Reset cool-down — başarılı pull
    return this.layers;
  }

  async getLayerByCondition(condition) {
    try {
      await this.pull();
    } catch (e) {
      Logger.verbose('Layers', 2, `Pull hatası (lookup'ta): ${e.message}`);
      // Continue with whatever we have
    }

    const matches = this.layers.filter(condition);
    if (matches.length === 1) return matches[0];

    return null;
  }

  getLayerById(layerId) {
    return this.getLayerByCondition((layer) => layer.layerid === layerId);
  }

  getLayerByClassname(classname) {
    return this.getLayerByCondition((layer) => layer.classname === classname);
  }
}

export default new Layers();
