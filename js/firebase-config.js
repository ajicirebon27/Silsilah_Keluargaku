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
// CACHE LOKAL (IndexedDB) -- supaya:
//  1) Data yang sudah pernah dimuat tetap tersedia secara instan dari cache
//     lokal saat halaman dibuka lagi / tab admin dipindah-pindah, TANPA
//     harus menembak Firestore ulang setiap kali (mengurangi kuota baca
//     Firestore & terasa lebih cepat, terutama koneksi lambat).
//  2) synchronizeTabs:true membuat cache ini DIBAGI antar-tab yang dibuka
//     dari browser yang sama -- kalau admin membuka 2 tab, keduanya
//     memakai satu cache & listener yang sama alih-alih rebutan koneksi.
// Ini TIDAK sama dengan real-time sync antar-PERANGKAT/pengguna berbeda --
// untuk itu, lihat PeopleAPI.subscribe()/MarriageAPI.subscribe() di db.js
// yang memakai onSnapshot() supaya perubahan dari admin lain (perangkat
// lain) juga langsung terlihat tanpa reload manual.
// Gagal aktif (mis. browser tidak mendukung, atau mode privat) BUKAN error
// fatal -- aplikasi tetap jalan seperti biasa, cuma tanpa cache offline.
try {
  db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('Cache offline Firestore tidak aktif: ada tab lain yang belum mendukung synchronizeTabs.');
    } else if (err.code === 'unimplemented') {
      console.warn('Cache offline Firestore tidak didukung browser ini.');
    } else {
      console.warn('Cache offline Firestore gagal diaktifkan:', err);
    }
  });
} catch (e) { /* abaikan -- aplikasi tetap berjalan tanpa cache offline */ }
