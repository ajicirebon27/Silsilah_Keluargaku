// =====================================================================
// TEMA TERANG / GELAP (v22)
// -----------------------------------------------------------------------
// File terpisah & berdiri sendiri (tidak menyentuh app.js/admin.js) supaya
// fitur ganti tema ini murni tambahan tampilan, tidak berisiko mengganggu
// logika aplikasi yang sudah ada. Atribut data-theme di <html> SUDAH
// diterapkan lebih dulu oleh script kecil di <head> index.html/admin.html
// (sebelum CSS/konten dirender, supaya tidak "kedip" balik ke terang) --
// file ini hanya mengurus KLIK tombolnya & menyimpan pilihan ke
// localStorage supaya konsisten dipakai lagi saat kunjungan berikutnya.
// =====================================================================
(function () {
  var STORAGE_KEY = 'silsilah-theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
  }

  function toggleTheme() {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  // Bisa ada lebih dari 1 tombol toggle di halaman yang sama (mis. di
  // admin.html: satu di layar login/auth-screen, satu lagi di topbar
  // dashboard admin) -- semuanya dipasangi listener yang sama.
  document.querySelectorAll('#btn-theme-toggle, #btn-theme-toggle-auth').forEach(function (btn) {
    btn.addEventListener('click', toggleTheme);
  });
})();
