// =====================================================================
// DB HELPERS
// Struktur data di Firestore:
//   people      : { nama, jenisKelamin, alias, tglLahir, tglWafat, tempatLahir,
//                   agama, pekerjaan, alamat, kontak, fotoUrl, catatan, createdAt }
//   marriages   : { orangId1, orangId2 (bisa null = orang tua tunggal belum diketahui),
//                   urutanPasangan, childIds: [], createdAt }
//   comments    : { orangId, namaPengirim, isiKomentar, sudahDibaca, waktuKirim }
//   settings/app: { judulAplikasi, rootPersonId,
//                    backgroundType: 'default' | 'image' | 'color',
//                    backgroundImage (base64, hanya jika backgroundType='image'),
//                    backgroundColor (hex/gradient CSS, hanya jika backgroundType='color') }
//   settings/admin: { exists: true }
// =====================================================================

// Escape karakter HTML berbahaya sebelum dimasukkan ke innerHTML lewat template
// string -- dipakai di HAMPIR SEMUA file (db.js dimuat paling awal di kedua
// halaman, jadi ini satu-satunya definisi; sebelumnya sempat terduplikasi
// persis sama di tree.js & admin.js -- v14: disatukan di sini supaya tidak
// ada risiko 2 salinan yang diam-diam berbeda kalau salah satunya diedit).
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// Hitung usia (dalam tahun genap) dari tglLahir -- dipakai bareng oleh filter
// "Rentang Usia" (tab Data Orang admin) & statistik "Usia Rata-rata per
// Generasi" (Dashboard admin). Kalau orangnya sudah wafat (tglWafat terisi),
// yang dihitung adalah usia SAAT WAFAT (bukan usia kalau masih hidup sampai
// sekarang) -- lebih masuk akal utk data leluhur yang sudah lama meninggal.
// Kalau tglLahir kosong/tidak valid, return null (dianggap "tidak diketahui",
// BUKAN 0) supaya tidak mencemari rata-rata atau lolos filter rentang usia
// secara keliru.
//
// Parsing tanggal dilakukan manual lewat regex (bukan `new Date(string)`)
// dengan alasan yang sama seperti BirthdayUtil.parseTanggal() di
// birthday.js: menghindari salah hitung karena new Date('YYYY-MM-DD')
// selalu diparse sebagai tengah malam UTC, yang bisa "mundur" 1 hari di
// zona waktu Indonesia.
function getUsiaTahun(tglLahir, tglWafat, today = new Date()) {
  if (!tglLahir || typeof tglLahir !== 'string') return null;
  const mLahir = tglLahir.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!mLahir) return null;
  const lahir = { tahun: parseInt(mLahir[1], 10), bulan: parseInt(mLahir[2], 10), tanggal: parseInt(mLahir[3], 10) };

  let acuan = { tahun: today.getFullYear(), bulan: today.getMonth() + 1, tanggal: today.getDate() };
  if (tglWafat && typeof tglWafat === 'string') {
    const mWafat = tglWafat.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mWafat) acuan = { tahun: parseInt(mWafat[1], 10), bulan: parseInt(mWafat[2], 10), tanggal: parseInt(mWafat[3], 10) };
  }

  let usia = acuan.tahun - lahir.tahun;
  // Kurangi 1 kalau ulang tahun di tahun acuan belum lewat (mis. lahir
  // Desember, dihitung per Januari tahun yg sama -> belum genap setahun).
  if (acuan.bulan < lahir.bulan || (acuan.bulan === lahir.bulan && acuan.tanggal < lahir.tanggal)) {
    usia -= 1;
  }
  return usia >= 0 ? usia : null; // jaga-jaga data tanggal terbalik/salah input
}

// =====================================================================
// NOTIFIKASI "MODE SITUS DESKTOP" DI HP -- PENTING DIBACA:
// Tidak ada satupun kode website (HTML/CSS/JS) yang bisa MEMATIKAN toggle
// "Situs Desktop"/"Request Desktop Site" di browser HP secara otomatis.
// Itu sengaja dikunci di level browser -- sepenuhnya kendali pengguna,
// bukan website, demi keamanan & supaya pengguna yang punya kendali penuh
// (kalau website bisa mematikannya sendiri, toggle itu jadi tidak berguna).
// Yang REALISTIS bisa dilakukan cuma: mendeteksi kemungkinan besar toggle
// itu sedang aktif, lalu menampilkan pesan singkat yang mengarahkan
// pengguna mematikannya sendiri lewat menu browser.
//
// Deteksinya TIDAK memakai lebar viewport atau User-Agent -- dua hal itu
// justru sengaja "dipalsukan" oleh mode Situs Desktop (viewport dibuat
// lebar meniru layar besar, User-Agent kadang ikut diubah jadi versi
// desktop). Sinyal yang dipakai di sini justru yang TIDAK ikut berubah:
// kemampuan sentuh perangkat (navigator.maxTouchPoints / CSS pointer:coarse)
// dan resolusi fisik layar (screen.width/height, bukan window.innerWidth).
// HP dengan layar kecil TAPI viewport tiba-tiba lebar & bisa disentuh --
// itu ciri khas mode Situs Desktop sedang aktif.
// =====================================================================
function looksLikeForcedDesktopModeOnPhone() {
  try {
    const isTouchDevice = (navigator.maxTouchPoints || 0) > 0 ||
      (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const smallPhysicalScreen = Math.min(screen.width, screen.height) > 0 &&
      Math.min(screen.width, screen.height) <= 480;
    const wideViewportThanUsual = window.innerWidth > 700;
    return isTouchDevice && smallPhysicalScreen && wideViewportThanUsual;
  } catch (e) {
    return false;
  }
}

function initDesktopModeNotice() {
  if (!looksLikeForcedDesktopModeOnPhone()) return;

  const DISMISS_KEY = 'silsilahDesktopNoticeDismissedUntil';
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() < until) return; // baru saja ditutup pengguna, jangan tampilkan lagi dulu
  } catch (e) { /* localStorage tidak tersedia -- tetap lanjut tampilkan */ }

  const bar = document.createElement('div');
  bar.className = 'desktop-mode-notice';
  bar.innerHTML = `
    <span class="desktop-mode-notice-text">📱 Browser kamu sepertinya memakai mode
      <strong>"Situs Desktop"</strong>. Supaya tampilan lebih pas di HP, buka menu
      (⋮ / •••) browser lalu hilangkan centang
      <strong>"Situs Desktop"</strong> / <strong>"Request Desktop Site"</strong>.</span>
    <button type="button" class="desktop-mode-notice-close" aria-label="Tutup">&times;</button>
  `;
  document.body.appendChild(bar);

  bar.querySelector('.desktop-mode-notice-close').addEventListener('click', () => {
    bar.remove();
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000)); // jangan tampilkan lagi selama 7 hari
    } catch (e) { /* abaikan kalau localStorage diblokir */ }
  });
}

// Dijalankan segera -- db.js selalu dimuat lewat <script> di bagian bawah
// <body> (bukan di <head>), jadi document.body sudah pasti ada saat ini
// dieksekusi, di kedua halaman (publik & admin).
initDesktopModeNotice();

// =====================================================================
// INDIKATOR STATUS OFFLINE
// Muncul sebagai bar kecil di bawah layar setiap kali `navigator.onLine`
// mendeteksi koneksi terputus, dan hilang lagi begitu koneksi kembali.
// Ini murni indikator UX -- pemuatan data itu sendiri sudah otomatis
// jatuh ke cache Firestore (lihat `firebaseConfig.js` -> enablePersistence())
// begitu offline, jadi tanpa bar ini pun aplikasi tetap bisa dipakai;
// bar ini hanya supaya pengguna paham KENAPA data yang tampil mungkin
// bukan yang paling baru (mis. komentar/data terbaru dari admin belum
// tentu ikut ter-cache kalau belum pernah dimuat sebelumnya saat online).
// =====================================================================
function initOfflineStatusBanner() {
  let bar = null;

  function show() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'offline-status-banner';
    bar.innerHTML = firestoreOfflineReady
      ? `📡 Sedang offline -- menampilkan data tersimpan terakhir di perangkat ini. Data terbaru akan otomatis dimuat begitu koneksi kembali.`
      : `📡 Sedang offline -- data mungkin tidak bisa dimuat di perangkat/browser ini (cache offline tidak aktif).`;
    document.body.appendChild(bar);
  }
  function hide() {
    if (!bar) return;
    bar.remove();
    bar = null;
  }

  window.addEventListener('online', hide);
  window.addEventListener('offline', show);
  // Cek status begitu halaman dimuat (mis. dibuka langsung dalam keadaan offline).
  firestoreOfflineReadyPromise.finally(() => {
    if (!navigator.onLine) show();
  });
}
initOfflineStatusBanner();

// Pulihkan field bertipe Timestamp Firestore yang "rusak" jadi objek biasa
// {seconds, nanoseconds} setelah lewat JSON.stringify/parse (dipakai saat restore backup).
function restoreTimestampField(value) {
  if (value && typeof value.seconds === 'number') {
    return new firebase.firestore.Timestamp(value.seconds, value.nanoseconds || 0);
  }
  return firebase.firestore.FieldValue.serverTimestamp();
}

// Tulis banyak dokumen dengan ID aslinya (dipakai fitur Restore/Import backup).
// Firestore membatasi 500 operasi per batch, jadi dipecah per 400 biar aman.
async function writeInChunks(items, collectionName) {
  const CHUNK = 400;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = db.batch();
    items.slice(i, i + CHUNK).forEach(item => {
      const { id, ...data } = item;
      if (!id) return;
      if ('createdAt' in data) data.createdAt = restoreTimestampField(data.createdAt);
      batch.set(db.collection(collectionName).doc(id), data);
    });
    await batch.commit();
  }
}

const PeopleAPI = {
  // Hanya kembalikan orang yang TIDAK sedang di sampah -- ini yang dipakai
  // tampilan publik, tabel Data Orang, dan render pohon keluarga.
  async getAll() {
    const snap = await db.collection('people').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.deletedAt);
  },
  // Khusus daftar isi Sampah (tab admin).
  async getTrash() {
    const snap = await db.collection('people').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !!p.deletedAt);
  },
  async get(id) {
    const doc = await db.collection('people').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },
  async add(data) {
    const ref = await db.collection('people').add({
      ...data,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  },
  async update(id, data) {
    await db.collection('people').doc(id).update(data);
  },
  // "Hapus" dari Tab Data Orang kini adalah SOFT DELETE: dokumen orang cuma
  // ditandai deletedAt, bukan langsung dihapus permanen -- supaya klik yang
  // tidak sengaja masih bisa dipulihkan lewat tab Sampah. Data relasi
  // (marriages) SENGAJA tidak diubah sama sekali saat soft-delete, supaya
  // kalau dipulihkan, semua relasi otomatis utuh kembali seperti semula.
  async delete(id) {
    await db.collection('people').doc(id).update({
      deletedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },
  // Keluarkan lagi dari sampah.
  async restore(id) {
    await db.collection('people').doc(id).update({
      deletedAt: firebase.firestore.FieldValue.delete()
    });
  },
  // Hapus permanen (dipanggil dari tab Sampah). Ini logika hapus lama:
  // sungguh-sungguh menghapus dokumen orang + membersihkan semua rujukan
  // relasi (marriages) yang melibatkannya. TIDAK BISA DIBATALKAN.
  async hardDelete(id) {
    await db.collection('people').doc(id).delete();
    const snap = await db.collection('marriages').get();
    const batch = db.batch();
    snap.docs.forEach(doc => {
      const data = doc.data();
      const updates = {};
      if ((data.childIds || []).includes(id)) {
        updates.childIds = data.childIds.filter(cid => cid !== id);
      }
      if (data.orangId1 === id || data.orangId2 === id) {
        // Pernikahan yang melibatkan orang ini jadi tidak valid -> hapus sekalian
        batch.delete(doc.ref);
        return;
      }
      if (Object.keys(updates).length) batch.update(doc.ref, updates);
    });
    await batch.commit();
  },
  // Restore dari file backup JSON. Menulis kembali dengan ID ASLI supaya semua
  // referensi (orangId1/2, childIds pada marriages, orangId pada comments)
  // tetap nyambung persis seperti sebelum backup diambil.
  async importAll(peopleArr) {
    await writeInChunks(peopleArr, 'people');
  }
};

const MarriageAPI = {
  async getAll() {
    const snap = await db.collection('marriages').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async add(orangId1, orangId2, urutanPasangan) {
    const ref = await db.collection('marriages').add({
      orangId1, orangId2: orangId2 || null, urutanPasangan: urutanPasangan || 1, childIds: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  },
  async delete(id) {
    await db.collection('marriages').doc(id).delete();
  },
  async addChild(marriageId, childId) {
    await db.collection('marriages').doc(marriageId).update({
      childIds: firebase.firestore.FieldValue.arrayUnion(childId)
    });
  },
  async removeChild(marriageId, childId) {
    await db.collection('marriages').doc(marriageId).update({
      childIds: firebase.firestore.FieldValue.arrayRemove(childId)
    });
  },
  // Timpa TOTAL urutan childIds satu pernikahan (bukan arrayUnion/arrayRemove
  // yang cuma menambah/mengurangi) -- dipakai utk fitur naik/turun urutan
  // anak & urutkan-otomatis-berdasarkan-tanggal-lahir. Isi array harus
  // orang yang sama persis, cuma urutannya yang beda.
  async setChildOrder(marriageId, orderedChildIds) {
    await db.collection('marriages').doc(marriageId).update({ childIds: orderedChildIds });
  },
  // Tukar angka `urutanPasangan` antara 2 pernikahan sekaligus (1 batch
  // write) -- dipakai utk fitur naik/turun urutan istri/suami. Ditukar
  // bersamaan (bukan 2 update terpisah) supaya tidak pernah ada momen di
  // mana 2 pernikahan kebetulan punya urutanPasangan sama akibat gagal di
  // tengah jalan.
  async swapUrutanPasangan(marriageIdA, urutanA, marriageIdB, urutanB) {
    const batch = db.batch();
    batch.update(db.collection('marriages').doc(marriageIdA), { urutanPasangan: urutanB });
    batch.update(db.collection('marriages').doc(marriageIdB), { urutanPasangan: urutanA });
    await batch.commit();
  },
  // Cari pernikahan persis antara 2 orang tertentu (urutan tidak masalah).
  // Kalau salah satu null (orang tua tunggal), cari yang cocok dengan pola itu.
  findBetween(marriages, idA, idB) {
    return marriages.find(m => {
      const a = m.orangId1, b = m.orangId2;
      if (idA && idB) return (a === idA && b === idB) || (a === idB && b === idA);
      const known = idA || idB;
      return (a === known && !b) || (b === known && !a);
    }) || null;
  },
  // Cari atau buat pernikahan antara ayah & ibu (salah satu boleh null jika belum diketahui).
  async findOrCreate(ayahId, ibuId, marriages) {
    const existing = this.findBetween(marriages, ayahId, ibuId);
    if (existing) return existing.id;
    const knownId = ayahId || ibuId;
    const countSoFar = marriages.filter(m => m.orangId1 === knownId || m.orangId2 === knownId).length;
    return await this.add(ayahId, ibuId, countSoFar + 1);
  },
  // Tetapkan ayah/ibu untuk seorang anak. Melepas dari pernikahan lama jika berpindah.
  async setParents(childId, ayahId, ibuId, marriages) {
    // Lepas dulu dari semua pernikahan lama yang mencatatnya sebagai anak
    const batch = db.batch();
    marriages.forEach(m => {
      if ((m.childIds || []).includes(childId)) {
        batch.update(db.collection('marriages').doc(m.id), {
          childIds: firebase.firestore.FieldValue.arrayRemove(childId)
        });
      }
    });
    await batch.commit();

    if (!ayahId && !ibuId) return null;
    const marriageId = await this.findOrCreate(ayahId, ibuId, marriages);
    await this.addChild(marriageId, childId);
    return marriageId;
  },
  // Restore dari file backup JSON, ID pernikahan tetap sama seperti aslinya.
  async importAll(marriagesArr) {
    await writeInChunks(marriagesArr, 'marriages');
  }
};

const CommentAPI = {
  async getAll() {
    const snap = await db.collection('comments').orderBy('waktuKirim', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async getUnreadCount() {
    const snap = await db.collection('comments').where('sudahDibaca', '==', false).get();
    return snap.size;
  },
  // Batas panjang dijaga di 2 lapis: atribut maxlength di HTML (mencegah
  // pengetikan berlebih secara wajar) DAN di sini (mencegah orang yang sengaja
  // memanggil fungsi ini lewat console browser untuk mengirim teks raksasa).
  MAX_NAMA: 80,
  MAX_KOMENTAR: 1000,
  async add(orangId, namaPengirim, isiKomentar) {
    const namaAman = (namaPengirim || '').trim().slice(0, this.MAX_NAMA);
    const isiAman = (isiKomentar || '').trim().slice(0, this.MAX_KOMENTAR);
    if (!namaAman || !isiAman) throw new Error('Nama dan komentar tidak boleh kosong.');
    await db.collection('comments').add({
      orangId, namaPengirim: namaAman, isiKomentar: isiAman,
      sudahDibaca: false,
      waktuKirim: firebase.firestore.FieldValue.serverTimestamp()
    });
  },
  async markRead(id) {
    await db.collection('comments').doc(id).update({ sudahDibaca: true });
  },
  async delete(id) {
    await db.collection('comments').doc(id).delete();
  },
  // Restore dari file backup JSON, ID komentar tetap sama seperti aslinya.
  async importAll(commentsArr) {
    const fixed = commentsArr.map(c => ({
      ...c,
      waktuKirim: restoreTimestampField(c.waktuKirim)
    }));
    await writeInChunks(fixed, 'comments');
  }
};

// =====================================================================
// LOG AKTIVITAS ADMIN (audit log) -- v21.
// Mencatat SIAPA mengubah data APA dan KAPAN. Sebelumnya tidak ada
// pencatatan sama sekali -- kalau data leluhur berubah tak terduga atau
// suatu saat lebih dari 1 orang punya akses admin, tidak ada cara melacak
// siapa yang melakukannya. Sekarang setiap aksi tulis penting (tambah/ubah/
// hapus orang, atur relasi, hapus komentar, ubah pengaturan, impor/restore
// data, login admin) dicatat sebagai 1 entri di koleksi Firestore
// `auditLog`, dan bisa dilihat lewat tab **Log Aktivitas** (admin).
//
// Desain sengaja MINIMALIS (bukan sistem audit generik yang mencatat versi
// lama vs baru per-field) supaya tidak menambah ukuran dokumen/biaya baca-
// tulis Firestore secara berlebihan -- yang dicatat cukup: aksi apa
// (`action`), label singkat yang bisa dibaca manusia (`label`, mis. nama
// orang yang diubah), keterangan tambahan opsional (`detail`), serta siapa &
// kapan (`adminUid`/`adminEmail`/`waktu`). Ini cukup untuk menjawab
// pertanyaan "siapa yang menghapus data X, kapan?" tanpa perlu membaca ulang
// seluruh riwayat perubahan tiap field.
//
// Koleksi ini HANYA bisa dibaca & ditulis oleh admin yang login (lihat
// bagian Rules di README -- perlu publish ulang rules supaya proteksi ini
// aktif). Log bersifat tambah-saja dari sisi tampilan aplikasi (tidak ada
// tombol edit isi log) -- nilai sebuah catatan audit justru ada pada
// keasliannya. Admin tetap bisa membersihkan entri LAMA lewat tombol
// "Bersihkan log lebih lama dari 90 hari" di tab Log Aktivitas, murni untuk
// menjaga jumlah dokumen tidak menumpuk tanpa batas -- ini pruning atas
// permintaan eksplisit admin, bukan mengubah isi catatan yang masih relevan.
// =====================================================================
const AuditLogAPI = {
  MAX_LABEL: 200,
  MAX_DETAIL: 500,
  PAGE_SIZE: 30,

  // Mencatat 1 entri log. `action` adalah kode singkat (lihat peta label di
  // admin.js -> auditLogActionLabel()), `meta.label` adalah nama/identitas
  // yang jadi objek aksi (mis. nama orang), `meta.detail` keterangan
  // tambahan opsional (mis. ringkasan jumlah data saat impor).
  //
  // SENGAJA tidak melempar error ke pemanggil: mencatat log adalah aksi
  // SEKUNDER -- kalau gagal (mis. sedang offline), aksi utama admin (simpan
  // data orang, dst) TETAP harus berhasil dan tidak boleh ikut gagal gara-
  // gara log tidak tercatat. Kegagalan cukup dicatat ke console.
  async log(action, meta = {}) {
    try {
      const user = auth.currentUser;
      await db.collection('auditLog').add({
        action,
        label: meta.label ? String(meta.label).slice(0, this.MAX_LABEL) : null,
        detail: meta.detail ? String(meta.detail).slice(0, this.MAX_DETAIL) : null,
        adminUid: user ? user.uid : null,
        adminEmail: user ? user.email : null,
        waktu: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.warn('Gagal mencatat log aktivitas (tidak mempengaruhi aksi utama):', err.message);
    }
  },

  // Ambil 1 halaman log (terbaru dulu), dgn cursor Firestore utk "Muat
  // lebih banyak" -- dipakai tab Log Aktivitas supaya tidak menarik SEMUA
  // riwayat sekaligus kalau sudah menumpuk ribuan entri.
  async getPage(cursorDoc = null) {
    let q = db.collection('auditLog').orderBy('waktu', 'desc').limit(this.PAGE_SIZE);
    if (cursorDoc) q = q.startAfter(cursorDoc);
    const snap = await q.get();
    return {
      items: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length === this.PAGE_SIZE
    };
  },

  // Hapus semua entri log yang waktunya SEBELUM `beforeDate` (Date object).
  // Dipecah per 400 dokumen/batch (batas aman jauh di bawah limit 500
  // operasi/batch Firestore) supaya tetap aman kalau log yang dibersihkan
  // jumlahnya besar.
  async deleteOlderThan(beforeDate) {
    const snap = await db.collection('auditLog').where('waktu', '<', beforeDate).get();
    if (snap.empty) return 0;
    const docs = snap.docs;
    const BATCH_SIZE = 400;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    return docs.length;
  }
};

// =====================================================================
// GEDCOM -- format standar pertukaran data silsilah keluarga (dipakai
// Ancestry, MyHeritage, FamilySearch, Gramps, dll). Modul ini menangani
// EXPORT (data kita -> file .ged) dan IMPORT (file .ged dari aplikasi
// lain -> data kita). Cakupan yang didukung sengaja dibatasi ke tag-tag
// paling umum & relevan dgn skema data kita (NAME, SEX, BIRT, DEAT, RELI,
// OCCU, RESI/ADDR, NOTE, FAM dgn HUSB/WIFE/CHIL) -- bukan seluruh spek
// GEDCOM 5.5.1 yang sangat luas (mis. sumber/citation, media, event
// custom tidak didukung). Ini cukup utk kebutuhan tukar-menukar data
// silsilah keluarga dasar antar aplikasi.
// =====================================================================
const GedcomAPI = {
  MONTHS: ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],
  MAX_LINE: 200, // panjang aman per baris sebelum dipecah CONC (spek asli membatasi 255 char/baris)

  // ---------- EXPORT ----------

  // "1 JAN 1950" dari "1950-01-01". Kosong kalau format tanggal tidak lengkap
  // (input HTML type=date kita selalu lengkap YYYY-MM-DD, jadi ini jarang terjadi).
  _toGedcomDate(isoDate) {
    if (!isoDate) return '';
    const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const mi = parseInt(m[2], 10) - 1;
    if (mi < 0 || mi > 11) return '';
    return `${parseInt(m[3], 10)} ${this.MONTHS[mi]} ${m[1]}`;
  },

  // Bersihkan teks 1 baris: hilangkan newline asli (akan dipecah ulang via
  // CONC/CONT sendiri) dan karakter "/" (berbenturan dgn delimiter NAME).
  _clean(str) {
    return String(str || '').replace(/\r?\n/g, ' ').replace(/\//g, '⁄').trim();
  },

  // Tulis 1 nilai teks (boleh panjang/mengandung newline asli) sbg baris
  // GEDCOM level N + lanjutannya via CONC (potongan tanpa baris baru) &
  // CONT (potongan dgn baris baru) -- supaya catatan/alamat panjang tetap
  // utuh & sesuai spek (bukan 1 baris raksasa yang bisa ditolak parser lain).
  _pushText(lines, level, tag, text) {
    const raw = String(text || '').replace(/\//g, '⁄');
    const parts = raw.split(/\r?\n/);
    let first = true;
    parts.forEach(part => {
      let remaining = part;
      let isFirstChunkOfPart = true;
      do {
        const chunk = remaining.slice(0, this.MAX_LINE);
        remaining = remaining.slice(this.MAX_LINE);
        // PENTING: jangan trim spasi di ujung `chunk` -- kalau teks aslinya
        // kebetulan terpotong tepat di spasi (mis. "...dan tidak " | "merusak..."),
        // spasi itu bagian dari isi asli dan wajib ikut tersimpan supaya saat
        // disambung ulang oleh parser (CONC = concat tanpa baris baru) hasilnya
        // tidak jadi "tidakmerusak" (2 kata menempel). Hanya dikosongkan
        // sepenuhnya (tanpa spasi setelah tag) kalau chunk itu sendiri kosong.
        if (first) {
          lines.push(chunk ? `${level} ${tag} ${chunk}` : `${level} ${tag}`);
          first = false;
        } else if (isFirstChunkOfPart) {
          lines.push(chunk ? `${level + 1} CONT ${chunk}` : `${level + 1} CONT`);
        } else {
          lines.push(chunk ? `${level + 1} CONC ${chunk}` : `${level + 1} CONC`);
        }
        isFirstChunkOfPart = false;
      } while (remaining.length > 0);
    });
  },

  // people/marriages: array yang sama seperti dipakai di seluruh aplikasi
  // (hasil PeopleAPI.getAll() / MarriageAPI.getAll()). ID Firestore asli
  // TIDAK dipakai langsung sbg pointer GEDCOM (@I...@) karena spek 5.5.1
  // membatasi panjang pointer maks. 22 karakter -- ID Firestore (20
  // karakter) + awalan/akhiran bisa melebihi itu. Dipetakan ke nomor urut
  // sederhana (@I1@, @I2@, dst) supaya selalu sesuai spek & kompatibel
  // dgn parser GEDCOM lain yang ketat.
  toText(people, marriages) {
    const lines = [];
    lines.push('0 HEAD');
    lines.push('1 SOUR Silsilah_Keluargaku');
    lines.push('1 GEDC');
    lines.push('2 VERS 5.5.1');
    lines.push('2 FORM LINEAGE-LINKED');
    lines.push('1 CHAR UTF-8');

    const personIdx = new Map(); // firestoreId -> nomor urut
    people.forEach((p, i) => personIdx.set(p.id, i + 1));
    const famIdx = new Map();
    marriages.forEach((m, i) => famIdx.set(m.id, i + 1));

    const indiRef = id => personIdx.has(id) ? `@I${personIdx.get(id)}@` : null;
    const famRef = id => `@F${famIdx.get(id)}@`;

    const famsByPerson = {}; // personId -> [marriageId]
    const famcByChild = {};  // childId -> marriageId (keluarga kandung; ambil yg pertama tercatat)
    marriages.forEach(m => {
      if (m.orangId1) (famsByPerson[m.orangId1] = famsByPerson[m.orangId1] || []).push(m.id);
      if (m.orangId2) (famsByPerson[m.orangId2] = famsByPerson[m.orangId2] || []).push(m.id);
      (m.childIds || []).forEach(cid => { if (!famcByChild[cid]) famcByChild[cid] = m.id; });
    });

    people.forEach(p => {
      lines.push(`0 ${indiRef(p.id)} INDI`);
      // Nama orang Indonesia umumnya tidak berformat "nama depan + marga",
      // jadi seluruh nama dianggap "given name" & bagian marga dikosongkan
      // (format standar "Given //" ini valid di spek & lazim dipakai utk
      // budaya tanpa nama keluarga baku).
      lines.push(`1 NAME ${this._clean(p.nama)}//`);
      if (p.jenisKelamin === 'Laki-laki') lines.push('1 SEX M');
      else if (p.jenisKelamin === 'Perempuan') lines.push('1 SEX F');
      else lines.push('1 SEX U');
      if (p.tglLahir || p.tempatLahir) {
        lines.push('1 BIRT');
        const gd = this._toGedcomDate(p.tglLahir);
        if (gd) lines.push(`2 DATE ${gd}`);
        if (p.tempatLahir) this._pushText(lines, 2, 'PLAC', p.tempatLahir);
      }
      if (p.tglWafat) {
        lines.push('1 DEAT');
        const gd = this._toGedcomDate(p.tglWafat);
        if (gd) lines.push(`2 DATE ${gd}`);
      }
      if (p.agama) this._pushText(lines, 1, 'RELI', p.agama);
      if (p.pekerjaan) this._pushText(lines, 1, 'OCCU', p.pekerjaan);
      if (p.alamat) {
        lines.push('1 RESI');
        this._pushText(lines, 2, 'ADDR', p.alamat);
      }
      if (p.catatan) this._pushText(lines, 1, 'NOTE', p.catatan);
      (famsByPerson[p.id] || []).forEach(mid => lines.push(`1 FAMS ${famRef(mid)}`));
      if (famcByChild[p.id]) lines.push(`1 FAMC ${famRef(famcByChild[p.id])}`);
    });

    marriages.forEach(m => {
      lines.push(`0 ${famRef(m.id)} FAM`);
      if (m.orangId1 && indiRef(m.orangId1)) {
        const p1 = people.find(p => p.id === m.orangId1);
        lines.push(`1 ${p1 && p1.jenisKelamin === 'Perempuan' ? 'WIFE' : 'HUSB'} ${indiRef(m.orangId1)}`);
      }
      if (m.orangId2 && indiRef(m.orangId2)) {
        const p2 = people.find(p => p.id === m.orangId2);
        lines.push(`1 ${p2 && p2.jenisKelamin === 'Perempuan' ? 'WIFE' : 'HUSB'} ${indiRef(m.orangId2)}`);
      }
      (m.childIds || []).forEach(cid => { if (indiRef(cid)) lines.push(`1 CHIL ${indiRef(cid)}`); });
    });

    lines.push('0 TRLR');
    return lines.join('\r\n');
  },

  // ---------- IMPORT ----------

  // "1 JAN 1950" / "JAN 1950" / "1950" -> {iso: 'YYYY-MM-DD'} kalau lengkap
  // (hari+bulan+tahun), atau {raw: teks asli} kalau sebagian (skema kita
  // -- input type=date -- hanya menerima tanggal lengkap; bagian yang tidak
  // lengkap tetap disimpan sbg catatan supaya informasinya tidak hilang).
  _parseGedcomDate(value) {
    const cleaned = String(value || '').replace(/^(ABT|EST|CAL|BEF|AFT|FROM|TO)\s+/i, '').trim();
    const m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{3,4})$/);
    if (m) {
      const monIdx = this.MONTHS.indexOf(m[2].slice(0, 3).toUpperCase());
      if (monIdx >= 0) {
        return { iso: `${m[3]}-${String(monIdx + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` };
      }
    }
    return cleaned ? { raw: value.trim() } : {};
  },

  // Parser GEDCOM minimalis (level-based, dgn dukungan CONC/CONT) --
  // cukup utk tag-tag yang kita dukung. Mengembalikan data mentah dalam
  // bentuk "ID versi file GEDCOM" (bukan ID Firestore) -- importToFirestore()
  // di bawah yang menerjemahkannya jadi dokumen baru.
  parse(text) {
    const rawLines = String(text || '').split(/\r\n|\r|\n/);
    const indis = [];
    const fams = [];
    let context = null; // {type:'INDI'|'FAM'|'OTHER', ref}
    let sub1 = null;     // tag level-1 yg sedang aktif, mis. 'BIRT'/'NOTE'
    let contTarget = null; // {obj, key} tujuan penyambungan CONC/CONT saat ini

    const lineRe = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/;

    for (const raw of rawLines) {
      // TIDAK memotong spasi di ujung baris di sini -- baris CONC/CONT bisa
      // sengaja diakhiri spasi kalau itu memang bagian dari teks aslinya
      // (lihat catatan di _pushText()). Baris yang cuma berisi whitespace
      // (baris kosong pemisah) tetap dilewati.
      if (!raw.trim()) continue;
      const m = raw.match(lineRe);
      if (!m) continue;
      const level = parseInt(m[1], 10);
      const xref = m[2] ? m[2].replace(/@/g, '') : null;
      const tag = m[3];
      const value = m[4] || '';

      if (level === 0) {
        sub1 = null; contTarget = null;
        // Untuk baris level 0 dgn XREF (mis. "0 @I1@ INDI"), regex di atas
        // menaruh XREF di grup ke-2 dan kata "INDI"/"FAM" itu sendiri di
        // grup TAG (bukan di grup value) -- beda dgn baris level 1+ (mis.
        // "1 SEX M") yg tidak punya XREF, jadi tag=nama-field & value=isinya.
        if (tag === 'INDI') {
          const p = { gid: xref, nama: '', jenisKelamin: '', tglLahir: '', tempatLahir: '', tglWafat: '', agama: '', pekerjaan: '', alamat: '', catatan: '' };
          indis.push(p);
          context = { type: 'INDI', ref: p };
        } else if (tag === 'FAM') {
          const f = { gid: xref, huid: null, wid: null, childGids: [] };
          fams.push(f);
          context = { type: 'FAM', ref: f };
        } else {
          context = { type: 'OTHER' };
        }
        continue;
      }
      if (!context || context.type === 'OTHER') continue;

      if ((tag === 'CONC' || tag === 'CONT') && contTarget) {
        contTarget.obj[contTarget.key] += (tag === 'CONT' ? '\n' : '') + value;
        continue;
      }

      if (context.type === 'INDI') {
        const p = context.ref;
        if (level === 1) {
          sub1 = tag; contTarget = null;
          if (tag === 'NAME') {
            const parts = value.split('/');
            const given = (parts[0] || '').trim();
            const surname = (parts[1] || '').trim();
            p.nama = [given, surname].filter(Boolean).join(' ').trim() || value.trim();
            contTarget = { obj: p, key: 'nama' };
          } else if (tag === 'SEX') {
            p.jenisKelamin = value.trim().toUpperCase() === 'M' ? 'Laki-laki' : value.trim().toUpperCase() === 'F' ? 'Perempuan' : '';
          } else if (tag === 'RELI') {
            p.agama = value.trim();
            contTarget = { obj: p, key: 'agama' };
          } else if (tag === 'OCCU') {
            p.pekerjaan = value.trim();
            contTarget = { obj: p, key: 'pekerjaan' };
          } else if (tag === 'NOTE') {
            p.catatan = value.trim();
            contTarget = { obj: p, key: 'catatan' };
          }
        } else if (level === 2) {
          if (sub1 === 'BIRT' && tag === 'DATE') {
            const d = this._parseGedcomDate(value);
            if (d.iso) p.tglLahir = d.iso;
            else if (d.raw) p.catatan = (p.catatan ? p.catatan + '\n' : '') + `Tanggal lahir (dari GEDCOM, format tidak lengkap): ${d.raw}`;
          } else if (sub1 === 'BIRT' && tag === 'PLAC') {
            p.tempatLahir = value.trim();
            contTarget = { obj: p, key: 'tempatLahir' };
          } else if (sub1 === 'DEAT' && tag === 'DATE') {
            const d = this._parseGedcomDate(value);
            if (d.iso) p.tglWafat = d.iso;
            else if (d.raw) p.catatan = (p.catatan ? p.catatan + '\n' : '') + `Tanggal wafat (dari GEDCOM, format tidak lengkap): ${d.raw}`;
          } else if (sub1 === 'RESI' && tag === 'ADDR') {
            p.alamat = value.trim();
            contTarget = { obj: p, key: 'alamat' };
          }
        }
      } else if (context.type === 'FAM') {
        const f = context.ref;
        if (level === 1) {
          contTarget = null;
          if (tag === 'HUSB') f.huid = (value.match(/@([^@]+)@/) || [])[1] || null;
          else if (tag === 'WIFE') f.wid = (value.match(/@([^@]+)@/) || [])[1] || null;
          else if (tag === 'CHIL') { const cid = (value.match(/@([^@]+)@/) || [])[1]; if (cid) f.childGids.push(cid); }
        }
      }
    }

    return { indis, fams };
  },

  // Tulis hasil parse() sbg dokumen BARU di Firestore (tidak pernah
  // menimpa data yang sudah ada -- beda dgn Import JSON yang memang untuk
  // restore/replace). ID GEDCOM (@I1@ dst di file asal) hanya dipakai
  // sementara utk menyambungkan relasi ayah/ibu/anak ke ID Firestore yang
  // baru dibuat, lalu dibuang. Referensi ke ID GEDCOM yang tidak ditemukan
  // (mis. file rusak/tidak lengkap) dilewati dgn aman, tidak menggagalkan
  // keseluruhan proses.
  async importToFirestore(indis, fams) {
    const CHUNK = 400;
    const gidToRef = new Map();
    indis.forEach(p => gidToRef.set(p.gid, db.collection('people').doc()));

    for (let i = 0; i < indis.length; i += CHUNK) {
      const batch = db.batch();
      indis.slice(i, i + CHUNK).forEach(p => {
        const data = { nama: p.nama || '(Tanpa nama)', jenisKelamin: p.jenisKelamin || '' };
        if (p.tglLahir) data.tglLahir = p.tglLahir;
        if (p.tempatLahir) data.tempatLahir = p.tempatLahir;
        if (p.tglWafat) data.tglWafat = p.tglWafat;
        if (p.agama) data.agama = p.agama;
        if (p.pekerjaan) data.pekerjaan = p.pekerjaan;
        if (p.alamat) data.alamat = p.alamat;
        if (p.catatan) data.catatan = p.catatan;
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        batch.set(gidToRef.get(p.gid), data);
      });
      await batch.commit();
    }

    // Lacak berapa pernikahan sejauh ini per orang (urutan poligami), sesuai
    // konvensi MarriageAPI.findOrCreate() (urutanPasangan mulai dari 1).
    const marriageCountSoFar = {};
    let createdMarriages = 0;
    for (let i = 0; i < fams.length; i += CHUNK) {
      const batch = db.batch();
      fams.slice(i, i + CHUNK).forEach(f => {
        const huRef = f.huid ? gidToRef.get(f.huid) : null;
        const wiRef = f.wid ? gidToRef.get(f.wid) : null;
        if (!huRef && !wiRef && f.childGids.every(cg => !gidToRef.get(cg))) return; // keluarga kosong total, lewati
        const knownId = (huRef || wiRef || {}).id;
        const urutan = knownId ? (marriageCountSoFar[knownId] = (marriageCountSoFar[knownId] || 0) + 1) : 1;
        const childIds = f.childGids.map(cg => { const r = gidToRef.get(cg); return r ? r.id : null; }).filter(Boolean);
        batch.set(db.collection('marriages').doc(), {
          orangId1: huRef ? huRef.id : null,
          orangId2: wiRef ? wiRef.id : null,
          urutanPasangan: urutan,
          childIds,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        createdMarriages++;
      });
      await batch.commit();
    }

    return { peopleCount: indis.length, marriageCount: createdMarriages };
  }
};

const SettingsAPI = {
  async getAppSettings() {
    const doc = await db.collection('settings').doc('app').get();
    return doc.exists ? doc.data() : { judulAplikasi: 'Silsilah Keluarga' };
  },
  async updateAppSettings(data) {
    await db.collection('settings').doc('app').set(data, { merge: true });
  },
  async isAdminRegistered() {
    const doc = await db.collection('settings').doc('admin').get();
    return doc.exists && doc.data().exists === true;
  },
  // Menyimpan UID admin yang sah. Firestore Rules memverifikasi UID ini setiap
  // kali ada percobaan tulis data (lihat README bagian Rules) -- jadi walaupun
  // ada orang lain berhasil bikin akun Firebase Auth sendiri, mereka TETAP
  // ditolak menulis data karena UID mereka tidak cocok dengan yang tercatat di sini.
  async markAdminRegistered(uid) {
    await db.collection('settings').doc('admin').set({ exists: true, uid });
  }
};

// =====================================================================
// BACKGROUND TAMPILAN PUBLIK -- 25 palet warna/gradasi siap pakai yang
// ditampilkan sebagai pilihan di tab Setting (admin) saat admin TIDAK
// mengunggah gambar wallpaper sendiri. "value" adalah nilai CSS valid
// untuk properti `background` (boleh warna solid atau linear-gradient).
// =====================================================================
const BackgroundPalettes = [
  { name: 'Putih Bersih',      value: '#FFFFFF' },
  { name: 'Abu Lembut',        value: '#F2F4F6' },
  { name: 'Biru Langit',       value: '#E8F1FA' },
  { name: 'Biru Laut',         value: '#4F7CAC' },
  { name: 'Biru Navy',         value: '#22334D' },
  { name: 'Hijau Daun',        value: '#EAF6EE' },
  { name: 'Hijau Hutan',       value: '#4E8B6C' },
  { name: 'Hijau Tosca',       value: '#2F6E63' },
  { name: 'Krem Hangat',       value: '#F5EDE0' },
  { name: 'Cokelat Kayu',      value: '#6B4F3B' },
  { name: 'Pasir',             value: '#E4D5B7' },
  { name: 'Kuning Lembut',     value: '#FDF3D0' },
  { name: 'Oranye Sunset',     value: '#E8A56C' },
  { name: 'Merah Bata',        value: '#B5533C' },
  { name: 'Merah Marun',       value: '#6E2C3B' },
  { name: 'Pink Lembut',       value: '#F6D9E0' },
  { name: 'Ungu Lavender',     value: '#D8CCEB' },
  { name: 'Ungu Tua',          value: '#4B3C63' },
  { name: 'Abu Biru',          value: '#7D8FA3' },
  { name: 'Abu Gelap',         value: '#3A3F47' },
  { name: 'Hitam Elegan',      value: '#1C1F24' },
  { name: 'Gradasi Biru-Hijau', value: 'linear-gradient(135deg, #4F7CAC, #4E8B6C)' },
  { name: 'Gradasi Sunset',    value: 'linear-gradient(135deg, #F6D9E0, #E8A56C)' },
  { name: 'Gradasi Malam',     value: 'linear-gradient(135deg, #22334D, #4B3C63)' },
  { name: 'Gradasi Pastel',    value: 'linear-gradient(135deg, #E8F1FA, #EAF6EE)' }
];

// =====================================================================
// ATURAN SILSILAH -- validasi & bantuan relasi keluarga
// =====================================================================

const RelationRules = {
  // Field jenisKelamin HARUS salah satu dari 2 nilai ini supaya perhitungan
  // relasi (ayah/ibu, filter pasangan, dll) bisa mengenali orang tersebut.
  // Kosong/typo/nilai lain akan membuat orang itu diam-diam tidak pernah
  // terdeteksi sebagai ayah atau ibu di manapun -- makanya disediakan helper
  // ini supaya kejadian itu bisa ditampilkan ke admin, bukan tersembunyi.
  hasValidGender(person) {
    return person && (person.jenisKelamin === 'Laki-laki' || person.jenisKelamin === 'Perempuan');
  },

  // Orang tua (ayah/ibu) dari seseorang, ditentukan lewat jenis kelamin.
  getParents(personId, people, marriages) {
    const peopleMap = new Map(people.map(p => [p.id, p]));
    const m = marriages.find(m => (m.childIds || []).includes(personId));
    if (!m) return { ayah: null, ibu: null, marriage: null };
    const a = m.orangId1 ? peopleMap.get(m.orangId1) : null;
    const b = m.orangId2 ? peopleMap.get(m.orangId2) : null;
    let ayah = null, ibu = null;
    [a, b].filter(Boolean).forEach(p => {
      if (p.jenisKelamin === 'Laki-laki') ayah = p;
      else if (p.jenisKelamin === 'Perempuan') ibu = p;
    });
    return { ayah, ibu, marriage: m };
  },

  getChildren(personId, marriages) {
    const ids = new Set();
    marriages.forEach(m => {
      if (m.orangId1 === personId || m.orangId2 === personId) {
        (m.childIds || []).forEach(cid => ids.add(cid));
      }
    });
    return [...ids];
  },

  // Semua pasangan (suami/istri) seseorang dari SELURUH pernikahannya
  // (mendukung poligami -- bisa lebih dari 1). Dipakai mis. utk menentukan
  // rootIds pohon keluarga: bukan cuma leluhur utama (mis. Bapak Darsa)
  // sendirian, tapi juga pasangannya (Ibu Kesi), supaya keduanya sama-sama
  // dianggap bagian dari "keluarga utama" saat menyaring leluhur lain yang
  // tidak berkerabat (lihat computeAlienRootIds di tree.js).
  getSpouseIds(personId, marriages) {
    const ids = new Set();
    marriages.forEach(m => {
      if (m.orangId1 === personId && m.orangId2) ids.add(m.orangId2);
      else if (m.orangId2 === personId && m.orangId1) ids.add(m.orangId1);
    });
    return [...ids];
  },

  // Saudara kandung (2 ortu sama) + saudara tiri (1 ortu sama)
  getSiblings(personId, people, marriages) {
    const { ayah, ibu } = this.getParents(personId, people, marriages);
    const siblingIds = new Set();
    marriages.forEach(m => {
      const involvesAyah = ayah && (m.orangId1 === ayah.id || m.orangId2 === ayah.id);
      const involvesIbu = ibu && (m.orangId1 === ibu.id || m.orangId2 === ibu.id);
      if (involvesAyah || involvesIbu) {
        (m.childIds || []).forEach(cid => { if (cid !== personId) siblingIds.add(cid); });
      }
    });
    return [...siblingIds];
  },

  // Apakah idB adalah leluhur (ortu, kakek, dst) dari idA? Dipakai cegah relasi melingkar.
  isAncestor(idB, idA, people, marriages, depth = 0) {
    if (depth > 30) return false; // jaga-jaga infinite loop pada data korup
    const { ayah, ibu } = this.getParents(idA, people, marriages);
    if (ayah && ayah.id === idB) return true;
    if (ibu && ibu.id === idB) return true;
    if (ayah && this.isAncestor(idB, ayah.id, people, marriages, depth + 1)) return true;
    if (ibu && this.isAncestor(idB, ibu.id, people, marriages, depth + 1)) return true;
    return false;
  },

  // Cek apakah 2 orang berhubungan darah langsung: ortu/anak/saudara (kandung/tiri)
  isBloodRelated(idA, idB, people, marriages) {
    if (idA === idB) return true;
    const parentsA = this.getParents(idA, people, marriages);
    if ((parentsA.ayah && parentsA.ayah.id === idB) || (parentsA.ibu && parentsA.ibu.id === idB)) return true;
    const childrenA = this.getChildren(idA, marriages);
    if (childrenA.includes(idB)) return true;
    const siblingsA = this.getSiblings(idA, people, marriages);
    if (siblingsA.includes(idB)) return true;
    return false;
  },

  // Validasi tanggal: anak tidak boleh lebih tua dari orang tuanya
  validateChildBirthDate(childTglLahir, ayah, ibu) {
    if (!childTglLahir) return { valid: true };
    const childDate = new Date(childTglLahir);
    for (const parent of [ayah, ibu]) {
      if (parent && parent.tglLahir) {
        const parentDate = new Date(parent.tglLahir);
        if (childDate <= parentDate) {
          return { valid: false, message: `Tanggal lahir tidak masuk akal: ${parent.nama} (orang tua) lahir ${parent.tglLahir}, tapi anak lahir ${childTglLahir}.` };
        }
      }
    }
    return { valid: true };
  },

  // Validasi tanggal: tanggal wafat harus setelah tanggal lahir (orang yang sama)
  validateWafatDate(tglLahir, tglWafat) {
    if (!tglLahir || !tglWafat) return { valid: true };
    const lahir = new Date(tglLahir);
    const wafat = new Date(tglWafat);
    if (isNaN(lahir) || isNaN(wafat)) return { valid: true };
    if (wafat <= lahir) {
      return { valid: false, message: `Tanggal tidak masuk akal: tanggal wafat (${tglWafat}) tidak boleh sebelum atau sama dengan tanggal lahir (${tglLahir}).` };
    }
    return { valid: true };
  },

  // Kakek/nenek dari jalur ayah dan jalur ibu (untuk keterangan "cucu dari ...")
  getGrandparents(personId, people, marriages) {
    const { ayah, ibu } = this.getParents(personId, people, marriages);
    const fromAyah = ayah ? this.getParents(ayah.id, people, marriages) : { ayah: null, ibu: null };
    const fromIbu = ibu ? this.getParents(ibu.id, people, marriages) : { ayah: null, ibu: null };
    return {
      kakekAyah: fromAyah.ayah || null,   // ayah dari ayah
      nenekAyah: fromAyah.ibu || null,    // ibu dari ayah
      kakekIbu: fromIbu.ayah || null,     // ayah dari ibu
      nenekIbu: fromIbu.ibu || null       // ibu dari ibu
    };
  },

  // =====================================================================
  // KALKULATOR HUBUNGAN KEKERABATAN ANTAR 2 ORANG
  // (mis. "sepupu tingkat berapa", "paman/bibi", "mertua", "ipar", dst.)
  //
  // Cara kerja singkat: telusuri SEMUA leluhur (ayah & ibu, terus ke atas)
  // dari kedua orang beserta jaraknya (jumlah generasi), lalu cari leluhur
  // bersama yang PALING DEKAT (LCA -- Lowest/Nearest Common Ancestor).
  // Dari jarak masing-masing orang ke leluhur bersama itu, jenis hubungan
  // (garis lurus / saudara / paman-bibi-keponakan / sepupu) bisa ditentukan
  // tanpa perlu tabel hubungan yang ditulis manual satu-satu.
  //
  // Hubungan lewat pernikahan (mertua/menantu/ipar/suami-istri) dihitung
  // dengan cara yang sama, tinggal "melompat" dulu lewat pasangan sebelum
  // mengulang pencarian hubungan darah di atas.
  // =====================================================================

  // Sebutan garis leluhur (ke ATAS) sejauh d generasi, gender = jenis kelamin
  // ORANG yang posisinya leluhur itu (menentukan Ayah/Ibu, Kakek/Nenek, dst.)
  ascendTerm(d, gender) {
    if (d === 1) return gender === 'Laki-laki' ? 'Ayah' : gender === 'Perempuan' ? 'Ibu' : 'Orang Tua';
    if (d === 2) return gender === 'Laki-laki' ? 'Kakek' : gender === 'Perempuan' ? 'Nenek' : 'Kakek/Nenek';
    const base = { 3: 'Buyut', 4: 'Canggah', 5: 'Wareng' }[d];
    return base || `Leluhur (generasi ke-${d} ke atas)`;
  },

  // Sebutan garis keturunan (ke BAWAH) sejauh d generasi, gender = jenis
  // kelamin orang yang posisinya keturunan itu (Anak, Cucu, dst.)
  descendTerm(d, gender) {
    if (d === 1) return gender === 'Laki-laki' ? 'Anak Laki-laki' : gender === 'Perempuan' ? 'Anak Perempuan' : 'Anak';
    if (d === 2) return gender === 'Laki-laki' ? 'Cucu Laki-laki' : gender === 'Perempuan' ? 'Cucu Perempuan' : 'Cucu';
    const base = { 3: 'Cicit', 4: 'Canggah', 5: 'Wareng' }[d];
    return base || `Keturunan (generasi ke-${d} ke bawah)`;
  },

  // Kumpulkan SEMUA leluhur (ayah & ibu, terus ke atas) dari seseorang,
  // beserta jarak (jumlah generasi) tiap leluhur -- termasuk diri sendiri
  // di jarak 0. maxDepth menjaga dari data melingkar/korup.
  collectAncestorsWithDepth(personId, people, marriages, maxDepth = 12) {
    const depths = new Map([[personId, 0]]);
    const queue = [[personId, 0]];
    while (queue.length) {
      const [id, d] = queue.shift();
      if (d >= maxDepth) continue;
      const { ayah, ibu } = this.getParents(id, people, marriages);
      [ayah, ibu].forEach(p => {
        if (p && (!depths.has(p.id) || depths.get(p.id) > d + 1)) {
          depths.set(p.id, d + 1);
          queue.push([p.id, d + 1]);
        }
      });
    }
    return depths;
  },

  // Cari leluhur bersama yang paling dekat antara idA & idB (jarak total
  // paling kecil). null kalau tidak ditemukan leluhur bersama sama sekali
  // (kemungkinan memang tidak berkerabat lewat garis darah, atau data
  // silsilahnya belum lengkap sampai ke leluhur yang sama).
  findNearestCommonAncestor(idA, idB, people, marriages) {
    const depthsA = this.collectAncestorsWithDepth(idA, people, marriages);
    const depthsB = this.collectAncestorsWithDepth(idB, people, marriages);
    let best = null;
    depthsA.forEach((dA, id) => {
      if (depthsB.has(id)) {
        const dB = depthsB.get(id);
        const total = dA + dB;
        if (!best || total < best.total) best = { id, dA, dB, total };
      }
    });
    return best;
  },

  // Tentukan sebutan hubungan DARAH: "idB adalah ___ dari idA". Return null
  // kalau tidak ada leluhur bersama (bukan berarti pasti tidak berkerabat --
  // bisa juga lewat pernikahan, lihat calculateKinship). idA === idB tidak
  // ditangani di sini (ditangani di calculateKinship).
  describeBloodRelation(idA, idB, people, marriages) {
    const peopleMap = new Map(people.map(p => [p.id, p]));
    const B = peopleMap.get(idB);
    if (!B) return null;
    const lca = this.findNearestCommonAncestor(idA, idB, people, marriages);
    if (!lca) return null;
    const { dA, dB } = lca;

    // Garis lurus: idA sendiri leluhurnya idB, atau sebaliknya
    if (dA === 0) return { label: this.descendTerm(dB, B.jenisKelamin), type: 'descend', depth: dB };
    if (dB === 0) return { label: this.ascendTerm(dA, B.jenisKelamin), type: 'ascend', depth: dA };

    const min = Math.min(dA, dB);
    const removed = Math.abs(dA - dB);

    // Saudara kandung/tiri (sama-sama anak dari leluhur bersama)
    if (min === 1 && removed === 0) {
      const pA = this.getParents(idA, people, marriages);
      const pB = this.getParents(idB, people, marriages);
      const kandung = pA.ayah && pB.ayah && pA.ayah.id === pB.ayah.id &&
                      pA.ibu && pB.ibu && pA.ibu.id === pB.ibu.id;
      const genderWord = B.jenisKelamin === 'Laki-laki' ? ' (laki-laki)' : B.jenisKelamin === 'Perempuan' ? ' (perempuan)' : '';
      return { label: (kandung ? 'Saudara Kandung' : 'Saudara Tiri') + genderWord, type: 'saudara', depth: 1 };
    }

    // Paman/Bibi <-> Keponakan (beda 1 generasi dari leluhur bersama)
    if (min === 1 && removed === 1) {
      if (dB === 2) return { label: B.jenisKelamin === 'Laki-laki' ? 'Keponakan Laki-laki' : B.jenisKelamin === 'Perempuan' ? 'Keponakan Perempuan' : 'Keponakan', type: 'keponakan', depth: 1 };
      return { label: B.jenisKelamin === 'Laki-laki' ? 'Paman' : B.jenisKelamin === 'Perempuan' ? 'Bibi/Tante' : 'Paman/Bibi', type: 'paman_bibi', depth: 1 };
    }

    // Paman/Bibi & Keponakan "jauh" (beda >=2 generasi, mis. saudara kakek/nenek)
    if (min === 1 && removed >= 2) {
      if (dB > dA) return { label: `${this.descendTerm(removed, B.jenisKelamin)} dari Saudara (Keponakan generasi ke-${removed})`, type: 'keponakan_jauh', depth: removed };
      return { label: `Saudara dari ${this.ascendTerm(removed, null)} (Paman/Bibi generasi ke-${removed})`, type: 'paman_bibi_jauh', depth: removed };
    }

    // Sepupu (leluhur bersama sama-sama >=2 generasi dari keduanya)
    const tingkat = min - 1;
    if (removed === 0) return { label: `Sepupu Tingkat ${tingkat}`, type: 'sepupu', tingkat, removed: 0 };
    return { label: `Sepupu Tingkat ${tingkat} (beda ${removed} generasi)`, type: 'sepupu', tingkat, removed };
  },

  // Hitung hubungan kekerabatan LENGKAP (darah maupun lewat pernikahan)
  // antara idA & idB. Return { role, type, notFound, sameParty } di mana
  // `role` adalah SEBUTAN saja (mis. "Sepupu Tingkat 2"), belum berupa
  // kalimat lengkap -- kalimatnya disusun di KinshipView (supaya bisa
  // dipakai membentuk "B adalah <role> dari A" maupun sebaliknya).
  calculateKinship(idA, idB, people, marriages) {
    const peopleMap = new Map(people.map(p => [p.id, p]));
    const B = peopleMap.get(idB);
    if (!peopleMap.get(idA) || !B) return { role: null, notFound: true };
    if (idA === idB) return { role: null, sameParty: true };

    // 1. Hubungan darah langsung
    const blood = this.describeBloodRelation(idA, idB, people, marriages);
    if (blood) return { role: blood.label, type: blood.type };

    const iparWord = (gender) => gender === 'Laki-laki' ? 'Ipar Laki-laki' : gender === 'Perempuan' ? 'Ipar Perempuan' : 'Ipar';

    // 2. Pasangan langsung (suami/istri)
    const spousesA = this.getSpouseIds(idA, marriages);
    if (spousesA.includes(idB)) {
      const label = B.jenisKelamin === 'Laki-laki' ? 'Suami' : B.jenisKelamin === 'Perempuan' ? 'Istri' : 'Pasangan';
      const note = spousesA.length > 1 ? ' (salah satu pasangan)' : '';
      return { role: label + note, type: 'pasangan' };
    }

    // 3. Kerabat lewat pasangan A (mis. mertua, ipar, anak tiri)
    for (const sId of spousesA) {
      const rel = this.describeBloodRelation(sId, idB, people, marriages);
      if (!rel) continue;
      if (rel.type === 'ascend') return { role: `${this.ascendTerm(rel.depth, B.jenisKelamin)} Mertua`, type: 'mertua' };
      if (rel.type === 'descend') return { role: `${this.descendTerm(rel.depth, B.jenisKelamin)} Tiri`, type: 'anak_tiri' };
      if (rel.type === 'saudara') return { role: iparWord(B.jenisKelamin), type: 'ipar' };
    }

    // 4. Kerabat lewat pasangan B (mis. menantu, orang tua tiri, ipar)
    const spousesB = this.getSpouseIds(idB, marriages);
    for (const sId of spousesB) {
      const rel = this.describeBloodRelation(idA, sId, people, marriages);
      if (!rel) continue;
      if (rel.type === 'descend' && rel.depth === 1) return { role: B.jenisKelamin === 'Laki-laki' ? 'Menantu Laki-laki' : B.jenisKelamin === 'Perempuan' ? 'Menantu Perempuan' : 'Menantu', type: 'menantu' };
      if (rel.type === 'ascend') return { role: `${this.ascendTerm(rel.depth, B.jenisKelamin)} Tiri`, type: 'ortu_tiri' };
      if (rel.type === 'saudara') return { role: iparWord(B.jenisKelamin), type: 'ipar' };
    }

    // 5. Ipar "silang": pasangan A adalah saudara dari pasangan B (mis. istri
    // dari kakak seseorang, dilihat dari istri adiknya -- keduanya biasa
    // sama-sama disebut "ipar" walau tidak ada satupun yang saudara kandung
    // dgn pasangan lawannya secara langsung).
    for (const sA of spousesA) {
      for (const sB of spousesB) {
        const rel = this.describeBloodRelation(sA, sB, people, marriages);
        if (rel && rel.type === 'saudara') return { role: iparWord(B.jenisKelamin), type: 'ipar' };
      }
    }

    return { role: null, notFound: true };
  },

  // Hitung generasi seseorang, dihitung sejak leluhur paling awal yang tercatat
  // di jalur silsilahnya (leluhur = generasi 1). Jika ada dua jalur (ayah & ibu)
  // dengan kedalaman berbeda, dipakai jalur TERPANJANG (leluhur paling jauh yang diketahui).
  getGenerationInfo(personId, people, marriages) {
    const climb = (id, visited) => {
      if (visited.has(id)) return { depth: 0, rootId: id }; // jaga-jaga data melingkar
      visited.add(id);
      const { ayah, ibu } = this.getParents(id, people, marriages);
      if (!ayah && !ibu) return { depth: 0, rootId: id };
      const candidates = [];
      if (ayah) candidates.push(climb(ayah.id, visited));
      if (ibu) candidates.push(climb(ibu.id, visited));
      const best = candidates.reduce((a, b) => (b.depth > a.depth ? b : a));
      return { depth: best.depth + 1, rootId: best.rootId };
    };
    const { depth, rootId } = climb(personId, new Set());
    const peopleMap = new Map(people.map(p => [p.id, p]));
    const rootPerson = peopleMap.get(rootId);
    return {
      generasi: depth + 1,
      leluhurNama: rootPerson ? rootPerson.nama : null,
      isLeluhurSendiri: rootId === personId
    };
  },

  // Peta id-orang -> nomor generasi utk SEMUA orang sekaligus, dihitung lewat
  // getGenerationInfo() di atas. Dipakai bareng oleh filter "Generasi" (tab
  // Data Orang admin) & statistik per-generasi (Dashboard admin) supaya
  // logika perhitungan generasi tetap 1 tempat saja (sama seperti yang
  // sudah dipakai StatsAPI.computeBasicStats utk "Jumlah Generasi"). Orang
  // yang datanya bikin loop aneh (mis. relasi melingkar) diam-diam dilewati
  // (tidak masuk peta) -- ini bukan hal fatal utk statistik/filter,
  // konsisten dengan penanganan yang sama di computeBasicStats.
  getGenerationMap(people, marriages) {
    const map = new Map();
    people.forEach(p => {
      try {
        map.set(p.id, this.getGenerationInfo(p.id, people, marriages).generasi);
      } catch (e) { /* abaikan, lihat catatan di atas */ }
    });
    return map;
  },

  // v15: tentukan siapa yang jadi FOKUS DEFAULT saat pohon keluarga pertama
  // kali dibuka (dipakai bersama tampilan publik & tab "Pohon Keluarga" admin
  // -- lihat TreeControls.focusOn() di tree.js utk yang menggeser viewport-nya).
  // Urutan prioritas:
  //   1. rootPersonId dari Setting "Keluarga Utama untuk Tampilan Publik" --
  //      ini cara PALING ANDAL karena eksplisit diatur admin, dipakai kalau ada.
  //   2. Pencarian nama mengandung "darsa" (case-insensitive) -- cocok dgn
  //      permintaan spesifik: fokus default ke Bapak Darsa & Ibu Kesi, jalan
  //      otomatis walau admin belum sempat mengisi Setting di atas.
  //   3. Fallback terakhir: leluhur pertama yang ditemukan (orang tanpa ortu
  //      tercatat) -- supaya tetap ada fokus yang masuk akal walau nama
  //      "Darsa" tidak ditemukan sama sekali di data.
  findDefaultTreeFocusId(people, marriages, rootPersonId) {
    if (rootPersonId && people.some(p => p.id === rootPersonId)) return rootPersonId;

    const byName = people.find(p => (p.nama || '').trim().toLowerCase().includes('darsa'));
    if (byName) return byName.id;

    const firstRoot = people.find(p => {
      const { ayah, ibu } = this.getParents(p.id, people, marriages);
      return !ayah && !ibu;
    });
    return firstRoot ? firstRoot.id : null;
  },

  // v16: kumpulan id "pasangan utama" (bukan cuma 1 orang) yang dipakai
  // tree.js utk menyaring leluhur lain yang tidak berkerabat (lihat
  // computeAlienRootIds di tree.js). Dimulai dari findDefaultTreeFocusId()
  // di atas (mis. Bapak Darsa), lalu ikut menyertakan SEMUA pasangannya
  // (mis. Ibu Kesi, dan istri/suami lain kalau poligami) supaya keduanya
  // sama-sama dianggap "keluarga utama" -- bukan cuma satu sisi saja yang
  // membuat sisi pasangannya justru dianggap "leluhur lain" & tersembunyi.
  findDefaultTreeRootIds(people, marriages, rootPersonId) {
    const focusId = this.findDefaultTreeFocusId(people, marriages, rootPersonId);
    if (!focusId) return [];
    return [focusId, ...this.getSpouseIds(focusId, marriages)];
  },


  ORDINAL_WORDS: ['pertama', 'kedua', 'ketiga', 'keempat', 'kelima', 'keenam', 'ketujuh', 'kedelapan', 'kesembilan', 'kesepuluh'],
  ordinalWord(n) {
    return this.ORDINAL_WORDS[n - 1] || `ke-${n}`;
  },

  generateNarrative(personId, people, marriages) {
    const peopleMap = new Map(people.map(p => [p.id, p]));
    const person = peopleMap.get(personId);
    if (!person) return [];

    const lines = [];
    const nama = person.nama;
    const isMale = person.jenisKelamin === 'Laki-laki';

    // a. Anak ke berapa, dari siapa
    const { ayah, ibu, marriage } = this.getParents(personId, people, marriages);
    if (ayah || ibu) {
      let ordinalText = '';
      if (marriage && marriage.childIds && marriage.childIds.length > 1) {
        const withDates = marriage.childIds
          .map(cid => ({ id: cid, tgl: peopleMap.get(cid) && peopleMap.get(cid).tglLahir }))
          .filter(x => x.tgl);
        if (withDates.length === marriage.childIds.length) {
          withDates.sort((a, b) => new Date(a.tgl) - new Date(b.tgl));
          const idx = withDates.findIndex(x => x.id === personId);
          if (idx >= 0) ordinalText = ` ${this.ordinalWord(idx + 1)}`;
        }
      }
      const ortuNames = [ayah && ayah.nama, ibu && ibu.nama].filter(Boolean).join(' dan ');
      lines.push(`${nama} adalah anak${ordinalText} dari ${ortuNames}.`);
    } else {
      lines.push(`${nama} belum tercatat memiliki data orang tua.`);
    }

    // a2. Cucu dari (kakek/nenek), jika tercatat
    const { kakekAyah, nenekAyah, kakekIbu, nenekIbu } = this.getGrandparents(personId, people, marriages);
    const grandparentNames = [kakekAyah, nenekAyah, kakekIbu, nenekIbu].filter(Boolean).map(g => g.nama);
    if (grandparentNames.length) {
      lines.push(`${nama} adalah cucu dari ${grandparentNames.join(', ')}.`);
    }

    // b. Kakak/adik dari siapa
    const siblingIds = this.getSiblings(personId, people, marriages);
    if (siblingIds.length) {
      const meDate = person.tglLahir ? new Date(person.tglLahir) : null;
      const younger = [], older = [], unknown = [];
      siblingIds.forEach(sid => {
        const s = peopleMap.get(sid);
        if (!s) return;
        if (meDate && s.tglLahir) {
          (new Date(s.tglLahir) < meDate ? older : younger).push(s.nama);
        } else {
          unknown.push(s.nama);
        }
      });
      const parts = [];
      if (younger.length) parts.push(`Kakak dari ${younger.join(', ')}`);
      if (older.length) parts.push(`Adik dari ${older.join(', ')}`);
      if (unknown.length) parts.push(`bersaudara dengan ${unknown.join(', ')}`);
      if (parts.length) lines.push(`${nama} adalah ${parts.join(', ')}.`);
    }

    // c & d. Pasangan + anak kandung (per pernikahan)
    const myMarriages = marriages.filter(m => m.orangId1 === personId || m.orangId2 === personId);
    const isPoly = myMarriages.length > 1;
    const selfWord = isMale ? 'Suami' : 'Istri';
    const parentWord = isMale ? 'ayah kandung' : 'ibu kandung';

    myMarriages.forEach((m, idx) => {
      const partnerId = m.orangId1 === personId ? m.orangId2 : m.orangId1;
      const partner = partnerId ? peopleMap.get(partnerId) : null;
      const label = isPoly ? ` (pasangan ke-${idx + 1})` : '';
      if (partner) {
        lines.push(`${nama} adalah ${selfWord} dari ${partner.nama}${label}.`);
      }
      const childNames = (m.childIds || []).map(cid => peopleMap.get(cid) && peopleMap.get(cid).nama).filter(Boolean);
      if (childNames.length) {
        const bersama = partner ? ` bersama ${partner.nama}` : '';
        lines.push(`${nama} adalah ${parentWord} dari ${childNames.join(', ')}${bersama}.`);
      }
    });

    return lines;
  }
};

// =====================================================================
// FAMILY GRAPH -- dipakai untuk fitur "Keluarga Utama" (Setting admin):
// membatasi tampilan PUBLIK supaya hanya menampilkan 1 keluarga besar
// tertentu (leluhur yang dipilih beserta pasangan & seluruh kerabat
// langsungnya -- naik ke leluhur di atasnya & turun ke semua keturunan),
// keluarga lain yang sama sekali tidak berkerabat disembunyikan total
// (bukan cuma diciutkan). Tidak memengaruhi tampilan admin.
// =====================================================================
const FamilyGraph = {
  // Kembalikan Set<personId> berisi semua orang yang terhubung (lewat
  // relasi pasangan ATAU orang tua-anak, dua arah) dari rootId -- yaitu
  // 1 "connected component" penuh dalam graf keluarga.
  getConnectedComponentIds(rootId, people, marriages) {
    const visited = new Set();
    if (!rootId || !people.some(p => p.id === rootId)) return visited;

    const adj = new Map(); // personId -> Set<personId>
    const link = (a, b) => {
      if (!a || !b) return;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    };
    marriages.forEach(m => {
      link(m.orangId1, m.orangId2);
      (m.childIds || []).forEach(cid => {
        link(m.orangId1, cid);
        link(m.orangId2, cid);
      });
    });

    const queue = [rootId];
    visited.add(rootId);
    while (queue.length) {
      const cur = queue.shift();
      (adj.get(cur) || new Set()).forEach(n => {
        if (!visited.has(n)) { visited.add(n); queue.push(n); }
      });
    }
    return visited;
  }
};

// =====================================================================
// STATISTIK -- dipakai oleh Tab Dashboard (admin) & Modal Dashboard
// (publik). Dihitung murni dari data yang sudah dimuat di browser
// (people & marriages yang sudah difilter kalau perlu), jadi tidak perlu
// query tambahan ke Firestore.
// =====================================================================
const StatsAPI = {
  computeBasicStats(people, marriages) {
    let laki = 0, perempuan = 0, genderInvalid = 0;
    people.forEach(p => {
      if (p.jenisKelamin === 'Laki-laki') laki++;
      else if (p.jenisKelamin === 'Perempuan') perempuan++;
      else genderInvalid++;
    });

    const totalPasangan = marriages.filter(m => m.orangId1 && m.orangId2).length;
    const totalOrtuTunggal = marriages.filter(m => !(m.orangId1 && m.orangId2)).length;

    const childIdSet = new Set();
    marriages.forEach(m => (m.childIds || []).forEach(cid => childIdSet.add(cid)));

    const spouseCountByPerson = new Map();
    marriages.forEach(m => {
      [m.orangId1, m.orangId2].filter(Boolean).forEach(id => {
        spouseCountByPerson.set(id, (spouseCountByPerson.get(id) || 0) + 1);
      });
    });
    const totalPoligami = [...spouseCountByPerson.values()].filter(c => c > 1).length;

    const relatedIds = new Set();
    marriages.forEach(m => {
      if (m.orangId1) relatedIds.add(m.orangId1);
      if (m.orangId2) relatedIds.add(m.orangId2);
      (m.childIds || []).forEach(cid => relatedIds.add(cid));
    });
    const belumTerelasi = people.filter(p => !relatedIds.has(p.id)).length;

    let maxGenerasi = 0;
    people.forEach(p => {
      try {
        const info = RelationRules.getGenerationInfo(p.id, people, marriages);
        if (info.generasi > maxGenerasi) maxGenerasi = info.generasi;
      } catch (e) { /* abaikan data yang bikin loop aneh, tidak fatal utk statistik */ }
    });

    return {
      totalOrang: people.length,
      laki, perempuan, genderInvalid,
      totalPasangan, totalOrtuTunggal,
      totalKeluarga: totalPasangan + totalOrtuTunggal,
      totalAnakTercatat: childIdSet.size,
      totalPoligami,
      tanpaFoto: people.filter(p => !p.fotoUrl).length,
      tanpaTglLahir: people.filter(p => !p.tglLahir).length,
      belumTerelasi,
      maxGenerasi
    };
  },

  // Rincian nama-nama di balik satu angka pada kartu Dashboard -- dipanggil
  // saat kartu diklik (Tab Dashboard admin & Modal Dashboard publik).
  // "key" HARUS cocok dengan field yang dipakai di computeBasicStats() di atas.
  getDetail(key, people, marriages) {
    const byId = new Map(people.map(p => [p.id, p]));
    const sortNama = (arr) => arr.slice().sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id'));
    const asRows = (arr, ketFn) => sortNama(arr).map(p => ({ nama: p.nama, ket: ketFn ? ketFn(p) : (p.jenisKelamin || '-') }));

    switch (key) {
      case 'totalOrang':
        return { title: 'Semua Orang', rows: asRows(people) };

      case 'laki':
        return { title: 'Laki-laki', rows: asRows(people.filter(p => p.jenisKelamin === 'Laki-laki'), () => '') };

      case 'perempuan':
        return { title: 'Perempuan', rows: asRows(people.filter(p => p.jenisKelamin === 'Perempuan'), () => '') };

      case 'totalAnakTercatat': {
        const childIdSet = new Set();
        marriages.forEach(m => (m.childIds || []).forEach(cid => childIdSet.add(cid)));
        return { title: 'Anak Tercatat', rows: asRows(people.filter(p => childIdSet.has(p.id))) };
      }

      case 'totalPoligami': {
        const spouseCountByPerson = new Map();
        marriages.forEach(m => {
          [m.orangId1, m.orangId2].filter(Boolean).forEach(id => {
            spouseCountByPerson.set(id, (spouseCountByPerson.get(id) || 0) + 1);
          });
        });
        const orang = [...spouseCountByPerson.entries()]
          .filter(([, c]) => c > 1)
          .map(([id]) => byId.get(id))
          .filter(Boolean);
        return {
          title: 'Memiliki Lebih dari 1 Pasangan',
          rows: asRows(orang, p => `${spouseCountByPerson.get(p.id)} pasangan`)
        };
      }

      case 'belumTerelasi': {
        const relatedIds = new Set();
        marriages.forEach(m => {
          if (m.orangId1) relatedIds.add(m.orangId1);
          if (m.orangId2) relatedIds.add(m.orangId2);
          (m.childIds || []).forEach(cid => relatedIds.add(cid));
        });
        return { title: 'Belum Ada Relasi', rows: asRows(people.filter(p => !relatedIds.has(p.id))) };
      }

      case 'genderInvalid':
        return {
          title: 'Jenis Kelamin Bermasalah',
          rows: asRows(
            people.filter(p => !RelationRules.hasValidGender(p)),
            p => p.jenisKelamin ? `"${p.jenisKelamin}"` : '(kosong)'
          )
        };

      case 'tanpaFoto':
        return { title: 'Belum Ada Foto', rows: asRows(people.filter(p => !p.fotoUrl), () => '') };

      case 'tanpaTglLahir':
        return { title: 'Belum Ada Tanggal Lahir', rows: asRows(people.filter(p => !p.tglLahir), () => '') };

      case 'totalKeluarga': {
        const rows = marriages.map(m => {
          const a = m.orangId1 ? byId.get(m.orangId1) : null;
          const b = m.orangId2 ? byId.get(m.orangId2) : null;
          const namaA = a ? a.nama : '(tidak diketahui)';
          const namaB = b ? b.nama : '(orang tua tunggal)';
          return { nama: `${namaA} & ${namaB}`, ket: `${(m.childIds || []).length} anak` };
        });
        rows.sort((x, y) => x.nama.localeCompare(y.nama, 'id'));
        return { title: 'Keluarga / Pasangan', rows };
      }

      case 'maxGenerasi': {
        const rows = people.map(p => {
          let g = null;
          try { g = RelationRules.getGenerationInfo(p.id, people, marriages).generasi; } catch (e) { /* abaikan */ }
          return { nama: p.nama, ket: g ? `Generasi ke-${g}` : 'Belum diketahui', gen: g || 0 };
        });
        rows.sort((a, b) => (b.gen - a.gen) || a.nama.localeCompare(b.nama, 'id'));
        return { title: 'Generasi Setiap Orang', rows: rows.map(({ nama, ket }) => ({ nama, ket })) };
      }

      default:
        return { title: '', rows: [] };
    }
  },

  // Statistik per generasi -- dipakai bagian "Statistik per Generasi" di tab
  // Dashboard (admin): jumlah orang, usia rata-rata, & rata-rata jumlah anak
  // per keluarga, dipecah per angka generasi (generasi 1 = leluhur paling
  // awal yang tercatat di jalur masing-masing, sama seperti label generasi
  // yang dipakai di tab Laporan -- lihat RelationRules.getGenerationInfo()).
  //
  // "Rata-rata jumlah anak" dihitung per KELUARGA/PERNIKAHAN (bukan per
  // orang), dikelompokkan berdasarkan generasi salah satu pasangan
  // (orangId1, atau orangId2 kalau orangId1 kosong/orang tua tunggal belum
  // diketahui) -- supaya angkanya menjawab "rata-rata berapa anak per
  // keluarga yang dibentuk generasi ini", sesuatu yang sering ditanyakan
  // saat melihat tren jumlah anak antar generasi (mis. generasi lama
  // cenderung py banyak anak, generasi muda lebih sedikit).
  //
  // "Usia rata-rata" HANYA menghitung orang yang tanggal lahirnya tercatat
  // (lihat getUsiaTahun() di atas -- utk yang sudah wafat dipakai usia SAAT
  // WAFAT, bukan usia kalau masih hidup sampai sekarang), supaya tidak
  // dikira² dari data yang tidak lengkap.
  computeGenerationBreakdown(people, marriages) {
    const genMap = RelationRules.getGenerationMap(people, marriages);

    const byGen = new Map(); // generasi -> { jumlahOrang, usiaList: [], anakPerKeluargaList: [] }
    const bucketOf = (g) => {
      if (!byGen.has(g)) byGen.set(g, { jumlahOrang: 0, usiaList: [], anakPerKeluargaList: [] });
      return byGen.get(g);
    };

    people.forEach(p => {
      const g = genMap.get(p.id);
      if (!g) return; // dilewati (lihat catatan getGenerationMap)
      const bucket = bucketOf(g);
      bucket.jumlahOrang++;
      const usia = getUsiaTahun(p.tglLahir, p.tglWafat);
      if (usia !== null) bucket.usiaList.push(usia);
    });

    marriages.forEach(m => {
      const parentId = m.orangId1 || m.orangId2;
      if (!parentId) return;
      const g = genMap.get(parentId);
      if (!g) return;
      bucketOf(g).anakPerKeluargaList.push((m.childIds || []).length);
    });

    const rataRata = (arr) => arr.length
      ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10
      : null;

    return [...byGen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([generasi, b]) => ({
        generasi,
        jumlahOrang: b.jumlahOrang,
        usiaRataRata: rataRata(b.usiaList),
        jumlahOrangUsiaDiketahui: b.usiaList.length,
        totalKeluarga: b.anakPerKeluargaList.length,
        rataRataAnak: rataRata(b.anakPerKeluargaList)
      }));
  }
};

// Kartu ringkasan statistik (dipakai Tab Dashboard admin & Modal Dashboard publik).
const DashboardView = {
  // Setiap kartu boleh diberi "key" (cocok dengan StatsAPI.getDetail) supaya
  // bisa diklik untuk melihat daftar nama di baliknya. Kartu tanpa "key"
  // (kalau ada suatu saat) tetap tampil biasa, tidak bisa diklik.
  buildCardsHTML(cards) {
    return `<div class="dashboard-grid">${cards.map(c => `
      <div class="dashboard-card dashboard-card-${c.tone || 'blue'}${c.key ? ' dashboard-card-clickable' : ''}"
           ${c.key ? `data-key="${c.key}" role="button" tabindex="0"` : ''}>
        <div class="dashboard-card-icon">${c.icon || ''}</div>
        <div class="dashboard-card-value">${c.value}</div>
        <div class="dashboard-card-label">${c.label}</div>
      </div>`).join('')}</div>`;
  },

  // Daftar nama (+ keterangan) untuk modal detail saat kartu diklik.
  buildDetailListHTML(rows) {
    if (!rows || !rows.length) return '<p class="empty-row-sm">Tidak ada data.</p>';
    return `<ul class="dashboard-detail-list">${rows.map(r => `
      <li class="dashboard-detail-row">
        <span class="dashboard-detail-nama">${escapeHtml(r.nama || '-')}</span>
        ${r.ket ? `<span class="dashboard-detail-ket">${escapeHtml(r.ket)}</span>` : ''}
      </li>`).join('')}</ul>`;
  }
};

// =====================================================================
// EXPORT POHON KELUARGA (JPG / PDF)
// Dipakai bersama oleh admin.js (tab Pohon Keluarga) dan app.js (tampilan
// publik) supaya logikanya cuma ada di 1 tempat -- lihat setupTreeExportButtons()
// di masing-masing file untuk pemasangan tombolnya.
// =====================================================================
const TreeExportAPI = {
  // html2canvas & browser (terutama Safari/iOS) punya batas jumlah piksel
  // kanvas yang bisa dibuat sekaligus -- kalau dilewati, hasilnya BUKAN
  // error yang jelas, tapi gambar kosong/putih atau terpotong diam-diam.
  // Supaya pohon besar (ratusan orang) tetap aman diunduh di HP, scale
  // yang diminta (default 2x demi ketajaman) diturunkan otomatis kalau
  // ukuran asli kontainer sudah besar, dengan batas aman konservatif
  // (~16 megapiksel per sisi 8000px) yang berlaku di hampir semua browser.
  computeSafeScale(container, requestedScale = 2) {
    const w = container.scrollWidth || 1;
    const h = container.scrollHeight || 1;
    const MAX_DIM = 8000;       // batas aman per sisi (px)
    const MAX_PIXELS = 16e6;    // batas aman total piksel
    let scale = requestedScale;
    scale = Math.min(scale, MAX_DIM / w, MAX_DIM / h);
    scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (w * h)));
    return Math.max(1, Math.min(requestedScale, scale)); // jangan pernah di bawah 1x atau di atas yang diminta
  },

  // Render kontainer pohon (SVG) ke <canvas>. Kalau ada cabang yang sedang
  // diciutkan (collapse), otomatis diperluas dulu (expand all) supaya hasil
  // unduhan lengkap -- lalu status ciut/lebar SEBELUMNYA dikembalikan persis
  // seperti semula setelah selesai, supaya tidak mengganggu tampilan yang
  // sedang dilihat.
  async renderCanvas(container) {
    if (typeof html2canvas === 'undefined') {
      throw new Error('Komponen unduh gambar belum berhasil dimuat (biasanya karena koneksi internet terputus saat halaman dibuka). Pastikan online, lalu muat ulang halaman dan coba lagi.');
    }
    const previousCollapsed = TreeControls.getCollapsedIds(container);
    if (previousCollapsed.length > 0) TreeControls.expandAll(container);
    // Kasih browser 1 frame utk benar2 selesai reflow/repaint pohon yg baru
    // diperluas sebelum di-screenshot -- tanpa ini, kadang html2canvas masih
    // menangkap ukuran/posisi lama (terpotong).
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const scale = this.computeSafeScale(container, 2);
      return await html2canvas(container, { backgroundColor: '#ffffff', scale });
    } finally {
      if (previousCollapsed.length > 0) TreeControls.setCollapsedIds(container, previousCollapsed);
    }
  },

  buildFilename(appTitle, ext) {
    const safeTitle = (appTitle || 'Silsilah Keluarga').replace(/[^a-zA-Z0-9 -]/g, '').trim() || 'Silsilah Keluarga';
    const tgl = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${safeTitle} - Pohon Keluarga - ${tgl}.${ext}`;
  },

  async downloadJPG(container, appTitle) {
    const canvas = await this.renderCanvas(container);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = this.buildFilename(appTitle, 'jpg');
    a.click();
  },

  // PDF "poster" -- 1 halaman raksasa mengikuti ukuran pohon apa adanya.
  // Cocok utk dilihat di layar/tablet atau dicetak di printer format besar
  // (plotter), TAPI TIDAK bisa dicetak langsung di printer rumahan A4 biasa
  // (ukuran halamannya bukan A4 standar).
  async downloadPDFPoster(container, appTitle) {
    if (typeof window.jspdf === 'undefined') {
      throw new Error('Komponen pembuat PDF belum berhasil dimuat (biasanya karena koneksi internet terputus saat halaman dibuka). Pastikan online, lalu muat ulang halaman dan coba lagi.');
    }
    const canvas = await this.renderCanvas(container);
    const { jsPDF } = window.jspdf;
    const orientation = canvas.width > canvas.height ? 'l' : 'p';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, canvas.width, canvas.height);
    pdf.save(this.buildFilename(appTitle, 'pdf'));
  },

  // PDF "siap cetak" -- dipecah otomatis jadi beberapa halaman A4 (dgn
  // margin) yang tinggal ditempel/dijilid bersambung, supaya bisa langsung
  // dicetak di printer rumahan biasa. Ini pilihan yang lebih dipakai
  // kebanyakan orang dibanding versi poster di atas.
  async downloadPDFCetak(container, appTitle) {
    if (typeof window.jspdf === 'undefined') {
      throw new Error('Komponen pembuat PDF belum berhasil dimuat (biasanya karena koneksi internet terputus saat halaman dibuka). Pastikan online, lalu muat ulang halaman dan coba lagi.');
    }
    const canvas = await this.renderCanvas(container);
    const { jsPDF } = window.jspdf;
    // Pohon keluarga hampir selalu lebih lebar drpd tinggi -> default landscape
    // supaya jumlah halaman utk disambung tidak berlebihan.
    const orientation = canvas.width >= canvas.height ? 'l' : 'p';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    const margin = 8; // mm
    const pageW = pdf.internal.pageSize.getWidth() - margin * 2;
    const pageH = pdf.internal.pageSize.getHeight() - margin * 2;

    // Skala gambar (px -> mm) supaya LEBARnya pas dengan lebar 1 halaman;
    // tingginya otomatis ikut proporsional, lalu dipotong per-halaman.
    const pxToMm = pageW / canvas.width;
    const imgHmm = canvas.height * pxToMm;
    const totalPages = Math.max(1, Math.ceil(imgHmm / pageH));
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage();
      // Trik standar jsPDF: gambar yg sama digambar utuh di tiap halaman,
      // cuma digeser ke atas sejauh tinggi halaman x nomor halaman --
      // bagian yg di luar batas halaman otomatis terpotong (clip) oleh PDF,
      // sehingga tiap halaman hanya menampilkan potongan yg relevan.
      pdf.addImage(imgData, 'JPEG', margin, margin - page * pageH, pageW, imgHmm);
      pdf.setFontSize(8);
      pdf.setTextColor(150);
      pdf.text(`Halaman ${page + 1}/${totalPages}`, margin, pdf.internal.pageSize.getHeight() - 3);
    }
    pdf.save(this.buildFilename(appTitle, 'pdf'));
  },

  // Pasang 1 tombol unduh: nonaktifkan + ubah teks sementara selagi proses
  // berjalan (bisa beberapa detik utk pohon besar) supaya tidak diklik
  // berkali-kali, lalu tampilkan pesan jelas kalau gagal. Dipakai bersama
  // oleh tab Pohon Keluarga (admin) & tampilan publik (app.js) supaya
  // perilakunya konsisten di kedua tempat.
  attachButton(btnId, container, getTitle, exportMethodName) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const originalText = btn.textContent;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Menyiapkan...';
      try {
        const title = (getTitle && getTitle()) || 'Silsilah Keluarga';
        await this[exportMethodName](container, title);
      } catch (err) {
        alert('Gagal membuat file: ' + (err.message || 'terjadi kesalahan tak terduga.') + ' Coba lagi, atau ciutkan sebagian cabang dulu kalau datanya sangat besar.');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }
};

async function uploadFotoBase64(file) {
  return await compressImageToBase64(file);
}

// =====================================================================
// BIODATA FOLIO -- kartu biodata elegan dipakai di Tab Laporan (admin)
// dan Modal Laporan (publik). Foto di kiri, keterangan biodata di kanan.
// =====================================================================
const BiodataView = {
  formatTanggal(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date)) return d;
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  },

  buildFieldsHTML(person) {
    const rows = [];
    const push = (label, value) => {
      if (value) rows.push(`<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`);
    };
    push('Jenis Kelamin', person.jenisKelamin);
    const ttl = [person.tempatLahir, this.formatTanggal(person.tglLahir)].filter(Boolean).join(', ');
    push('Tempat, Tanggal Lahir', ttl);
    if (person.tglWafat) push('Wafat', this.formatTanggal(person.tglWafat));
    push('Agama', person.agama);
    push('Pekerjaan', person.pekerjaan);
    push('Alamat/Domisili', person.alamat);
    push('Kontak', person.kontak);
    if (person.catatan) push('Catatan', person.catatan);
    return rows.join('') || `<dt>Biodata</dt><dd>Belum ada keterangan biodata tambahan.</dd>`;
  },

  buildFolioHTML(person, generationInfo) {
    const namaDisplay = escapeHtml(person.nama || '-');
    const aliasDisplay = person.alias ? escapeHtml(person.alias) : '';
    const initial = (person.nama || '?').trim().charAt(0).toUpperCase();
    const fotoHTML = person.fotoUrl
      ? `<img src="${person.fotoUrl}" class="biodata-foto-img" alt="Foto ${namaDisplay}">`
      : `<div class="biodata-foto-placeholder">${escapeHtml(initial)}</div>`;
    const genBadge = (generationInfo && generationInfo.generasi)
      ? `<div class="biodata-gen-badge">Generasi ke-${generationInfo.generasi}${generationInfo.isLeluhurSendiri ? '<span class="biodata-gen-sub">Leluhur Awal</span>' : ''}</div>`
      : '';
    return `
      <div class="biodata-folio">
        <div class="biodata-photo-col">
          <div class="biodata-photo-frame">${fotoHTML}</div>
          ${genBadge}
        </div>
        <div class="biodata-info-col">
          <h2 class="biodata-nama">${namaDisplay}</h2>
          ${aliasDisplay ? `<div class="biodata-alias">"${aliasDisplay}"</div>` : ''}
          <dl class="biodata-fields">${this.buildFieldsHTML(person)}</dl>
        </div>
      </div>
    `;
  }
};

// Membangun tampilan HTML hasil "Cek Hubungan Kekerabatan" antara 2 orang
// (dipakai bareng oleh tab Laporan admin & modal Laporan publik). Logika
// perhitungannya sendiri ada di RelationRules.calculateKinship() di atas --
// di sini cuma menyusun kalimatnya jadi HTML siap tampil.
const KinshipView = {
  buildResultHTML(personA, personB, people, marriages) {
    const namaA = escapeHtml(personA.nama || '-');
    const namaB = escapeHtml(personB.nama || '-');
    const bDariA = RelationRules.calculateKinship(personA.id, personB.id, people, marriages);
    const aDariB = RelationRules.calculateKinship(personB.id, personA.id, people, marriages);

    if (bDariA.sameParty) {
      return `<div class="biodata-relasi-box kinship-result-box"><p class="kinship-empty">Itu orang yang sama.</p></div>`;
    }

    const lines = [];
    if (bDariA.role) {
      lines.push(`<strong>${namaB}</strong> adalah <strong>${escapeHtml(bDariA.role)}</strong> dari <strong>${namaA}</strong>.`);
    }
    // Hindari baris duplikat kalau sebutannya sama persis dari 2 arah (mis. sepupu, yang memang simetris)
    if (aDariB.role && aDariB.role !== bDariA.role) {
      lines.push(`<strong>${namaA}</strong> adalah <strong>${escapeHtml(aDariB.role)}</strong> dari <strong>${namaB}</strong>.`);
    }

    if (!lines.length) {
      return `<div class="biodata-relasi-box kinship-result-box">
        <h3 class="biodata-relasi-title">Hasil Cek Hubungan</h3>
        <p class="kinship-empty">Belum ditemukan hubungan kekerabatan antara <strong>${namaA}</strong> dan <strong>${namaB}</strong> lewat data yang tercatat (bisa jadi memang beda keluarga, atau ada data relasi/leluhur yang belum lengkap).</p>
      </div>`;
    }

    return `<div class="biodata-relasi-box kinship-result-box">
      <h3 class="biodata-relasi-title">Hasil Cek Hubungan</h3>
      <ul class="narrative-list">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
    </div>`;
  }
};


function compressImageToBase64(file, maxDim = 300, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Kompres gambar background/wallpaper tampilan publik ke base64. Beda dari
// compressImageToBase64 (foto orang, kotak kecil 300px) -- wallpaper perlu
// resolusi lebih besar supaya tidak pecah saat memenuhi layar, jadi dimensi
// awal jauh lebih besar. Tapi karena disimpan langsung di dokumen Firestore
// settings/app (bukan Storage), hasil akhirnya tetap harus dijaga di bawah
// maxSizeBytes -- dicoba turunkan kualitas dulu, baru dimensi, sampai pas.
function compressBackgroundImageToBase64(file, maxSizeBytes = 700 * 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let dim = 1920;
        let quality = 0.75;

        const render = () => {
          let { width, height } = img;
          if (width > height && width > dim) {
            height = Math.round(height * (dim / width));
            width = dim;
          } else if (height >= width && height > dim) {
            width = Math.round(width * (dim / height));
            height = dim;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          return canvas.toDataURL('image/jpeg', quality);
        };

        let result = render();
        let attempts = 0;
        while (result.length > maxSizeBytes && attempts < 8) {
          if (quality > 0.4) quality -= 0.1; else dim = Math.round(dim * 0.8);
          result = render();
          attempts++;
        }
        if (result.length > maxSizeBytes) {
          reject(new Error('Ukuran gambar masih terlalu besar setelah dikompres. Coba gunakan foto lain yang lebih sederhana.'));
          return;
        }
        resolve(result);
      };
      img.onerror = () => reject(new Error('Gagal membaca gambar. Pastikan file berformat JPG, JPEG, atau PNG yang valid.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file.'));
    reader.readAsDataURL(file);
  });
}
