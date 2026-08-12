// =====================================================================
// BIRTHDAY.JS — util notifikasi ulang tahun.
// Dipakai bersama oleh tampilan publik (app.js) & panel admin (admin.js).
// Harus dimuat SETELAH db.js (pakai escapeHtml dari sana) dan SEBELUM
// app.js / admin.js.
// =====================================================================

const BirthdayUtil = (() => {

  // Ambil {tahun, bulan, tanggal} dari string tglLahir ("YYYY-MM-DD", hasil
  // <input type="date">) lewat regex, BUKAN lewat new Date(string) --
  // new Date('YYYY-MM-DD') selalu diparse sebagai tengah malam UTC, yang di
  // zona waktu Indonesia (UTC+7/+8/+9) bisa "mundur" jadi tanggal sebelumnya.
  // Parsing manual begini menghindari salah deteksi ulang tahun karena
  // pergeseran zona waktu itu.
  function parseTanggal(tglLahir) {
    if (!tglLahir || typeof tglLahir !== 'string') return null;
    const m = tglLahir.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return { tahun: parseInt(m[1], 10), bulan: parseInt(m[2], 10), tanggal: parseInt(m[3], 10) };
  }

  function isUlangTahunHariIni(tglLahir, today = new Date()) {
    const d = parseTanggal(tglLahir);
    if (!d) return false;
    return d.bulan === (today.getMonth() + 1) && d.tanggal === today.getDate();
  }

  // Umur yang genap DIRAYAKAN hari ini (tahun sekarang dikurangi tahun lahir).
  function getUmurGenap(tglLahir, today = new Date()) {
    const d = parseTanggal(tglLahir);
    if (!d) return null;
    return today.getFullYear() - d.tahun;
  }

  // Daftar orang yang berulang tahun HARI INI, diurutkan berdasarkan nama.
  // Orang yang sudah wafat (field tglWafat terisi) SENGAJA tidak disertakan
  // -- notifikasi ulang tahun ditujukan utk anggota keluarga yang masih
  // hidup, bukan mengingatkan tanggal lahir orang yang sudah meninggal.
  function getUlangTahunHariIni(people, today = new Date()) {
    return (people || [])
      .filter(p => p && !p.tglWafat && isUlangTahunHariIni(p.tglLahir, today))
      .map(p => ({ person: p, umur: getUmurGenap(p.tglLahir, today) }))
      .sort((a, b) => (a.person.nama || '').localeCompare(b.person.nama || '', 'id'));
  }

  return { isUlangTahunHariIni, getUmurGenap, getUlangTahunHariIni };
})();
