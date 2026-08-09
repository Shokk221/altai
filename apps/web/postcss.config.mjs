/**
 * Bu dosya OLMADAN Tailwind hiç çalışmıyor.
 *
 * Next, PostCSS eklentilerini yalnızca bu yapılandırmayı görürse yüklüyor.
 * Dosya yokken derleme hata VERMİYOR: globals.css olduğu gibi, `@tailwind`
 * ve `@apply` direktifleri ham metin olarak çıktıya kopyalanıyor. Tarayıcı
 * bunları anlamadığı için sayfa tamamen stilsiz görünüyordu — 626 baytlık
 * bir CSS dosyası sunuluyordu ve HTTP 200 döndüğü için sorun uzaktan
 * fark edilmiyordu.
 *
 * Sessiz başarısızlık olduğu için: değiştirirken derlenen CSS'in boyutuna
 * bakın, sıfırdan büyük olması yetmez.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
