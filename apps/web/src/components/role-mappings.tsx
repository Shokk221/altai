'use client';

import { IzinSecici, hataMetni } from '@/components/izin-secici';
import { type SquadGroup, SquadGroups } from '@/components/squad-groups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { tarihSaat } from '@/lib/format';
import { PANEL_IZNI, PANEL_KUMELERI, SISTEM_ROLU, squadIzniAdi } from '@/lib/yetki-etiketleri';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

/**
 * Yetki yönetimi: Discord rolü → panel izinleri + oyun içi grup.
 *
 * Rollerin KAYNAĞI Discord. Panelde ayrı bir rol tanımı yok: Discord'daki
 * "Admin" rolüne burada izin verilir, Discord'da o rolü alan kişi panelde ve
 * oyunda yetkiyi kendiliğinden alır, rol alınınca kaybeder. Yetki her
 * istekte Discord rollerinden hesaplanıyor; çıkış yapıp girmek gerekmiyor.
 *
 * Önce rol kimliği elle yazılıyordu ve listede yalnızca 17 haneli sayılar
 * görünüyordu. Artık roller Discord'dan adı ve rengiyle geliyor; Discord'a
 * ulaşılamazsa elle kimlik girişine düşülüyor.
 */

export interface Mapping {
  id: string;
  discordRoleId: string;
  systemRole: string;
  panelPermissions: string[];
  squadGroup: string | null;
  uyeSayisi: number;
}

export interface DiscordRol {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

export interface Veri {
  mappings: Mapping[];
  squadGroups: SquadGroup[];
  /** null = Discord'a ulaşılamadı; ekran elle kimlik girişine düşer. */
  discordRoles: DiscordRol[] | null;
  discordHata: string | null;
  permissions: string[];
  systemRoles: string[];
  sonSenkron: string | null;
}

type Sekme = 'roller' | 'gruplar';

export function YetkiYonetimi({ apiUrl, veri }: { apiUrl: string; veri: Veri }) {
  const [sekme, setSekme] = useState<Sekme>('roller');

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        className="grid w-full max-w-sm grid-cols-2 gap-1 rounded-full bg-surface-sunken p-1"
      >
        {(
          [
            ['roller', 'Discord rolleri'],
            ['gruplar', 'Oyun grupları'],
          ] as const
        ).map(([k, ad]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={sekme === k}
            onClick={() => setSekme(k)}
            className={cn(
              'rounded-full py-1.5 text-footnote transition-colors',
              sekme === k ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
            )}
          >
            {ad}
          </button>
        ))}
      </div>

      {sekme === 'roller' ? (
        <RoleMappings apiUrl={apiUrl} veri={veri} />
      ) : (
        <SquadGroups apiUrl={apiUrl} gruplar={veri.squadGroups} />
      )}
    </div>
  );
}

/** Formda düzenlenen rol: Discord'dan gelen ya da yalnızca kimliği bilinen. */
interface Hedef {
  id: string;
  name: string | null;
  color: string | null;
}

function RoleMappings({ apiUrl, veri }: { apiUrl: string; veri: Veri }) {
  // Açık form: düzenlenen rolün kimliği, elle ekleme için 'elle'.
  const [acik, setAcik] = useState<string | null>(null);
  const [arama, setArama] = useState('');

  const eslemeler = useMemo(
    () => new Map(veri.mappings.map((m) => [m.discordRoleId, m])),
    [veri.mappings],
  );
  const discordRolleri = veri.discordRoles;
  const discordda = useMemo(
    () => new Map((discordRolleri ?? []).map((r) => [r.id, r])),
    [discordRolleri],
  );

  // Yetkili roller Discord'daki sırayla; Discord'da artık olmayan (ya da adı
  // okunamayan) eşlemeler sona. Silinmiş bir role bağlı eşleme gizlenmemeli:
  // kimse taşımıyor ama listede durup "bu ne" sorusunu sordurmalı.
  const yetkili: Hedef[] = [
    ...(discordRolleri ?? []).filter((r) => eslemeler.has(r.id)),
    ...veri.mappings
      .filter((m) => !discordda.has(m.discordRoleId))
      .map((m) => ({ id: m.discordRoleId, name: null, color: null })),
  ];

  const aranan = arama.trim().toLocaleLowerCase('tr');
  const digerleri = (discordRolleri ?? []).filter(
    (r) => !eslemeler.has(r.id) && (!aranan || r.name.toLocaleLowerCase('tr').includes(aranan)),
  );

  const formuAc = (id: string | null) => setAcik(id);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded border border-border bg-surface px-5 py-4">
        <p className="text-footnote text-fg">
          Discord'da birine rol verdiğinizde paneldeki ve oyundaki yetkisi kendiliğinden gelir; rolü
          aldığınızda düşer. Çıkış yapıp girmesi gerekmez.
        </p>
        <p className="mt-1 text-2xs text-fg-faint">
          Son tam rol taraması: {veri.sonSenkron ? tarihSaat(veri.sonSenkron) : 'hiç yapılmadı'}
        </p>
      </div>

      {discordRolleri === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-warn-line bg-warn-weak px-5 py-4">
          <p className="max-w-[60ch] text-footnote text-fg">
            Discord rolleri okunamadı
            {veri.discordHata === 'yapilandirilmamis' ? ' (bot token tanımlı değil)' : ''}. Mevcut
            eşlemeler düzenlenebilir; yeni rol için kimliği elle girin.
          </p>
          {acik === null ? (
            <Button size="sm" variant="soft" onClick={() => formuAc('elle')}>
              Kimlikle ekle
            </Button>
          ) : null}
        </div>
      ) : null}

      {acik === 'elle' ? (
        <RolFormu
          apiUrl={apiUrl}
          veri={veri}
          hedef={null}
          mevcut={null}
          kapat={() => formuAc(null)}
        />
      ) : null}

      <section>
        <h2 className="mb-2 text-subhead font-semibold">Yetkili roller</h2>
        {yetkili.length === 0 ? (
          <p className="rounded border border-border bg-surface px-5 py-8 text-center text-sm text-fg-muted">
            Henüz hiçbir role yetki verilmedi. Aşağıdan bir Discord rolü seçin.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {yetkili.map((r) => {
              const m = eslemeler.get(r.id);
              if (!m) return null;
              return acik === r.id ? (
                <li key={r.id}>
                  <RolFormu
                    apiUrl={apiUrl}
                    veri={veri}
                    hedef={r}
                    mevcut={m}
                    kapat={() => formuAc(null)}
                  />
                </li>
              ) : (
                <li key={r.id} className="rounded border border-border bg-surface px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <RolAdi rol={r} bilinmiyor={discordRolleri !== null} />
                    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-2xs font-medium text-fg-muted">
                      {SISTEM_ROLU[m.systemRole]?.ad ?? m.systemRole}
                    </span>
                    <span
                      className={cn(
                        'ml-auto text-2xs font-semibold',
                        m.uyeSayisi > 0 ? 'text-info' : 'text-fg-faint',
                      )}
                    >
                      {m.uyeSayisi} kişide
                    </span>
                  </div>
                  <dl className="mt-2 grid gap-1 text-footnote sm:grid-cols-[7rem_1fr]">
                    <dt className="text-fg-faint">Panel</dt>
                    <dd className="text-fg-muted">
                      {m.systemRole === 'super_admin'
                        ? 'Her şey'
                        : m.panelPermissions
                            .filter((p) => PANEL_IZNI[p])
                            .map((p) => PANEL_IZNI[p]?.ad)
                            .join(' · ') || 'Hiçbir izin yok'}
                    </dd>
                    <dt className="text-fg-faint">Oyun</dt>
                    <dd className="text-fg-muted">
                      {m.squadGroup ? (
                        <GrupOzeti ad={m.squadGroup} gruplar={veri.squadGroups} />
                      ) : (
                        'Oyun içi yetki yok'
                      )}
                    </dd>
                  </dl>
                  {acik === null ? (
                    <div className="mt-3">
                      <Button size="sm" variant="soft" onClick={() => formuAc(r.id)}>
                        Düzenle
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {discordRolleri !== null ? (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-subhead font-semibold">
              Diğer Discord rolleri{' '}
              <span className="num text-footnote font-normal text-fg-faint">
                {discordRolleri.length - yetkili.filter((r) => discordda.has(r.id)).length}
              </span>
            </h2>
            <Input
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              placeholder="Rol ara"
              className="min-h-9 w-full max-w-56 px-3"
            />
          </div>
          {digerleri.length === 0 ? (
            <p className="rounded border border-border bg-surface px-5 py-6 text-center text-footnote text-fg-muted">
              {aranan ? 'Eşleşen rol yok' : 'Bütün rollere yetki verilmiş'}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded border border-border bg-surface">
              {digerleri.map((r) =>
                acik === r.id ? (
                  <li key={r.id} className="p-2">
                    <RolFormu
                      apiUrl={apiUrl}
                      veri={veri}
                      hedef={r}
                      mevcut={null}
                      kapat={() => formuAc(null)}
                    />
                  </li>
                ) : (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                    <RolAdi rol={r} bilinmiyor={false} />
                    {acik === null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => formuAc(r.id)}
                      >
                        Yetki ver
                      </Button>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** Rol adı, Discord'daki rengiyle. Adı bilinmiyorsa kimlik gösteriliyor. */
function RolAdi({ rol, bilinmiyor }: { rol: Hedef; bilinmiyor: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-fg-faint"
        style={rol.color ? { backgroundColor: rol.color } : undefined}
      />
      {rol.name ? (
        <span className="truncate font-semibold">{rol.name}</span>
      ) : (
        <span className="truncate font-mono text-footnote text-fg-muted">
          {rol.id}
          {bilinmiyor ? (
            <span className="ml-2 font-sans text-warn">Discord'da bulunamadı</span>
          ) : null}
        </span>
      )}
    </span>
  );
}

function GrupOzeti({ ad, gruplar }: { ad: string; gruplar: SquadGroup[] }) {
  const g = gruplar.find((x) => x.name === ad);
  if (!g) return <span className="text-warn">{ad} (grup bulunamadı)</span>;
  return (
    <span>
      <span className="font-medium text-fg">{g.name}</span>
      {g.squadPermissions.length > 0 ? ` · ${g.squadPermissions.map(squadIzniAdi).join(', ')}` : ''}
    </span>
  );
}

const SECIM =
  'min-h-11 w-full rounded-sm border border-border-strong bg-surface-sunken px-3.5 text-sm text-fg';

function RolFormu({
  apiUrl,
  veri,
  hedef,
  mevcut,
  kapat,
}: {
  apiUrl: string;
  veri: Veri;
  /** null = elle kimlik girişi (Discord'a ulaşılamadığında). */
  hedef: Hedef | null;
  mevcut: Mapping | null;
  kapat: () => void;
}) {
  const router = useRouter();
  const [roleId, setRoleId] = useState(hedef?.id ?? '');
  const [systemRole, setSystemRole] = useState(mevcut?.systemRole ?? 'moderator');
  // Ekranda gösterilmeyen izinler (ör. hiçbir yerde denetlenmeyen
  // `super_admin`) de state'te tutuluyor: kaydederken sessizce silinmesin.
  const [izinler, setIzinler] = useState<string[]>(mevcut?.panelPermissions ?? ['player.view']);
  const [squadGroup, setSquadGroup] = useState(mevcut?.squadGroup ?? '');
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const izinDegistir = (p: string) =>
    setIzinler((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]));

  // Aynı adlı (sunucuya özel) gruplar seçimde bir kez görünsün.
  const gruplar = [...new Map(veri.squadGroups.map((g) => [g.name, g])).values()];
  const seciliGrup = gruplar.find((g) => g.name === squadGroup);
  const superAdmin = systemRole === 'super_admin';

  async function kaydet() {
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}/role-mappings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          discordRoleId: roleId.trim(),
          systemRole,
          panelPermissions: izinler,
          squadGroup: squadGroup || null,
        }),
      });
      if (!res.ok) {
        setHata(await hataMetni(res, 'Kaydedilemedi'));
        return;
      }
      kapat();
      router.refresh();
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  async function yetkiyiKaldir() {
    if (!mevcut) return;
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}/role-mappings/${mevcut.id}/delete`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setHata(await hataMetni(res, 'Kaldırılamadı'));
        return;
      }
      kapat();
      router.refresh();
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  return (
    <div className="rounded border border-accent-line bg-surface p-5">
      {hedef ? (
        <div className="flex flex-wrap items-center gap-3">
          <RolAdi rol={hedef} bilinmiyor={false} />
          {mevcut && mevcut.uyeSayisi > 0 ? (
            <span className="text-2xs text-info">
              {mevcut.uyeSayisi} kişide · değişiklik hemen geçerli olur
            </span>
          ) : null}
        </div>
      ) : (
        <label htmlFor="role-id" className="flex max-w-sm flex-col gap-1.5">
          <span className="text-xs font-semibold text-fg-muted">Discord rol kimliği</span>
          <Input
            id="role-id"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value.replace(/\D/g, ''))}
            placeholder="1223818310739693568"
            inputMode="numeric"
          />
          <span className="text-2xs text-fg-faint">
            Discord'da geliştirici modunu açıp role sağ tıklayın, "Kimliği kopyala".
          </span>
        </label>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-fg-muted">Panel seviyesi</span>
          <select
            value={systemRole}
            onChange={(e) => setSystemRole(e.target.value)}
            className={SECIM}
          >
            {veri.systemRoles.map((r) => (
              <option key={r} value={r}>
                {SISTEM_ROLU[r]?.ad ?? r}
              </option>
            ))}
          </select>
          <span className={cn('text-2xs', superAdmin ? 'text-warn' : 'text-fg-faint')}>
            {SISTEM_ROLU[systemRole]?.aciklama}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-fg-muted">Oyun içi grup</span>
          <select
            value={squadGroup}
            onChange={(e) => setSquadGroup(e.target.value)}
            className={SECIM}
          >
            <option value="">Oyunda yetki yok</option>
            {gruplar.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
                {g.grantMode === 'manual' ? ' (whitelist)' : ''}
              </option>
            ))}
          </select>
          <span className="text-2xs text-fg-faint">
            {seciliGrup
              ? seciliGrup.squadPermissions.map(squadIzniAdi).join(', ') || 'Bu grupta izin yok'
              : 'Grupları "Oyun grupları" sekmesinden düzenleyin.'}
          </span>
        </label>
      </div>

      <fieldset className={cn('mt-5', superAdmin && 'opacity-50')} disabled={superAdmin}>
        <legend className="mb-2 text-xs font-semibold text-fg-muted">Panel izinleri</legend>
        <IzinSecici
          kumeler={PANEL_KUMELERI}
          sozluk={PANEL_IZNI}
          secili={izinler}
          degistir={izinDegistir}
        />
      </fieldset>

      {hata ? <p className="mt-3 text-footnote font-medium text-danger">{hata}</p> : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={kaydet} disabled={bekliyor || roleId.trim().length < 17}>
          {bekliyor ? 'Kaydediliyor…' : mevcut ? 'Kaydet' : 'Yetki ver'}
        </Button>
        <Button variant="ghost" onClick={kapat} disabled={bekliyor}>
          Vazgeç
        </Button>
        {mevcut ? (
          <Button
            variant="ghost"
            onClick={yetkiyiKaldir}
            disabled={bekliyor}
            className="ml-auto text-danger hover:text-danger"
          >
            Yetkiyi kaldır
          </Button>
        ) : null}
      </div>
    </div>
  );
}
