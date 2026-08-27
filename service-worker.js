// v8: lengkapi daftar cache -- sebelumnya admin.html & sejumlah file JS/ikon
// TIDAK ikut dicache, jadi panel admin (dan ikon PWA) gagal terbuka sama
// sekali saat offline walau tampilan publik sudah bisa. Sekarang app-shell
// (semua file statis) benar-benar lengkap, supaya baik tampilan publik
// maupun admin bisa dibuka offline (data orang/pernikahan sendiri diambil
// dari cache Firestore -- lihat enablePersistence() di js/firebase-config.js).
// v9: tambahkan js/theme.js yang TERLEWAT dari daftar v8 -- file ini dimuat
// oleh index.html maupun admin.html (toggle mode terang/gelap), tapi
// sebelumnya tidak ikut dicache app-shell, jadi request-nya bisa gagal saat
// offline (mis. instalasi baru yang langsung dipakai tanpa sinyal).
// v10: tambahkan favicon.ico, apple-touch-icon.png, & 2 ikon maskable baru
// (icon-maskable-192/512.png) -- ditambahkan saat ikon PWA diganti dari
// placeholder generik ke desain "pohon silsilah" (lihat manifest.json &
// index.html/admin.html <link rel="icon">/<link rel="apple-touch-icon">).
// Tanpa masuk daftar ini, ikon baru gagal tampil saat app dibuka offline.
const CACHE_NAME = 'silsilah-cache-v13';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './css/style.css',
  './js/firebase-config.js',
  './js/db.js',
  './js/birthday.js',
  './js/tree.js',
  './js/app.js',
  './js/admin.js',
  './js/theme.js',
  './js/searchable-select.js',
  './manifest.json',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Strategi: coba jaringan dulu (data selalu terbaru), fallback ke cache jika offline.
// PENTING: hanya dipakai utk file statis app-shell milik situs sendiri
// (same-origin). Request ke Firestore (firestore.googleapis.com) & CDN
// Firebase (gstatic.com) SENGAJA dibiarkan lewat apa adanya (tidak
// di-intercept) -- kalau ikut dicegat lalu gagal fallback ke cache (tidak
// ada di cache), service worker bisa mengembalikan respons rusak yang
// malah mengacaukan mekanisme retry/offline bawaan Firestore SDK, yang
// sudah punya cara sendiri yang lebih andal menangani koneksi terputus
// (lihat enablePersistence() di js/firebase-config.js).
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
