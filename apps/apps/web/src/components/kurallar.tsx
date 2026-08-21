'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Kural yönetimi — plan Faz 5.
 *
 * Kurallar tek kaynaktan yönetiliyor: burada yazılan metin hem panelde,
 * hem oyun içi `!kurallar` komutunda, hem de bot tarafında aynı. Eski
 * sistemde üç ayrı yerde yazılıydılar ve üçü birbirini tutmuyordu.
 *
 * SIRA elle yönetiliyor (yukarı/aşağı). Oyuncuya "3. kural" dendiğinde
 * ikisinin aynı şeyi anlaması gerekiyor ve oluşturma tarihine göre
 * sıralamak, araya kural eklendiğinde numaraları kaydırırdı.
 */

export interface Kural {
  id: string;
  serverId: string | null;
  position: number;
  title: string;
  body: string;
  category: string | null;
  active: boolean;
}

const BOS = { title: '', body: '', category: '' };

export function Kurallar({ apiUrl, kurallar }: { apiUrl: string; kurallar: Kural[] }) {
  const router = useRouter();
  const [taslak, setTaslak] = useState(BOS);
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);

  async function istek(yol: string, method: string, govde?: unknown) {
    setCalisiyor(true);
    setMesaj(null);
    try {
      const r = await fetch(`${apiUrl}${yol}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(govde ? { body: JSON.stringify(govde) } : {}),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        // Sunucunun kendi hata metni gösteriliyor: "başarısız" demek,
        // hangi alanın sorunlu olduğunu gizlerdi.
        setMesaj(j.error ?? `hata (${r.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setMesaj('sunucuya ulaşılamadı');
      return false;
    } finally {
      setCalisiyor(false);
    }
  }

  async function ekle() {
    if (!taslak.title.trim() || !taslak.body.trim()) {
      setMesaj('başlık ve metin zorunlu');
      return;
    }
    const ok = await istek('/rules', 'POST', {
      title: taslak.title.trim(),
      body: taslak.body.trim(),
      category: taslak.category.trim() || null,
    });
    if (ok) setTaslak(BOS);
  }

  /**
   * Kuralı bir sıra yukarı/aşağı taşır.
   *
   * Tüm listeyi gönderiyor, tek satırın `position`'ını değil: iki kuralın
   * yerini değiştirmek iki ayrı yazma demekti ve arada bir istek düşerse
   * ikisi aynı sıraya gelirdi.
   */
  async function tasi(index: number, yon: -1 | 1) {
    const hedef = index + yon;
    if (hedef < 0 || hedef >= kurallar.length) return;
    const yeni = [...kurallar];
    const a = yeni[index];
    const b = yeni[hedef];
    if (!a || !b) return;
    yeni[index] = b;
    yeni[hedef] = a;
    await istek('/rules/sira', 'POST', { ids: yeni.map((k) => k.id) });
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">Yeni kural</h2>
        <div className="space-y-2">
          <Input
            placeholder="Başlık (ör. Takım arkadaşını öldürme)"
            value={taslak.title}
            onChange={(e) => setTaslak({ ...taslak, title: e.target.value })}
          />
          <textarea
            className="min-h-24 w-full rounded border border-border bg-bg px-3 py-2 text-sm"
            placeholder="Kuralın tam metni. Oyun içinde de bu gösteriliyor."
            value={taslak.body}
            onChange={(e) => setTaslak({ ...taslak, body: e.target.value })}
          />
          <Input
            placeholder="Kategori (isteğe bağlı — Genel, Manga, Yetkili...)"
            value={taslak.category}
            onChange={(e) => setTaslak({ ...taslak, category: e.target.value })}
          />
          <div className="flex items-center gap-3">
            <Button onClick={ekle} disabled={calisiyor}>
              Ekle
            </Button>
            {mesaj ? <span className="text-xs text-danger">{mesaj}</span> : null}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Kurallar <span className="text-fg-faint">({kurallar.length})</span>
        </h2>
        {kurallar.length === 0 ? (
          <p className="rounded border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
            Henüz kural yok. Oyun içi <code>!kurallar</code> komutu boş liste gösterir.
          </p>
        ) : (
          <ol className="space-y-2">
            {kurallar.map((k, i) => (
              <li
                key={k.id}
                className={`rounded border border-border bg-surface p-3 ${k.active ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start gap-3">
                  <span className="num mt-0.5 w-6 shrink-0 text-right text-sm text-fg-faint">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    {duzenlenen === k.id ? (
                      <Duzenle
                        kural={k}
                        calisiyor={calisiyor}
                        onKaydet={async (d) => {
                          const ok = await istek(`/rules/${k.id}`, 'PATCH', d);
                          if (ok) setDuzenlenen(null);
                        }}
                        onVazgec={() => setDuzenlenen(null)}
                      />
                    ) : (
                      <>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <h3 className="text-sm font-semibold">{k.title}</h3>
                          {k.category ? (
                            <span className="rounded bg-accent-weak px-1.5 py-0.5 text-[10px] font-medium text-accent-2">
                              {k.category}
                            </span>
                          ) : null}
                          {k.active ? null : (
                            <span className="text-[10px] text-fg-faint">pasif</span>
                          )}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-fg-muted">{k.body}</p>
                      </>
                    )}
                  </div>
                  {duzenlenen === k.id ? null : (
                    <div className="flex shrink-0 gap-1">
                      <MiniBtn onClick={() => tasi(i, -1)} disabled={calisiyor || i === 0}>
                        ↑
                      </MiniBtn>
                      <MiniBtn
                        onClick={() => tasi(i, 1)}
                        disabled={calisiyor || i === kurallar.length - 1}
                      >
                        ↓
                      </MiniBtn>
                      <MiniBtn onClick={() => setDuzenlenen(k.id)} disabled={calisiyor}>
                        düzenle
                      </MiniBtn>
                      <MiniBtn
                        onClick={() =>
                          istek(
                            `/rules/${k.id}`,
                            k.active ? 'DELETE' : 'PATCH',
                            k.active ? undefined : { active: true },
                          )
                        }
                        disabled={calisiyor}
                      >
                        {k.active ? 'kaldır' : 'geri al'}
                      </MiniBtn>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function MiniBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-border px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Duzenle({
  kural,
  calisiyor,
  onKaydet,
  onVazgec,
}: {
  kural: Kural;
  calisiyor: boolean;
  onKaydet: (d: { title: string; body: string; category: string | null }) => void;
  onVazgec: () => void;
}) {
  const [title, setTitle] = useState(kural.title);
  const [body, setBody] = useState(kural.body);
  const [category, setCategory] = useState(kural.category ?? '');

  return (
    <div className="space-y-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        className="min-h-24 w-full rounded border border-border bg-bg px-3 py-2 text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <Input
        placeholder="Kategori"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          onClick={() => onKaydet({ title, body, category: category.trim() || null })}
          disabled={calisiyor}
        >
          Kaydet
        </Button>
        <Button variant="ghost" onClick={onVazgec} disabled={calisiyor}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
