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
