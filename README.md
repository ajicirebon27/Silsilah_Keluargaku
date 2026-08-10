# Silsilah Keluarga — Panduan Setup

> **Baru di versi ini (v19) -- Kelola Admin &amp; Hak Akses (multi-admin):**
> Sebelumnya aplikasi ini SENGAJA dikunci hanya untuk 1 admin (lihat catatan
> "celah admin ganda" di v5). Sekarang admin utama bisa membuat admin
> **tambahan** dengan hak akses menu terbatas, lewat panel baru **Setting >
> Kelola Admin &amp; Hak Akses**:
> - Isi **Username**, **Kata Sandi** (diketik 2 kali -- sistem otomatis
>   mengecek kecocokannya sebelum bisa disimpan), lalu centang **menu/tab**
>   mana saja yang boleh dibuka admin ini (Dashboard, Data Orang, Laporan,
>   Komentar, Pohon Keluarga, Jelajah, Sampah, dan/atau Setting).
> - Setelah disimpan, admin baru itu bisa login sendiri di layar Masuk Admin
>   pakai username & kata sandi yang tadi dibuatkan -- menu yang tidak
>   dicentang tidak akan muncul sama sekali di navigasi mereka.
> - Panel "Kelola Admin" ini (dan kemampuan membuat/mencabut admin lain)
>   HANYA terlihat oleh admin utama (akun pendaftar pertama) -- admin
>   tambahan tidak bisa membuat admin baru lagi, walaupun tab Setting
>   tercentang untuk mereka.
> - Tombol **"Cabut Akses"** di daftar admin tambahan langsung mematikan
>   semua akses admin tersebut (dia akan otomatis ditolak & dikeluarkan
>   begitu mencoba login lagi). Catatan teknis: ini TIDAK menghapus akun
>   login (Firebase Authentication) yang bersangkutan secara fisik --
>   itu perlu Admin SDK di server yang tidak dipakai aplikasi front-end
>   murni seperti ini -- tapi secara praktis akun itu jadi tidak berdaya
>   sama sekali (tidak lolos Firestore Rules, tidak dapat menu apa pun).
> - **Batasan penting yang perlu dipahami:** checklist menu ini adalah
>   pembatasan di sisi **tampilan aplikasi** (menu yang tidak dicentang
>   memang disembunyikan total dari admin tersebut). Di sisi **Firestore
>   Rules** (lapisan keamanan sesungguhnya), semua admin -- utama maupun
>   tambahan, apa pun menu yang dicentang -- sama-sama dianggap "admin sah"
>   yang boleh menulis ke data keluarga (people/marriages/comments/
>   settings). Rules TIDAK memvalidasi menu per-checklist secara terpisah,
>   karena beberapa menu memakai data/collection yang sama (mis. tab **Data
>   Orang**, **Pohon Keluarga**, dan **Jelajah** sama-sama membaca/menulis
>   koleksi `people`). Jadi checklist ini paling cocok untuk mengatur
>   **kerapian & pembagian tugas** antar admin keluarga yang saling
>   dipercaya (mis. satu orang fokus input data, satu lagi fokus balas
>   komentar) -- bukan sebagai proteksi terhadap admin yang sengaja
>   berniat jahat.
> - **⚠️ WAJIB publish ulang Firestore Rules** (lihat bagian Rules di
>   bawah) supaya admin tambahan benar-benar bisa login & menyimpan data --
>   tanpa ini, akun admin tambahan akan berhasil dibuat tapi ditolak setiap
>   kali mencoba menulis data.

> **Baru di versi ini (v18) -- Unduh Pohon Keluarga sebagai JPG/PDF diperbaiki & dilengkapi:**
> Sebelumnya tombol Unduh JPG/PDF (admin) sudah ada tapi punya beberapa
> celah: kalau ada cabang yang sedang diciutkan, hasil unduhan cuma
> menampilkan yang terlihat saat itu (tidak lengkap, tanpa peringatan);
> pohon yang sangat besar berisiko menghasilkan file kosong/putih diam-diam
> di sebagian browser/HP (batas ukuran kanvas terlampaui); dan PDF-nya
> berupa 1 halaman custom raksasa yang tidak bisa dicetak langsung di
> printer rumahan biasa (bukan ukuran kertas standar). Sekarang:
> - Unduh JPG/PDF otomatis **memperluas semua cabang dulu** sebelum
>   menangkap gambar (supaya selalu lengkap), lalu **mengembalikan
>   tampilan ciut/lebar persis seperti semula** setelah selesai --
>   tidak mengganggu apa yang sedang dilihat.
> - Ukuran kanvas dibatasi otomatis ke batas aman supaya tidak
>   menghasilkan file kosong/rusak di pohon yang sangat besar atau di
>   HP dengan memori terbatas.
> - Ada **2 pilihan PDF**: **"Siap Cetak"** (dipecah otomatis jadi
>   beberapa halaman A4 bermargin, tinggal dicetak & disambung -- pilihan
>   yang paling umum dipakai) dan **"Poster"** (1 halaman besar mengikuti
>   ukuran pohon apa adanya, cocok untuk dilihat di layar/tablet atau
>   dicetak di plotter/percetakan format besar).
> - Nama file sekarang otomatis memakai judul aplikasi & tanggal unduh
>   (mis. `Silsilah Keluarga - Pohon Keluarga - 2026-08-10.pdf`), bukan
>   nama generik yang sama terus setiap kali diunduh.
> - Tombol dinonaktifkan sementara (dengan teks "Menyiapkan...") selagi
>   proses berjalan, dan menampilkan pesan yang jelas kalau gagal --
>   sebelumnya tidak ada indikasi apa pun selagi diproses.
> - **Tampilan publik** (yang dibagikan ke keluarga lewat link) kini juga
>   punya tombol **Unduh JPG** & **Unduh PDF (Siap Cetak)** sendiri di
>   pojok kanan atas pohon -- sebelumnya fitur unduh hanya ada di panel
>   admin, jadi anggota keluarga lain harus minta tolong admin kalau mau
>   simpan/cetak sendiri. Yang diunduh mengikuti apa yang sedang mereka
>   lihat (kalau admin sudah mengatur "Keluarga Utama untuk Tampilan
>   Publik", unduhan publik ikut hanya berisi cabang itu saja).
> - Logikanya kini dipusatkan di satu tempat (`TreeExportAPI` di `js/db.js`)
>   supaya panel admin & tampilan publik selalu berperilaku sama persis,
>   bukan 2 salinan kode terpisah yang bisa saling tidak sinkron.

> **Baru di versi ini (v15) -- Fokus default ke leluhur utama saat Pohon
> Keluarga pertama dibuka:**
> Sebelumnya, tampilan publik sudah default menciutkan semua keturunan saat
> pertama dibuka (v13), tapi tab **Pohon Keluarga** di panel **admin** masih
> selalu tampil terbuka penuh -- dan di kedua tempat, posisi scroll awal
> mengikuti tata letak kanvas apa adanya (belum tentu langsung menampilkan
> Bapak Darsa & Ibu Kesi di layar tanpa perlu scroll manual dulu). Sekarang:
> - Tab **Pohon Keluarga** (admin) ikut default **ciutkan semua** saat
>   pertama dibuka setiap sesi login (bukan lagi selalu terbuka penuh).
>   Status ciut/lebar ini HANYA berlaku sekali di awal sesi -- setelah admin
>   mulai meng-expand cabang tertentu untuk bekerja, status itu tidak
>   dipaksa ciut ulang lagi tiap habis menyimpan sesuatu.
> - Baik tampilan **publik** maupun **admin**, begitu dibuka, viewport
>   otomatis digeser supaya kotak **Bapak Darsa & Ibu Kesi** langsung
>   terlihat di tengah layar -- bukan pojok kiri-atas kanvas apa adanya.
> - Fokus ke Bapak Darsa ini jalan otomatis (dicocokkan lewat nama), TIDAK
>   perlu setting tambahan apapun. Tapi cara yang lebih andal & disarankan
>   tetap lewat **Setting > Keluarga Utama untuk Tampilan Publik** (pilih
>   Bapak Darsa dari dropdown) -- kalau diisi, itu yang dipakai duluan
>   sebagai fokus (lihat `RelationRules.findDefaultTreeFocusId()` di
>   `js/db.js` untuk urutan prioritas lengkapnya).

> **Baru di versi ini (v14) -- Batch 5, perbaikan operasional & keandalan:**
> 1. **Lupa kata sandi admin (mandiri).** Sebelumnya reset password admin
>    HARUS lewat Firebase Console secara manual. Sekarang ada tombol "Lupa
>    kata sandi?" di layar login yang mengirim link reset ke email admin
>    lewat Firebase Auth langsung -- tidak perlu buka Firebase Console lagi.
> 2. **Backup ikut menyimpan pengaturan aplikasi.** Export Data (JSON)
>    sekarang ikut menyertakan judul aplikasi & pengaturan "Keluarga Utama
>    untuk Tampilan Publik" (sebelumnya hanya data orang/pernikahan/komentar
>    -- pengaturan ini hilang kalau restore ke project Firebase baru). Import
>    juga otomatis memulihkan pengaturan ini kalau ada di file backup-nya
>    (file backup versi lama tanpa data ini tetap bisa diimport seperti biasa).
> 3. **Peringatan privasi pada file backup.** Tab Setting sekarang menampilkan
>    peringatan eksplisit bahwa file backup berisi data pribadi lengkap
>    keluarga dan tidak boleh dibagikan sembarangan (mis. ke grup WhatsApp).
> 4. **Pencarian di tab Pohon Keluarga (admin).** Sebelumnya kotak pencarian
>    nama hanya ada di tampilan publik -- admin harus scroll manual di pohon
>    yang sudah berisi banyak orang. Sekarang tab Pohon Keluarga (admin) juga
>    punya kotak pencarian yang menyorot & scroll otomatis ke kecocokan.
> 5. **Validasi ukuran foto setelah kompresi.** Firestore membatasi 1 dokumen
>    maksimal ~1MB. Kalau (jarang terjadi) hasil kompresi otomatis foto masih
>    terlalu besar, sistem sekarang memberi pesan yang jelas dan tetap
>    menyimpan biodata lainnya (hanya fotonya yang perlu diunggah ulang),
>    bukan gagal total dengan error Firestore mentah.
> 6. **Bersih-bersih kode (tidak mengubah perilaku):** fungsi `escapeHtml()`
>    yang sebelumnya terduplikasi persis sama di 2 file (`tree.js` & `admin.js`)
>    sekarang disatukan di `db.js` supaya tidak ada risiko salah satu salinan
>    diedit tanpa yang lain ikut berubah.

Aplikasi pohon keluarga (PWA). Bisa dibuka di browser dan diinstal ke Android.
Semua layanan yang dipakai **gratis**: Firebase (database) + Vercel (hosting).

> **Baru di versi ini (v3):** Tab **Data Orang** kini punya filter status relasi
> (dropdown + chip ringkasan "Semua / Sudah Terelasi / Belum Terelasi") di atas
> tabel, supaya admin bisa cepat menemukan data yang belum disetting relasinya
> saat data sudah banyak. Tanda centang biru tetap menandai yang sudah
> terelasi; kini ada juga tanda oranye untuk yang belum.

> **Baru di versi ini (v4):** Tab **Laporan** (admin) dan Modal **Laporan**
> (tampilan publik) kini menampilkan kartu biodata folio yang elegan setelah
> nama ditemukan -- foto di kiri, biodata lengkap di kanan (tempat/tanggal
> lahir, agama, pekerjaan, alamat, dll), lengkap dengan label generasi
> (dihitung dari leluhur paling awal yang tercatat) dan keterangan hubungan
> keluarga (anak dari, cucu dari, kakak/adik dari, pasangan dari, orang tua
> dari).

> **Baru di versi ini (v5) -- Batch 1 perbaikan keamanan & prosedur:**
> 1. **Keamanan:** Celah "admin ganda" ditutup. Sebelumnya siapa pun yang
>    berhasil bikin akun Firebase Auth sendiri otomatis bisa menulis semua
>    data. Sekarang UID admin yang sah dicatat & diverifikasi lewat Firestore
>    Rules (lihat bagian Rules di bawah -- **kamu perlu publish ulang rules
>    ini**, dan kalau sebelumnya sudah pernah setup, baca catatan ⚠️ di
>    bawah rules).
> 2. **Restore/Import backup:** Tab Setting sekarang punya tombol "Import
>    Data (JSON)" untuk memulihkan data dari file backup yang pernah
>    diunduh -- lawan dari tombol Export yang sudah ada sebelumnya.
> 3. **Konfirmasi hapus lebih jelas:** saat menghapus orang, sistem sekarang
>    menyebutkan secara spesifik berapa pernikahan & anak yang akan
>    terdampak, bukan cuma peringatan umum.

> **Baru di versi ini (v6) -- Batch 2 perbaikan validasi & keamanan:**
> 1. **Komentar publik dibatasi:** nama maks. 80 karakter, isi komentar maks.
>    1.000 karakter -- dijaga 3 lapis (batas ketik di form, batas di kode, dan
>    batas di Firestore Rules -- lihat bagian Rules di bawah, **perlu publish
>    ulang**). Ada juga jeda 15 detik antar kirim komentar dari browser yang
>    sama, untuk mencegah kirim berulang cepat yang bisa memboroskan kuota
>    Firestore gratis.
> 2. **Validasi tanggal wafat:** tidak bisa lagi menyimpan tanggal wafat yang
>    sama dengan atau sebelum tanggal lahir. Tanggal lahir yang diedit
>    belakangan juga dicek ulang terhadap tanggal lahir ortu yang sudah
>    tercatat.
> 3. **Cek hubungan darah saat set ortu lewat dropdown:** sebelumnya hanya
>    jalur "Tambah Pasangan" yang mendeteksi hubungan darah; sekarang jalur
>    mengisi Ayah/Ibu di modal Relasi juga memperingatkan jika keduanya
>    terdeteksi berhubungan darah langsung.
> 4. **Validasi file foto:** file yang bukan gambar atau berukuran di atas
>    15MB kini ditolak dengan pesan yang jelas, sebelum sempat diproses.

> **Baru di versi ini (v7) -- Batch 3 proteksi dari kesalahan tanpa sengaja:**
> 1. **Sampah (soft-delete):** tombol "Hapus" di tab Data Orang kini
>    memindahkan orang ke tab **Sampah** yang baru, bukan langsung menghapus
>    permanen. Dari tab Sampah, data bisa **dipulihkan** kapan saja, atau
>    dihapus **permanen** kalau memang sudah yakin (baru saat itu data & semua
>    rujukan relasinya benar-benar hilang dan tidak bisa dipulihkan lagi).
> 2. **Info nama sama (bukan validasi memblokir):** nama yang sama antar orang
>    itu wajar (banyak keluarga sengaja memakai nama yang sama antar generasi
>    atau cabang) -- identitas sebenarnya tetap dibedakan lewat ID unik yang
>    dikelola sistem, bukan lewat nama. Jadi saat menambah orang dengan nama
>    yang sudah ada, admin **tidak** diminta konfirmasi apa pun; yang muncul
>    hanya kotak info berisi daftar orang lain dengan nama sama beserta info
>    pembeda (tanggal lahir, orang tua yang sudah tercatat) supaya admin bisa
>    menilai sendiri -- murni bantuan, bukan peringatan kesalahan.

> **Baru di versi ini (v9) -- Batch 4 -- data jenis kelamin bermasalah kini terlihat:**
> Sebelumnya, kalau ada data orang dengan jenis kelamin kosong/tidak baku
> (biasanya dari data lama atau file backup yang tidak lengkap), orang itu
> **diam-diam tidak pernah terdeteksi** sebagai ayah/ibu di manapun -- tanpa
> ada pemberitahuan apapun. Sekarang:
> - Di tab **Data Orang**, baris dengan jenis kelamin bermasalah ditandai ⚠️
>   merah di kolom Jenis Kelamin, plus ada banner ringkas di atas tabel kalau
>   ada datanya.
> - Saat **Import/Restore backup**, dialog konfirmasi ikut menyebutkan berapa
>   data di file itu yang bermasalah, sebelum restore dijalankan.
>
> *(Catatan: setelah ditelusuri lebih lanjut, penyatuan 2 sistem perhitungan
> "generasi" di `tree.js` dan `db.js` yang sempat direncanakan ternyata TIDAK
> dilakukan -- keduanya sengaja dibiarkan terpisah karena mengukur hal yang
> berbeda: satu untuk tata letak visual pohon, satu lagi untuk label "Generasi
> ke-N" di Laporan berdasarkan jalur darah pribadi. Menyatukan keduanya akan
> membuat salah satu dari keduanya jadi kurang akurat.)*

> **Baru di versi ini (v11) -- Jarak antar garis keturunan poligami
> diperjelas, tidak lagi tampak menyatu:**
> Sebelumnya, kalau seorang istri punya anak yang posisinya terpaksa jauh
> ke samping (krn tata letak generasi berikutnya), garis rel menuju anak
> itu bisa melintas berdekatan (cuma 18px) dgn garis rel anak dari istri
> lain -- terutama kalau keduanya sama-sama menjulur panjang ke arah yang
> sama. Akibatnya kedua garis itu tampak menyatu/tumpang tindih di layar,
> padahal sebenarnya milik 2 pernikahan berbeda (mis. kasus 3 istri
> Ibrohim: garis anak Ipah & anak Dewi Sekar tampak menyatu).
>
> Sekarang:
> - Jarak vertikal antar "lapisan" siku poligami diperbesar (18px → 30px)
>   supaya garis-garis yang berjalan searah & berdekatan selalu py celah
>   yang jelas terlihat.
> - Jarak ke generasi berikutnya kini **otomatis melebar sendiri** kalau
>   ada keluarga dengan banyak istri sesisi (misal 4-5 istri) yang butuh
>   banyak lapisan siku -- dijamin selalu ada jarak aman ke baris kotak
>   berikutnya, berapa pun banyaknya istri/anak. Untuk keluarga biasa
>   (bukan poligami dalam), jarak antar generasi tetap sama seperti
>   sebelumnya -- tidak melebar tanpa perlu.
> - Catatan: garis yang saling *menyilang tegak lurus* (satu vertikal,
>   satu horizontal, lewat di depan/belakang) tetap dibiarkan apa adanya --
>   itu wajar dan sudah cukup jelas dibedakan lewat warna. Yang diperbaiki
>   khusus garis-garis yang berjalan **searah & sejajar** (mis. sama-sama
>   ke kanan) milik istri/pasangan berbeda.

> **Baru di versi ini (v10) -- Perbaikan garis pasangan poligami di Pohon
> Keluarga:**
> Sebelumnya, kalau seseorang punya lebih dari 1 pasangan (poligami) TAPI
> salah satu pasangannya kebetulan tersimpan di database lebih dulu drpd
> orang itu sendiri, sistem salah mengira itu cuma pernikahan biasa (bukan
> poligami). Akibatnya:
> - Pernikahan-pernikahan lain orang itu (dgn pasangan lainnya) gagal
>   dikelompokkan dgn benar -- tidak dapat warna garis sendiri, tidak dapat
>   label "Istri/Suami ke-N", dan garis sikunya jadi tampak menyatu/tumpang
>   tindih dgn garis pasangan lain sehingga publik bisa salah paham soal
>   anak itu keturunan pasangan yang mana.
> - Contoh nyata yg ditemukan: 3 istri Ibrohim (Sopiyah, Ipah, Dewi Sekar)
>   tidak tergambar serapi 3 istri Aji Pranomo (Amelya, Siska, Rindi),
>   padahal keduanya sama-sama poligami 3 istri.
>
> Sekarang sistem menghitung dulu berapa banyak pasangan tiap orang (dalam
> satu generasi) SEBELUM menentukan siapa jadi "poros" (hub). Orang dengan
> pasangan terbanyak selalu jadi poros yang benar, terlepas dari urutan
> data dimasukkan -- jadi hasilnya konsisten seperti kasus Aji Pranomo utk
> semua kasus poligami di pohon, termasuk data yang ditambahkan belakangan
> (mis. istri ke-2 yang baru diketahui & diinput bulan berikutnya).

Total waktu setup: sekitar 20–30 menit, dilakukan sekali saja.

---

## Bagian 1 — Setup Firebase (Database)

1. Buka https://console.firebase.google.com, login pakai akun Google.
2. Klik **"Add project"** / **"Tambah project"**. Beri nama bebas, misalnya `silsilah-keluarga`.
3. Lewati Google Analytics (tidak wajib), klik **Create project**.

### 1a. Aktifkan Firestore (database)
1. Di menu kiri, klik **Build > Firestore Database**.
2. Klik **Create database**.
3. Pilih **Start in production mode**, klik Next, pilih lokasi server (pilih yang terdekat, misal `asia-southeast1`), klik **Enable**.
4. Setelah aktif, buka tab **Rules**, ganti isinya dengan ini lalu klik **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Admin UTAMA: satu-satunya UID yang tercatat di settings/admin (akun
    // pendaftar pertama). Ini mencegah orang lain membuat akun Firebase Auth
    // sendiri lalu ikut-ikutan menulis data -- walaupun mereka berhasil
    // login, UID mereka tidak akan pernah cocok dengan yang tercatat di sini.
    function isPrimaryAdmin() {
      return request.auth != null &&
        exists(/databases/$(database)/documents/settings/admin) &&
        get(/databases/$(database)/documents/settings/admin).data.uid == request.auth.uid;
    }

    // Admin TAMBAHAN (v19): dibuat admin utama lewat panel "Kelola Admin &
    // Hak Akses", tercatat di koleksi admins/{uid}, dan harus masih aktif
    // (belum dicabut lewat tombol "Cabut Akses").
    function isSubAdmin() {
      return request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.active == true;
    }

    // Dipakai di semua koleksi data keluarga: admin utama ATAU admin
    // tambahan mana pun (yang masih aktif) boleh menulis. Pembatasan menu
    // per-checklist admin tambahan HANYA diterapkan di sisi tampilan
    // aplikasi, bukan di lapisan Rules ini -- lihat catatan v19 di atas.
    function isAnyAdmin() {
      return isPrimaryAdmin() || isSubAdmin();
    }

    match /people/{doc} {
      allow read: if true;
      allow write: if isAnyAdmin();
    }
    match /marriages/{doc} {
      allow read: if true;
      allow write: if isAnyAdmin();
    }
    match /comments/{doc} {
      allow read: if isAnyAdmin();
      // Validasi batas panjang di server -- ini lapis pertahanan paling kuat
      // terhadap spam/komentar raksasa, karena berlaku walau seseorang mem-bypass
      // form (misal kirim langsung lewat console browser).
      allow create: if request.resource.data.namaPengirim is string &&
        request.resource.data.namaPengirim.size() > 0 &&
        request.resource.data.namaPengirim.size() <= 80 &&
        request.resource.data.isiKomentar is string &&
        request.resource.data.isiKomentar.size() > 0 &&
        request.resource.data.isiKomentar.size() <= 1000 &&
        request.resource.data.sudahDibaca == false;
      allow update, delete: if isAnyAdmin();
    }
    match /settings/app {
      allow read: if true;
      allow write: if isAnyAdmin();
    }
    match /settings/admin {
      allow read: if true;
      // Boleh dibuat HANYA SEKALI (saat belum ada admin sama sekali), dan UID
      // yang ditulis harus UID milik sendiri (tidak bisa mengklaim UID orang lain).
      allow create: if request.auth != null &&
        !exists(/databases/$(database)/documents/settings/admin) &&
        request.resource.data.uid == request.auth.uid;
      // Hanya admin UTAMA yang boleh mengubah dokumen ini (mis. ganti kata
      // sandi sendiri lewat updatePassword tidak menyentuh dokumen ini sama
      // sekali, jadi rule ini di praktiknya jarang terpakai selain saat daftar).
      allow update: if isPrimaryAdmin();
    }

    // Profil admin TAMBAHAN (v19) -- doc id = UID Firebase Auth admin
    // tersebut. Hanya admin utama yang boleh membuat/mengubah/menghapus
    // (mis. mengatur ulang checklist menu, atau mencabut akses lewat tombol
    // "Cabut Akses"). Admin tambahan boleh membaca profilnya SENDIRI saja
    // (dipakai aplikasi utk tahu menu apa yang boleh ditampilkan saat dia
    // login) -- tidak boleh mengubah apa pun di sini, termasuk menaikkan
    // hak aksesnya sendiri.
    match /admins/{uid} {
      allow read: if isPrimaryAdmin() || (request.auth != null && request.auth.uid == uid);
      allow write: if isPrimaryAdmin();
    }

    // Pemetaan username -> email (v19), dipakai SEBELUM login: form "Masuk
    // Admin" menerima ketikan "username" biasa, lalu sistem perlu tahu email
    // asli di baliknya sebelum bisa memanggil Firebase Auth. Makanya read
    // dibuka publik (isinya cuma email + uid, bukan data pribadi/hak akses).
    // Hanya admin utama yang boleh menulis koleksi ini (dibuat otomatis oleh
    // aplikasi saat admin utama membuat admin baru lewat panel Kelola Admin).
    match /adminLookup/{usernameLower} {
      allow read: if true;
      allow write: if isPrimaryAdmin();
    }
  }
}
```

> ⚠️ **Jika kamu sudah pernah publish rules versi lama** (sebelum ada UID check
> di atas), setelah update ke rules baru ini kamu perlu **cek ulang isi dokumen
> `settings/admin`** di Firestore Console: pastikan field `uid` sudah terisi
> dengan UID akun admin kamu (buka Firebase Console > Authentication, salin
> UID akun kamu, lalu tempel manual ke field `uid` di dokumen `settings/admin`
> pada Firestore Console). Kalau field itu kosong, admin lama tidak akan bisa
> menulis data sampai field ini diisi.

> ⚠️ **Kalau kamu mau memakai fitur "Kelola Admin & Hak Akses" (v19)**, rules
> di atas **wajib** dipublish ulang -- tanpa fungsi `isSubAdmin()` dan aturan
> koleksi `admins`/`adminLookup` di atas, admin tambahan yang kamu buat akan
> berhasil tersimpan tapi selalu ditolak saat mencoba login/menyimpan data.

> ⚠️ **Kalau kamu sudah pernah publish rules versi sebelum v6** (belum ada
> batas ukuran di bagian `comments` di atas): setelah update ke rules baru ini
> **wajib publish ulang** supaya proteksi anti-spam komentar aktif. Tanpa
> republish, kode aplikasi tetap membatasi lewat form & JavaScript, tapi
> seseorang yang sengaja memanggil Firestore langsung masih bisa mengirim
> komentar tanpa batas panjang.

Ini artinya: siapa saja boleh **lihat** data orang & pohon keluarga (sesuai kesepakatan kita), tapi hanya admin yang login yang boleh **mengubah** data. Komentar boleh dikirim siapa saja tapi hanya admin yang bisa membacanya lewat dashboard.

### 1b. Soal Foto (tidak perlu Firebase Storage)
Firebase Storage sekarang mewajibkan upgrade ke paket berbayar "Blaze" (walau tetap ada kuota gratis besar, perlu kartu kredit terdaftar). Supaya aplikasi ini tetap **100% gratis tanpa kartu kredit**, foto orang **tidak disimpan lewat Storage**, melainkan dikompres otomatis lalu disimpan langsung di dalam data orang di Firestore. Jadi langkah ini bisa dilewati — tidak perlu aktifkan Storage sama sekali.

*(Kalau nanti aplikasi berkembang dan ingin foto beresolusi lebih tinggi, Storage bisa diaktifkan belakangan — tidak wajib dari awal.)*

### 1c. Aktifkan Authentication (login admin)
1. Menu kiri, klik **Build > Authentication**, klik **Get started**.
2. Pilih **Email/Password**, aktifkan (toggle jadi biru), klik **Save**.

### 1d. Ambil kredensial Firebase
1. Klik ikon gerigi (⚙) di pojok kiri atas > **Project settings**.
2. Scroll ke bawah ke bagian **Your apps**, klik ikon **</>** (Web).
3. Beri nama app bebas (misal `silsilah-web`), klik **Register app** (tidak perlu centang Firebase Hosting).
4. Akan muncul kode `firebaseConfig` seperti ini — **salin semua nilainya**:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "silsilah-keluarga.firebaseapp.com",
  projectId: "silsilah-keluarga",
  storageBucket: "silsilah-keluarga.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

5. Buka file **`js/firebase-config.js`** di proyek ini, ganti nilai `GANTI_DENGAN_...` dengan nilai yang kamu salin tadi.

---

## Bagian 2 — Deploy ke Vercel (supaya punya link)

1. Buka https://vercel.com, klik **Sign Up**, daftar pakai akun GitHub atau email (gratis, tanpa kartu kredit).
2. Setelah masuk dashboard, cara termudah:
   - Upload folder proyek ini ke akun **GitHub** kamu dulu (buat repository baru, upload semua file), **atau**
   - Pakai **Vercel CLI** langsung dari komputer:
     ```
     npm install -g vercel
     cd silsilah-app
     vercel
     ```
     Ikuti instruksi di terminal (login, pilih nama project, dsb). Setelah selesai, Vercel akan memberi link seperti `https://silsilah-keluarga.vercel.app`.
3. Kalau pakai cara GitHub: di dashboard Vercel klik **Add New > Project**, pilih repository yang tadi diupload, klik **Deploy**. Karena ini proyek HTML/JS biasa (tanpa proses build), Vercel otomatis akan langsung men-deploy-nya.

Setelah selesai, kamu akan punya **1 link tetap** (misal `https://silsilah-keluarga.vercel.app`) yang bisa dibagikan ke semua anggota keluarga.

---

## Bagian 3 — Cara Pakai

### Daftar sebagai Admin (dilakukan sekali di awal)
1. Buka link aplikasi, klik **Admin** di pojok kanan atas.
2. Karena belum ada admin terdaftar, akan muncul form **"Daftar sebagai Admin"**.
3. Isi email & kata sandi (bebas, minimal 6 karakter), klik **Daftar & Masuk**.
4. Setelah ini, slot pendaftaran admin **utama** terkunci — tidak ada yang bisa mendaftar sendiri jadi admin ke-2 lewat form ini. Login berikutnya akan otomatis muncul form **"Masuk Admin"**.
5. Admin ke-2 dan seterusnya **hanya bisa dibuat oleh admin utama**, lewat panel **Setting > Kelola Admin & Hak Akses** (lihat bagian berikutnya) — bukan lewat form daftar di atas.

### Menambah admin baru dengan hak akses terbatas (Kelola Admin)
1. Login sebagai admin utama, buka tab **Setting**, buka grup **Kelola Admin & Hak Akses**.
2. Klik **+ Tambah Admin Baru**.
3. Isi **Username** bebas (tanpa spasi), **Kata Sandi** (min. 6 karakter), dan **Konfirmasi Kata Sandi** yang sama persis — akan muncul tanda ✓ kalau sudah cocok.
4. Centang menu/tab mana saja yang boleh dibuka admin ini, lalu klik **Simpan**.
5. Admin baru bisa langsung login di layar **Masuk Admin** pakai username & kata sandi yang barusan dibuat — menu yang tidak dicentang tidak akan tampil di navigasi mereka.
6. Untuk mencabut akses admin tambahan kapan saja, klik **Cabut Akses** di daftar admin pada panel yang sama.

### Menambah data orang
1. Di dashboard admin, tab **Data Orang**, klik **+ Tambah Orang**.
2. Isi Nama & Jenis Kelamin (wajib), sisanya opsional.
3. Tambahkan pasangan & anak lewat bagian bawah form (bisa lebih dari 1 pasangan untuk kasus poligami).
4. Klik **Simpan**.

### Membagikan ke keluarga
- Bagikan link aplikasi (misal `https://silsilah-keluarga.vercel.app`) ke keluarga lewat WhatsApp/dll.
- Mereka bisa langsung melihat pohon keluarga tanpa perlu login.
- Di Android: buka link di Chrome, akan muncul opsi **"Tambahkan ke layar utama"** untuk instal seperti aplikasi biasa.

### Backup data
- Tab **Setting > Export Data (JSON)** untuk mengunduh seluruh data sebagai cadangan kapan saja.

---

## Catatan Penting

- Jangan bagikan isi file `js/firebase-config.js` ke publik secara sembarangan sebagai kode rahasia mutlak — nilai di dalamnya memang terlihat oleh browser (ini normal untuk aplikasi web Firebase), keamanan sesungguhnya diatur lewat **Rules** yang sudah disiapkan di atas (hanya admin yang login bisa ubah data).
- Ikon aplikasi di folder `icons/` masih berupa desain sederhana bawaan — bisa diganti kapan saja dengan logo keluarga sendiri (ukuran 192x192 dan 512x512 piksel, format PNG, nama file sama).
- Jika lupa kata sandi admin, pemulihan bisa dilakukan lewat menu **Authentication** di Firebase Console (reset manual).

---

## Perubahan di v13 (dari v12)

1. **Tab Dashboard (baru).** Ada tab **Dashboard** baru -- jadi tab pertama yang
   terbuka saat admin login -- menampilkan kartu ringkasan: total orang, total
   keluarga/pasangan, jumlah laki-laki, jumlah perempuan, anak tercatat, jumlah
   generasi, keluarga poligami, plus info yang perlu perhatian admin (komentar
   belum dibaca, data belum terelasi, jenis kelamin bermasalah, data di
   Sampah) dan daftar 5 orang yang baru ditambahkan. Tampilan **publik** juga
   dapat tombol **Dashboard** baru (di sebelah tombol Laporan) yang membuka
   ringkasan serupa versi ringkas (tanpa info sensitif admin).
2. **Keluarga Utama untuk Tampilan Publik (baru).** Di tab **Setting**, admin
   sekarang bisa memilih 1 orang (misalnya leluhur paling awal, mis. Bapak
   Darsa) lewat dropdown pencarian baru "Keluarga Utama untuk Tampilan
   Publik". Kalau diisi, tampilan **publik** (pohon keluarga, pencarian,
   Laporan, Dashboard) HANYA akan menampilkan orang itu beserta pasangan,
   leluhur, dan seluruh keturunannya -- keluarga lain yang sama sekali tidak
   berkerabat disembunyikan TOTAL (bukan cuma diciutkan seperti fitur
   collapse per-cabang di v12). Saat pertama dibuka, publik tetap hanya
   melihat 1 kotak pasangan teratas (mis. Bapak Darsa & Ibu Kesi) -- persis
   seperti perilaku collapse-default v12 -- lalu keturunannya baru muncul
   satu per satu saat lencana +/- diklik. Data keluarga lain TIDAK terhapus
   dan tetap terlihat lengkap di tampilan admin -- pengaturan ini hanya
   memengaruhi apa yang tampil di tampilan publik. Kosongkan pilihan untuk
   kembali ke perilaku lama (tampilkan semua keluarga).



1. **Dropdown pencarian di modal Relasi Keluarga.** Pilihan Pasangan, Ayah,
   dan Ibu sekarang bisa diketik untuk menyaring nama -- tidak perlu scroll
   manual lagi walau data sudah ratusan orang. Lihat `js/searchable-select.js`.
2. **Ayah & Ibu saling menyaring.** Begitu memilih Ayah yang sudah tercatat
   punya istri (poligami), dropdown Ibu otomatis hanya menampilkan
   istri-istri Ayah tsb (berlaku juga sebaliknya). Kalau orang itu belum
   tercatat py pasangan sama sekali, dropdown lawannya tetap menampilkan
   semua kandidat seperti biasa. Logika ada di `applyOrtuCascade()` dalam
   `js/admin.js`.
3. **Pohon keluarga bisa diciutkan/diperluas per cabang.** Tiap kotak yang
   punya anak sekarang punya lencana bulat kecil di bawahnya: klik untuk
   menyembunyikan (collapse) seluruh keturunannya, klik lagi utk
   menampilkan kembali. Ada juga tombol "Perluas Semua" / "Ciutkan Semua"
   di tab Pohon Keluarga (admin) dan di pojok kanan bawah tampilan publik.
   Ini jadi cara utama menjaga pohon tidak terus melebar ke kanan seiring
   data bertambah -- cabang yang tidak sedang dilihat cukup diciutkan.
   Status ciut/lebar ini HANYA tersimpan sementara di browser (bukan di
   database), jadi tiap orang yang membuka bisa punya tampilan sendiri, dan
   akan kembali ke "semua terbuka" kalau halaman dimuat ulang. Detail ada
   di bagian atas `js/tree.js` (cari komentar "COLLAPSE / EXPAND KETURUNAN").
