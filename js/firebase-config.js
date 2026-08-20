// =====================================================================
// KONFIGURASI FIREBASE
// =====================================================================
// Ganti nilai-nilai di bawah ini dengan kredensial project Firebase-mu.
// Cara mendapatkannya ada di README.md bagian "Setup Firebase".
// =====================================================================

const firebaseConfig = {
  apiKey: "AIzaSyDfDCWwwmdh8ph17zmJbOx1faWAfmCz1c0",
  authDomain: "jejak-silsilah.firebaseapp.com",
  projectId: "jejak-silsilah",
  storageBucket: "jejak-silsilah.firebasestorage.app",
  messagingSenderId: "405052281053",
  appId: "1:405052281053:web:fe5abd3f11bbc2723d0b34"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();

// =====================================================================
// CACHE OFFLINE (IndexedDB) -- supaya pohon keluarga tetap bisa dibuka
// walau HP sedang tanpa koneksi internet.
// Tanpa ini, service worker cuma menyimpan file HTML/CSS/JS (cangkang
// aplikasi) -- begitu offline, halaman tetap terbuka tapi kosong karena
// data orang/pernikahan gagal dimuat dari Firestore. Dengan
// enablePersistence(), Firestore SDK menyimpan salinan data yang PERNAH
// berhasil dimuat ke IndexedDB perangkat. Setelah itu, pemanggilan
// `.get()` biasa (dipakai di seluruh PeopleAPI/MarriageAPI/dst, lihat di
// bawah) otomatis: coba ke server dulu selagi online, dan diam-diam jatuh
// ke cache tersimpan ini kalau server tak terjangkau -- tidak perlu ubah
// kode pemanggilnya sama sekali.
// synchronizeTabs:true supaya kalau situs dibuka di beberapa tab
// browser yang sama, semua tab berbagi 1 cache (bukan rebutan lock dan
// gagal di tab ke-2 dst).
let firestoreOfflineReady = false;
const firestoreOfflineReadyPromise = db.enablePersistence({ synchronizeTabs: true })
  .then(() => { firestoreOfflineReady = true; })
  .catch(err => {
    // 'failed-precondition': browser tidak mendukung (jarang, mis. versi
    // sangat lama) atau IndexedDB diblokir. 'unimplemented': mode
    // penyamaran/incognito di sebagian browser mematikan IndexedDB persisten.
    // Kedua kasus ini TIDAK fatal -- aplikasi tetap jalan normal selagi
    // online, hanya saja mode offline tidak akan berfungsi di perangkat itu.
    firestoreOfflineReady = false;
    console.warn('Cache offline Firestore tidak aktif (' + err.code + '). Aplikasi tetap berjalan normal selagi ada koneksi internet.');
  });
