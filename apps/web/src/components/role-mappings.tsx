'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { tarihSaat } from '@/lib/format';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Rol eşlemesi yönetimi.
 *
 * Yetki zincirinin başlangıcı: Discord rolü → panel izinleri + oyun içi grup.
 * Şimdiye kadar yalnızca komut satırından yapılabiliyordu, yani yetki
 * dağıtımı sunucuya SSH erişimi olan kişiye bağlıydı.
 *
 * Her satırda o rolü KAÇ KİŞİNİN taşıdığı yazıyor. Bir eşlemeyi
 * değiştirmeden önce sorulması gereken soru bu — "admin" rolüne süper admin
 * vermek 34 kişiyi süper admin yapar.
 */

export interface Mapping {
  id: string;
  discordRoleId: string;
  systemRole: string;
  panelPermissions: string[];
  squadGroup: string | null;
  uyeSayisi: number;
}

export interface SquadGroup {
  name: string;
  squadPermissions: string;
  grantMode: string;
}

export interface Veri {
  mappings: Mapping[];
  squadGroups: SquadGroup[];
  permissions: string[];
  systemRoles: string[];
  sonSenkron: string | null;
}

const ROL_ETIKET: Record<string, string> = {
  super_admin: 'Süper Admin',
  admin: 'Admin',
  moderator: 'Moderatör',
  clan_leader: 'Klan Lideri',
  member: 'Üye',
};

export function RoleMappings({ apiUrl, veri }: { apiUrl: string; veri: Veri }) {
  const router = useRouter();
  const [duzenlenen, setDuzenlenen] = useState<Mapping | 'yeni' | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  async function sil(m: Mapping) {
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}/role-mappings/${m.id}/delete`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setHata('Eşleme silinemedi');
        return;
      }
      router.refresh();
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-muted">
          Son rol senkronu: {veri.sonSenkron ? tarihSaat(veri.sonSenkron) : 'hiç yapılmadı'}
        </p>
        <Button size="sm" onClick={() => setDuzenlenen('yeni')}>
          Yeni eşleme
        </Button>
      </div>

      {hata ? <p className="text-sm font-medium text-danger">{hata}</p> : null}

      {duzenlenen ? (
        <Form
          apiUrl={apiUrl}
          veri={veri}
          mevcut={duzenlenen === 'yeni' ? null : duzenlenen}
          kapat={() => setDuzenlenen(null)}
        />
      ) : null}

      {veri.mappings.length === 0 ? (
        <p className="rounded border border-border bg-surface px-5 py-8 text-center text-sm text-fg-muted">
          Hiç eşleme yok. Eşleme olmadan Discord'la giren kimse yetki alamaz.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {veri.mappings.map((m) => (
            <li key={m.id} className="rounded border border-border bg-surface px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-semibold">{ROL_ETIKET[m.systemRole] ?? m.systemRole}</span>
                {m.squadGroup ? (
                  <span className="rounded-full bg-accent-weak px-2.5 py-0.5 text-[11px] font-medium text-accent-2">
                    oyun: {m.squadGroup}
                  </span>
                ) : (
                  <span className="text-[11px] text-fg-faint">oyun içi yetki yok</span>
                )}
                <span className="text-[11px] text-fg-faint">
                  {m.panelPermissions.length} panel izni
                </span>
                <span
                  className={cn(
                    'text-[11px] font-semibold',
                    m.uyeSayisi > 0 ? 'text-info' : 'text-fg-muted',
                  )}
                >
                  {m.uyeSayisi} kişi taşıyor
                </span>
                <span className="ml-auto font-mono text-[11px] text-fg-faint">
                  {m.discordRoleId}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="soft" onClick={() => setDuzenlenen(m)}>
                  Düzenle
                </Button>
                <Button size="sm" variant="ghost" onClick={() => sil(m)} disabled={bekliyor}>
                  Sil
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Form({
  apiUrl,
  veri,
  mevcut,
  kapat,
}: {
  apiUrl: string;
  veri: Veri;
  mevcut: Mapping | null;
  kapat: () => void;
}) {
  const router = useRouter();
  const [roleId, setRoleId] = useState(mevcut?.discordRoleId ?? '');
  const [systemRole, setSystemRole] = useState(mevcut?.systemRole ?? 'moderator');
  const [izinler, setIzinler] = useState<string[]>(mevcut?.panelPermissions ?? []);
  const [squadGroup, setSquadGroup] = useState(mevcut?.squadGroup ?? '');
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const izinDegistir = (p: string) =>
    setIzinler((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]));

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
        const g = (await res.json().catch(() => ({}))) as { error?: string; detay?: string };
        setHata(g.detay ? `${g.error}: ${g.detay}` : (g.error ?? 'Kaydedilemedi'));
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
    <div className="rounded border border-border bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="role-id" className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-fg-muted">Discord rol kimliği</span>
          <Input
            id="role-id"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value.replace(/\D/g, ''))}
            placeholder="1223818310739693568"
            disabled={mevcut !== null}
            inputMode="numeric"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-fg-muted">Panel rolü</span>
          <select
            value={systemRole}
            onChange={(e) => setSystemRole(e.target.value)}
            className="min-h-11 rounded-sm border border-border-strong bg-surface-sunken px-3.5 text-sm text-fg"
          >
            {veri.systemRoles.map((r) => (
              <option key={r} value={r}>
                {ROL_ETIKET[r] ?? r}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-semibold text-fg-muted">
            Oyun içi grup (Admins.cfg) — boş bırakılırsa oyunda yetki vermez
          </span>
          <select
            value={squadGroup}
            onChange={(e) => setSquadGroup(e.target.value)}
            className="min-h-11 rounded-sm border border-border-strong bg-surface-sunken px-3.5 text-sm text-fg"
          >
            <option value="">— yok —</option>
            {veri.squadGroups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name} ({g.grantMode === 'discord' ? 'yetkili' : 'whitelist'})
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-semibold text-fg-muted">Panel izinleri</legend>
        <div className="flex flex-wrap gap-1.5">
          {veri.permissions.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => izinDegistir(p)}
              className={cn(
                'rounded-full px-3 py-1.5 font-mono text-[11px] font-medium transition-colors',
                izinler.includes(p)
                  ? 'bg-accent-weak text-accent-2'
                  : 'bg-surface-2 text-fg-muted hover:text-fg',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </fieldset>

      {hata ? <p className="mt-3 text-sm font-medium text-danger">{hata}</p> : null}

      <div className="mt-4 flex gap-2">
        <Button onClick={kaydet} disabled={bekliyor || roleId.trim().length < 17}>
          {bekliyor ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
        <Button variant="ghost" onClick={kapat} disabled={bekliyor}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
