import { AppNav } from '@/components/app-nav';
import { getMe, publicApiUrl } from '@/lib/api';
import './globals.css';

/**
 * Kök yerleşim.
 *
 * Navigasyon BURADA, sayfalarda değil: her sayfanın kendi geri bağlantısını
 * taşıması tutarsızlık üretiyordu (profil bir yere, yetkiler başka yere
 * dönüyordu) ve çıkış düğmesi hiçbir sayfaya konmamıştı.
 *
 * Yükseklik zinciri: çubuk sabit, altındaki alan kalanı dolduruyor.
 * Kontrol paneli ve profil kendi içlerinde kayan paneller kullandığı için
 * bu zincir olmadan taşıyorlardı.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();

  return (
    <html lang="tr">
      <body>
        <div className="flex h-screen flex-col">
          {me ? (
            <AppNav
              apiUrl={publicApiUrl()}
              kullanici={me.discordUsername}
              izinler={me.permissions}
              superAdmin={me.systemRole === 'super_admin'}
            />
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </body>
    </html>
  );
}
