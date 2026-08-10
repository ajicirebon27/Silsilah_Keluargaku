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
// INSTANCE FIREBASE KEDUA (khusus buat akun admin baru dari Panel Admin)
// =====================================================================
// Firebase Auth (client SDK) punya perilaku bawaan: begitu
// createUserWithEmailAndPassword() dipanggil, sesi login otomatis PINDAH
// ke akun yang baru dibuat -- ini akan membuat admin utama yang sedang
// login otomatis ter-logout tiap kali membuat admin baru, kalau dipanggil
// lewat variabel `auth` yang sama. Solusinya: pakai instance app Firebase
// KEDUA (nama unik) khusus untuk proses pembuatan akun -- sesi login di
// `auth` (instance utama/pertama) sama sekali tidak tersentuh.
function getSecondaryAuth() {
  let secondaryApp;
  try {
    secondaryApp = firebase.app('SecondaryAdminCreate');
  } catch (e) {
    secondaryApp = firebase.initializeApp(firebaseConfig, 'SecondaryAdminCreate');
  }
  return secondaryApp.auth();
}
