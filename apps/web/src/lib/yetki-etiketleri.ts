/**
 * Yetki ekranının Türkçe sözlüğü.
 *
 * İzin anahtarları (`player.kick`, `cameraman`) kodun dili; ekranı kullanan
 * kişi Discord'da rol dağıtan bir yönetici ve neyi açtığını anahtar adından
 * çıkarmak zorunda kalmamalı. Önce düğmelerde ham anahtarlar yazıyordu.
 *
 * Burada olmayan bir anahtar ekranda ham adıyla görünür — yeni bir izin
 * eklenince buraya da eklenmeli.
 */

export interface Etiket {
  ad: string;
  aciklama: string;
}

export interface Kume {
  baslik: string;
  anahtarlar: string[];
}

export const SISTEM_ROLU: Record<string, Etiket> = {
  super_admin: {
    ad: 'Süper Admin',
    aciklama: 'Her şeyi yapabilir; aşağıdaki izinlere bakılmaz.',
  },
  admin: { ad: 'Admin', aciklama: 'Etiket; ne yapabileceğini seçilen izinler belirler.' },
  moderator: { ad: 'Moderatör', aciklama: 'Etiket; ne yapabileceğini seçilen izinler belirler.' },
  clan_leader: {
    ad: 'Klan Lideri',
    aciklama: 'Etiket; ne yapabileceğini seçilen izinler belirler.',
  },
  member: { ad: 'Üye', aciklama: 'Etiket; ne yapabileceğini seçilen izinler belirler.' },
};

export const PANEL_IZNI: Record<string, Etiket> = {
  'player.view': { ad: 'Oyuncuları görme', aciklama: 'Canlı panel, oyuncu listesi ve profiller' },
  'player.warn': { ad: 'Uyarı ve duyuru', aciklama: 'Oyuncuya oyun içi uyarı, sunucuya duyuru' },
  'player.kick': { ad: 'Sunucudan atma', aciklama: 'Oyuncuyu oyundan atma' },
  'player.team_change': {
    ad: 'Takım değiştirme',
    aciklama: 'Oyuncuyu sürükleyip karşı takıma alma',
  },
  'player.ban': { ad: 'Ban', aciklama: 'Ban atma ve kaldırma' },
  'player.note.write': { ad: 'Not yazma', aciklama: 'Oyuncu profiline kayıt ve not ekleme' },
  'flag.manage': { ad: 'Etiketler', aciklama: 'Oyunculara etiket ekleme ve kaldırma' },
  'clan.manage': { ad: 'Klanlar', aciklama: 'Klan ve klan savaşı yönetimi' },
  'ticket.manage': { ad: 'Talepler', aciklama: 'Destek taleplerini görme ve kapatma' },
  'rules.manage': { ad: 'Kurallar', aciklama: 'Sunucu kurallarını düzenleme' },
  'plugin_config.write': {
    ad: 'Eklenti ayarları',
    aciklama: 'Sunucu eklentilerini açma, kapatma ve ayarlama',
  },
  'server.control': { ad: 'Sunucu kontrolü', aciklama: 'Sunucu geneli işlemler ve duyuru' },
  'audit.read': { ad: 'Kayıtlar', aciklama: 'Sistem günlüğü ve yetkili kamerası kayıtları' },
  'admin_list.manage': {
    ad: 'Yetki yönetimi',
    aciklama: 'Bu sayfa. Sahibi kendine her izni verebilir.',
  },
};

/**
 * Ekrandaki gruplama. `super_admin` izni bilerek YOK: hiçbir yerde
 * denetlenmiyor, tam yetkiyi "Süper Admin" seviyesi veriyor. Listede
 * görünseydi seçen kişi tam yetki verdiğini sanırdı.
 */
export const PANEL_KUMELERI: Kume[] = [
  {
    baslik: 'Oyuncular',
    anahtarlar: [
      'player.view',
      'player.warn',
      'player.kick',
      'player.team_change',
      'player.ban',
      'player.note.write',
      'flag.manage',
    ],
  },
  { baslik: 'Topluluk', anahtarlar: ['clan.manage', 'ticket.manage', 'rules.manage'] },
  {
    baslik: 'Sistem',
    anahtarlar: ['plugin_config.write', 'server.control', 'audit.read', 'admin_list.manage'],
  },
];

export const SQUAD_IZNI: Record<string, Etiket> = {
  kick: { ad: 'Atma', aciklama: 'Oyuncuyu sunucudan atma' },
  ban: { ad: 'Banlama', aciklama: 'Oyun içinden ban' },
  immune: { ad: 'Dokunulmaz', aciklama: 'Atılamaz ve banlanamaz' },
  chat: { ad: 'Yetkili sohbeti', aciklama: 'Yetkili sohbetine yazma ve sunucu duyurusu' },
  canseeadminchat: {
    ad: 'Yetkili sohbetini görme',
    aciklama: 'Yetkili sohbeti, TK ve yetkili giriş bildirimleri',
  },
  cameraman: { ad: 'Yetkili kamerası', aciklama: 'Serbest kamera ile izleme' },
  forceteamchange: { ad: 'Zorla takım değiştirme', aciklama: 'ForceTeamChange komutu' },
  changemap: { ad: 'Harita değiştirme', aciklama: 'Haritayı ve sonraki haritayı ayarlama' },
  pause: { ad: 'Duraklatma', aciklama: 'Oyunu duraklatma' },
  balance: { ad: 'Takım dengesini aşma', aciklama: 'Denge kilidine takılmadan takım seçme' },
  teamchange: { ad: 'Beklemesiz takım değişimi', aciklama: 'Takım değiştirme süre sınırı yok' },
  cheat: { ad: 'Hile komutları', aciklama: 'Sunucu hile komutları' },
  config: { ad: 'Sunucu ayarları', aciklama: 'Sunucu yapılandırmasını değiştirme' },
  manageserver: { ad: 'Sunucuyu kapatma', aciklama: 'Sunucuyu kapatma ve yönetme' },
  private: { ad: 'Şifre koyma', aciklama: 'Sunucuya şifre koyma' },
  demos: { ad: 'Sunucu demo kaydı', aciklama: 'Sunucu tarafında demo kaydetme' },
  clientdemos: { ad: 'İstemci demo kaydı', aciklama: 'Kendi bilgisayarında demo kaydetme' },
  debug: { ad: 'Hata ayıklama', aciklama: 'Yetkili istatistikleri ve hata ayıklama bilgisi' },
  featuretest: { ad: 'Test özellikleri', aciklama: 'Geliştiricilerin test özellikleri' },
  reserve: { ad: 'Rezerve slot', aciklama: 'Sunucu doluyken de girebilme (whitelist)' },
};

export const SQUAD_KUMELERI: Kume[] = [
  {
    baslik: 'Moderasyon',
    anahtarlar: [
      'kick',
      'ban',
      'chat',
      'canseeadminchat',
      'cameraman',
      'forceteamchange',
      'immune',
    ],
  },
  { baslik: 'Oyun', anahtarlar: ['changemap', 'pause', 'balance', 'teamchange', 'cheat'] },
  {
    baslik: 'Sunucu',
    anahtarlar: [
      'config',
      'manageserver',
      'private',
      'demos',
      'clientdemos',
      'debug',
      'featuretest',
    ],
  },
  { baslik: 'Slot', anahtarlar: ['reserve'] },
];

export function panelIzniAdi(p: string): string {
  return PANEL_IZNI[p]?.ad ?? p;
}

export function squadIzniAdi(p: string): string {
  return SQUAD_IZNI[p]?.ad ?? p;
}
