// =====================================================================
// DB HELPERS
// Struktur data di Firestore:
//   people      : { nama, jenisKelamin, alias, tglLahir, tglWafat, tempatLahir,
//                   agama, pekerjaan, alamat, kontak, fotoUrl, catatan, createdAt }
//   marriages   : { orangId1, orangId2 (bisa null = orang tua tunggal belum diketahui),
//                   urutanPasangan, childIds: [], createdAt }
//   comments    : { orangId, namaPengirim, isiKomentar, sudahDibaca, waktuKirim }
//   settings/app: { judulAplikasi }
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
  }
};

// Kartu ringkasan statistik (dipakai Tab Dashboard admin & Modal Dashboard publik).
const DashboardView = {
  buildCardsHTML(cards) {
    return `<div class="dashboard-grid">${cards.map(c => `
      <div class="dashboard-card dashboard-card-${c.tone || 'blue'}">
        <div class="dashboard-card-icon">${c.icon || ''}</div>
        <div class="dashboard-card-value">${c.value}</div>
        <div class="dashboard-card-label">${c.label}</div>
      </div>`).join('')}</div>`;
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
