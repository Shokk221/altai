import type { Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { mesajiKaydet } from '../src/tickets.js';

/**
 * Transkript yazımının eleme kuralları.
 *
 * Bu iki elemenin ikisi de performans değil DOĞRULUK meselesi: thread
 * olmayan mesajlar için veritabanına sormak sunucudaki bütün sohbeti
 * yoklamak demek, sistem bildirimleri ise ("X thread'e katıldı")
 * transkripti okunamaz hâle getirir.
 *
 * Veritabanına gerçekten yazılıp yazılmadığı ayrı olarak gerçek
 * Postgres'e karşı doğrulandı; buradaki test yalnızca elemeleri kilitliyor.
 */

/** En küçük sahte mesaj — yalnızca elemede kullanılan alanlar. */
function sahteMesaj(over: {
  thread?: boolean;
  system?: boolean;
  content?: string;
}): Message {
  return {
    id: 'm1',
    system: over.system ?? false,
    content: over.content ?? 'merhaba',
    createdAt: new Date(),
    author: { id: 'u1', username: 'kullanici' },
    attachments: new Map(),
    channel: { id: 'c1', isThread: () => over.thread ?? true },
  } as unknown as Message;
}

/** `threadTalebi` çağrıldı mı? Çağrıldıysa eleme geçilmiş demektir. */
function sahteDb() {
  const sorgular: string[] = [];
  return {
    sorgular,
    db: {
      select: () => {
        sorgular.push('select');
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([]) }),
          }),
        };
      },
    } as never,
  };
}

describe('mesajiKaydet elemeleri', () => {
  it('thread olmayan mesajda veritabanına HİÇ gitmez', async () => {
    // Sunucudaki bütün sohbeti veritabanına sormak, dakikada yüzlerce
    // gereksiz sorgu demekti.
    const { db, sorgular } = sahteDb();
    await mesajiKaydet(db, sahteMesaj({ thread: false }));
    expect(sorgular).toEqual([]);
  });

  it('sistem bildirimini atlar', async () => {
    // "X thread'e katıldı" satırları transkripti okunamaz hâle getirirdi.
    const { db, sorgular } = sahteDb();
    await mesajiKaydet(db, sahteMesaj({ system: true }));
    expect(sorgular).toEqual([]);
  });

  it('thread mesajında talebi arar', async () => {
    const { db, sorgular } = sahteDb();
    await mesajiKaydet(db, sahteMesaj({}));
    expect(sorgular).toEqual(['select']);
  });

  it('talep bulunamazsa sessizce çıkar', async () => {
    // Talep thread'i olmayan bir thread'e yazılan mesaj bizi
    // ilgilendirmiyor; hata vermek gürültü olurdu.
    const { db } = sahteDb();
    await expect(mesajiKaydet(db, sahteMesaj({}))).resolves.toBeUndefined();
  });

  it('boş gövdeli mesajı da eler değil — kaydeder', async () => {
    // İçeriği boş bir mesaj genelde MESSAGE CONTENT izninin kapalı
    // olduğunu gösteriyor. Atlamak o sorunu gizler; kaydetmek görünür
    // kılıyor (panel "(içerik kaydedilmemiş)" diye gösteriyor).
    const { db, sorgular } = sahteDb();
    await mesajiKaydet(db, sahteMesaj({ content: '' }));
    expect(sorgular).toEqual(['select']);
  });
});
