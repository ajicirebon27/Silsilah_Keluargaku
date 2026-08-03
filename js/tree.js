// =====================================================================
// TREE LAYOUT & RENDER
// Menghitung generasi otomatis dan menggambar pohon keluarga sebagai SVG.
// Mendukung poligami: orang dengan >1 pasangan diposisikan di tengah.
// Setiap pasangan (marriage) punya warna sendiri + label "Istri/Suami ke-N".
// Garis pasangan turun dari bawah kotak, garis anak naik dari bawah ke titik
// yang sama -- sehingga tiap keturunan jelas ikut warna ibu/ayahnya.
// =====================================================================

const NODE_W = 140;
const NODE_H = 64;
const V_GAP = 120;     // jarak dasar antar generasi (bisa melebar otomatis, lihat GAP_SAFETY di bawah)
const H_GAP = 30;      // jarak antar unit dlm 1 GENERASI YG SAMA -- dipakai kalau 2 unit
                        // yg bersebelahan berasal dari ORANG TUA yg SAMA (mis. 2 kelompok
                        // anak kandung dari 1 pasangan yg sama, atau anak & pasangannya).
const FAMILY_GAP = 80;  // jarak antar unit yg bersebelahan TAPI orang tuanya BEDA (keluarga
                        // berbeda) -- dibuat jauh lebih lebar drpd H_GAP secara SENGAJA.
                        // Tanpa ini, 2 keluarga yg sama sekali tidak berkerabat (mis.
                        // keluarga Ibu Sareni vs keluarga Ibu Ratini) bisa berakhir
                        // bersebelahan cuma krn urutan data, sehingga garis "rel anak" &
                        // siku pasangan masing2 keluarga jadi nempel/tertindih/seakan
                        // "membelakangi" satu sama lain walau warnanya sudah beda --
                        // membingungkan publik membaca siapa keturunan siapa. Batas antar
                        // keluarga dideteksi OTOMATIS (lihat familyKeyOfUnit di layoutTree),
                        // jadi renggangnya tidak perlu diatur manual per kasus.
const COUPLE_GAP = 16; // jarak antar orang dalam 1 unit pasangan
const STUB = 22;       // panjang garis turun/naik pendek dari kotak pasangan/anak
const STUB_STEP = 30;  // tambahan kedalaman siku "U" per lapis (poligami) -- dibesarkan dari 18
                        // supaya garis anak tiap istri yang sama-sama menjulur jauh ke
                        // samping (mis. anaknya jauh posisinya) py jarak vertikal yang
                        // jelas terlihat terpisah, tidak tampak menyatu dgn garis istri lain.
const CHILD_BUS_OFFSET = 16; // jarak vertikal dari siku "U" turun ke garis rel anak
const GAP_SAFETY = 30;  // jarak aman ekstra di bawah garis rel anak terdalam sebelum
                        // generasi berikutnya dimulai -- supaya siku poligami yg dalam
                        // (banyak istri sesisi) tidak pernah mepet/nembus baris berikutnya.

const DEFAULT_COLOR = '#4F7CAC';

// =====================================================================
// COLLAPSE / EXPAND KETURUNAN
// Supaya pohon yang datanya banyak tidak terus melebar ke kanan, tiap
// node yang punya anak diberi lencana kecil (bulatan +/-) yang bisa
// diklik untuk menyembunyikan (collapse) atau menampilkan lagi (expand)
// seluruh keturunannya. Status collapse disimpan PER CONTAINER (jadi
// tampilan admin & publik tidak saling memengaruhi) lewat WeakMap --
// tidak disimpan ke database, cuma state tampilan sementara di browser.
// =====================================================================
const collapsedStateByContainer = new WeakMap(); // container -> Set<personId yang di-collapse>
const lastRenderByContainer = new WeakMap();      // container -> { people, marriages, onNodeClick } (data render terakhir, dipakai utk re-render saat toggle)

function getCollapsedSet(container) {
  if (!collapsedStateByContainer.has(container)) collapsedStateByContainer.set(container, new Set());
  return collapsedStateByContainer.get(container);
}

// Map personId -> [childId, ...] (gabungan dari semua pernikahan orang itu).
function buildChildrenByParent(marriages) {
  const map = new Map();
  const addChild = (parentId, childId) => {
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId).push(childId);
  };
  marriages.forEach(m => {
    (m.childIds || []).forEach(cid => {
      if (m.orangId1) addChild(m.orangId1, cid);
      if (m.orangId2) addChild(m.orangId2, cid);
    });
  });
  return map;
}

function collectDescendants(id, childrenByParent, visited) {
  (childrenByParent.get(id) || []).forEach(cid => {
    if (!visited.has(cid)) {
      visited.add(cid);
      collectDescendants(cid, childrenByParent, visited);
    }
  });
}

// ATURAN PEMILIK LENCANA (v16): karena budaya poligami di keluarga ini
// (1 suami bisa py >1 istri, tiap istri py jalur keturunan sendiri),
// lencana +/- jalur keturunan HANYA ditaruh pada node ISTRI (ibu),
// TIDAK PERNAH pada node suami/ayah -- supaya publik langsung paham
// "klik angka di kotak istri utk buka jalur keturunan istri itu",
// bukan malah ada 2 lencana (suami & istri) yg membuka jalur yg sama
// dan membingungkan. Pengecualian: kalau utk 1 pernikahan tertentu
// datanya cuma catat ayah saja (ibu belum diketahui/kosong), lencana
// jalur anak dari pernikahan itu DIPINDAH ke node ayah sbg fallback --
// supaya keturunannya tetap bisa dibuka lewat UI, tidak "terjebak"
// tersembunyi selamanya krn tidak ada node istri sama sekali.
function computeBadgeOwnerSet(marriages) {
  const badgeOwnerSet = new Set();
  marriages.forEach(m => {
    if (!(m.childIds || []).length) return;
    if (m.orangId2) badgeOwnerSet.add(m.orangId2);       // istri/ibu -> pemilik normal
    else if (m.orangId1) badgeOwnerSet.add(m.orangId1);  // fallback: ibu tidak diketahui
  });
  return badgeOwnerSet;
}

// v17 -- REVISI: dulu tampilan awal menampilkan SEMUA "leluhur" (org tanpa
// catatan orang tua) sekaligus berjajar (mis. Bapak Yusuf, Ibu Siwen, Ibu
// Samina, Bapak Darsa, Ibu Kesi, Bapak Nursita, Sopiyah tampil bersamaan),
// walau yang sebetulnya jadi fokus utama cuma Bapak Darsa & Ibu Kesi.
// Sekarang diganti dgn BFS "keterjangkauan" murni dari rootIds (pasangan
// utama) -- PERSIS konsep tab Jelajah: yang tampil di awal HANYA rootIds,
// sisanya (pasangan lain yg tak berkerabat, mertua, ipar, keturunan, dst)
// baru muncul satu-per-satu begitu jalur yg menghubungkannya ke rootIds
// dibuka lewat lencana +/-. Dua jenis jalur yg ditelusuri BFS:
//   1. pasangan <-> pasangan  : SELALU ikut terbawa (butuh 2 kotak utk garis
//      pernikahan), TIDAK bergantung status collapse.
//   2. orang tua -> anak      : hanya diteruskan kalau org tuanya SEDANG
//      TIDAK diciutkan (collapsedSet) -- inilah yg dikendalikan lencana +/-.
// Siapapun yg TIDAK terjangkau BFS ini (baik keturunan yg belum dibuka,
// MAUPUN "leluhur lain"/keluarga yg sama sekali tidak berkerabat) otomatis
// tersembunyi -- jadi computeAlienRootIds() versi lama sudah tidak
// diperlukan lagi, fungsi ini menggantikannya sekaligus.
function computeTreeVisibility(people, marriages, collapsedSet, rootIds) {
  const childrenByParent = buildChildrenByParent(marriages);

  // Marriages yg diikuti tiap org (sbg orangId1 MAUPUN orangId2) -- dipakai
  // BFS di bawah utk menelusuri baik pasangannya maupun anak²nya SEKALIGUS,
  // per pernikahan (bukan per org), supaya gerbang collapse-nya konsisten.
  const marriagesByPerson = new Map();
  const addM = (id, m) => {
    if (!id) return;
    if (!marriagesByPerson.has(id)) marriagesByPerson.set(id, []);
    marriagesByPerson.get(id).push(m);
  };
  marriages.forEach(m => { addM(m.orangId1, m); addM(m.orangId2, m); });

  const hasParentRecord = new Set();
  marriages.forEach(m => (m.childIds || []).forEach(cid => hasParentRecord.add(cid)));

  const validRootIds = (rootIds || []).filter(id => people.some(p => p.id === id));
  // Fallback kalau rootIds tidak diisi/tidak valid (pemanggil lama yg belum
  // pakai fitur fokus 1 leluhur): anggap SEMUA org tanpa catatan orang tua
  // sbg titik awal, spy pohon tetap tergambar penuh spt sebelumnya.
  const startIds = validRootIds.length
    ? validRootIds
    : people.filter(p => !hasParentRecord.has(p.id)).map(p => p.id);

  const visible = new Set(startIds);
  const queue = [...startIds];
  while (queue.length) {
    const cur = queue.shift();
    (marriagesByPerson.get(cur) || []).forEach(m => {
      const spouseId = m.orangId1 === cur ? m.orangId2 : m.orangId1;
      if (spouseId && !visible.has(spouseId)) { visible.add(spouseId); queue.push(spouseId); }
      // Gerbang buka/tutup keturunan pernikahan ini HARUS dicek per
      // PERNIKAHAN (pakai id yg sama dgn aturan badgeOwnerSet: istri, atau
      // ayah sbg fallback kalau ibu tak tercatat) -- BUKAN per org yg lagi
      // dikunjungi BFS. Kalau dicek per org (mis. lewat suami yg memang tak
      // pernah punya lencana/collapse sendiri), keturunan tetap bisa
      // "bocor" tampil walau istrinya sedang diciutkan.
      const gateId = m.orangId2 || m.orangId1;
      if (!collapsedSet.has(gateId)) {
        (m.childIds || []).forEach(cid => {
          if (!visible.has(cid)) { visible.add(cid); queue.push(cid); }
        });
      }
    });
  }

  const hidden = new Set();
  people.forEach(p => { if (!visible.has(p.id)) hidden.add(p.id); });

  // Angka pada lencana "+N": jumlah TOTAL keturunan di balik node yg
  // diciutkan (dihitung independen dr BFS keterjangkauan di atas, murni
  // menelusuri anak² -- spt versi sebelumnya), supaya angkanya tetap benar
  // walau node itu sendiri baru saja terjangkau lewat jalur pasangan.
  const hiddenCountByCollapsedId = new Map();
  collapsedSet.forEach(id => {
    const visited = new Set();
    collectDescendants(id, childrenByParent, visited);
    hiddenCountByCollapsedId.set(id, visited.size);
  });

  return { hidden, badgeOwnerSet: computeBadgeOwnerSet(marriages), hiddenCountByCollapsedId };
}

// Klik lencana +/- pada sebuah node: toggle status collapse-nya lalu
// gambar ulang pohon (dgn fade sebentar sbg "animasi" perpindahannya).
function toggleTreeNode(container, personId) {
  const set = getCollapsedSet(container);
  if (set.has(personId)) set.delete(personId); else set.add(personId);

  const last = lastRenderByContainer.get(container);
  if (!last) return;

  container.classList.add('tree-fade');
  window.setTimeout(() => {
    renderTreeSVG(container, last.people, last.marriages, last.onNodeClick, last.rootIds);
    // Paksa reflow lalu lepas kelas fade supaya transisinya benar-benar jalan.
    requestAnimationFrame(() => requestAnimationFrame(() => container.classList.remove('tree-fade')));
  }, 130);
}

// Dipanggil dari tombol "Perluas Semua" / "Ciutkan Semua" (lihat admin.js / app.js).
const TreeControls = {
  expandAll(container) {
    getCollapsedSet(container).clear();
    const last = lastRenderByContainer.get(container);
    if (last) renderTreeSVG(container, last.people, last.marriages, last.onNodeClick, last.rootIds);
  },
  // Meng-collapse SEMUA orang yang punya anak. Karena penyembunyian
  // keturunan bersifat transitif (collapse leluhur otomatis menyembunyikan
  // seluruh cucu-cicitnya), hasil akhirnya cuma menyisakan generasi
  // paling atas -- lalu admin/pengunjung bisa expand satu-satu dari sana.
  collapseAll(container) {
    const last = lastRenderByContainer.get(container);
    if (!last) return;
    // Pakai badgeOwnerSet (bukan "siapapun yg py anak"), supaya SETIAP id yg
    // masuk collapsedSet pasti py lencana yg bisa diklik utk membukanya lagi
    // -- kalau dulu suami & istri berdua ikut di-collapse padahal lencana
    // cuma ada di istri, klik lencana istri hanya melepas id istri dari set
    // sementara id suami tetap tercatat collapse -> keturunan tetap
    // tersembunyi walau lencana sudah menunjukkan "terbuka" (bug).
    const badgeOwnerSet = computeBadgeOwnerSet(last.marriages);
    const set = getCollapsedSet(container);
    set.clear();
    badgeOwnerSet.forEach(id => set.add(id));
    renderTreeSVG(container, last.people, last.marriages, last.onNodeClick, last.rootIds);
  },
  // v15: geser scroll wrapper supaya kotak orang tertentu (personId) langsung
  // terlihat di tengah viewport -- dipakai utk fitur "fokus default ke leluhur
  // utama" (mis. Bapak Darsa & Ibu Kesi) saat pohon pertama kali dibuka.
  // instant=true supaya tidak ada animasi scroll yang terlihat "meloncat"
  // sesaat setelah halaman baru dimuat (pakai 'auto', bukan 'smooth' --
  // 'auto' otomatis jadi langsung/tanpa animasi krn CSS di proyek ini
  // tidak menyetel scroll-behavior:smooth di manapun).
  focusOn(container, personId) {
    if (!personId) return;
    const el = container.querySelector(`.tree-node[data-id="${personId}"]`);
    if (el) el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  },

  // Dipakai fitur "Cari Sub Keluarga": user cari 1 nama, lalu pohon yang
  // digambar dipersempit HANYA jadi -- pasangan orang itu (semua
  // pernikahannya, mendukung poligami), anak-anaknya, menantu (pasangan si
  // anak, supaya garis pernikahan ke cucu bisa digambar), dan cucu-cucunya.
  // TIDAK melebar ke leluhur (orang tua ke atas) maupun ke buyut/generasi
  // sesudah cucu -- beda dgn mode collapse/expand biasa yg cuma
  // menyembunyikan sementara tapi datanya tetap "ada" di baliknya, di sini
  // datanya sendiri yg dipotong sebelum dikirim ke renderTreeSVG().
  buildSubFamily(people, marriages, personId) {
    // Lapis 0: orang yg dicari + seluruh pasangannya (bisa >1 kalau poligami).
    const level0 = new Set([personId]);
    const rootMarriages = marriages.filter(m => m.orangId1 === personId || m.orangId2 === personId);
    rootMarriages.forEach(m => {
      if (m.orangId1) level0.add(m.orangId1);
      if (m.orangId2) level0.add(m.orangId2);
    });

    // Lapis 1: anak-anak dari SEMUA pernikahan di lapis 0.
    const level1 = new Set();
    rootMarriages.forEach(m => (m.childIds || []).forEach(cid => level1.add(cid)));

    // Pernikahan tiap anak (utk garis pasangan ke arah cucu) + pasangannya (menantu).
    const level1Marriages = marriages.filter(m => level1.has(m.orangId1) || level1.has(m.orangId2));
    const level1Spouses = new Set();
    level1Marriages.forEach(m => {
      if (m.orangId1) level1Spouses.add(m.orangId1);
      if (m.orangId2) level1Spouses.add(m.orangId2);
    });

    // Lapis 2: cucu -- anak dari pernikahan level1. Sengaja TIDAK ditelusuri
    // lebih jauh (tidak ambil pasangan cucu / anak cucu) supaya batasnya
    // benar-benar berhenti di cucu sesuai permintaan fitur ini.
    const level2 = new Set();
    level1Marriages.forEach(m => (m.childIds || []).forEach(cid => level2.add(cid)));

    const idSet = new Set([...level0, ...level1, ...level1Spouses, ...level2]);

    const subPeople = people.filter(p => idSet.has(p.id));
    const subMarriages = marriages
      .filter(m => idSet.has(m.orangId1) || idSet.has(m.orangId2))
      .map(m => ({ ...m, childIds: (m.childIds || []).filter(cid => idSet.has(cid)) }));

    return { subPeople, subMarriages, rootIds: [...level0] };
  },

  // Reset status ciut/lebar (dipakai saat pindah antara pohon lengkap <->
  // sub keluarga, supaya id yg kebetulan sama-sama ada di 2 mode itu tidak
  // "membawa" status ciut dari mode sebelumnya).
  resetCollapse(container) {
    getCollapsedSet(container).clear();
  }
};

function buildFamilyGraph(people, marriages) {
  const parentMarriageOfChild = new Map();
  marriages.forEach(m => {
    (m.childIds || []).forEach(cid => parentMarriageOfChild.set(cid, m.id));
  });

  // ---------------------------------------------------------------
  // Generasi dihitung lewat "constraint graph": setiap relasi memberi
  // aturan selisih generasi antar 2 orang --
  //   pasangan (suami-istri)  -> selisih 0 (segenerasi)
  //   orang tua -> anak       -> selisih +1
  // Lalu BFS per kelompok keluarga (connected component) dari satu titik
  // sembarang, supaya urutan data tidak memengaruhi hasil -- ini
  // memperbaiki kasus lama di mana pasangan yang tidak diketahui orang
  // tuanya (menikah masuk ke keluarga, misal menantu) selalu dianggap
  // generasi 0 walau pasangannya sebenarnya cucu/generasi bawah.
  // ---------------------------------------------------------------
  const adj = new Map(); // id -> [{ to, w }]
  const addEdge = (a, b, w) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, w });
  };
  marriages.forEach(m => {
    if (m.orangId1 && m.orangId2) {
      addEdge(m.orangId1, m.orangId2, 0);
      addEdge(m.orangId2, m.orangId1, 0);
    }
    (m.childIds || []).forEach(cid => {
      if (m.orangId1) { addEdge(m.orangId1, cid, 1); addEdge(cid, m.orangId1, -1); }
      if (m.orangId2) { addEdge(m.orangId2, cid, 1); addEdge(cid, m.orangId2, -1); }
    });
  });

  const generation = new Map();
  people.forEach(start => {
    if (generation.has(start.id)) return;
    const compIds = [start.id];
    generation.set(start.id, 0);
    const queue = [start.id];
    while (queue.length) {
      const cur = queue.shift();
      const curGen = generation.get(cur);
      (adj.get(cur) || []).forEach(({ to, w }) => {
        if (!generation.has(to)) {
          generation.set(to, curGen + w);
          compIds.push(to);
          queue.push(to);
        }
      });
    }
    // Normalkan supaya generasi minimum di kelompok ini = 0
    const minGen = Math.min(...compIds.map(id => generation.get(id)));
    if (minGen !== 0) compIds.forEach(id => generation.set(id, generation.get(id) - minGen));
  });

  return { parentMarriageOfChild, generation };
}

function marriageTime(m) {
  if (m.createdAt && typeof m.createdAt.toMillis === 'function') return m.createdAt.toMillis();
  return 0;
}

// Urutan pasangan (istri/suami ke berapa) HARUS pakai field `urutanPasangan`
// (angka pasti, tersimpan saat data dibuat) -- bukan `createdAt`.
// `createdAt` adalah serverTimestamp() Firestore: kalau dokumen baru saja
// ditulis dan belum sinkron dari server, nilainya bisa kosong/null untuk
// sesaat, sehingga urutan istri/suami bisa jadi salah/terbalik (misalnya
// istri ke-2 muncul mendahului istri ke-1). Data lama yang belum punya
// `urutanPasangan` tetap didukung lewat fallback ke marriageTime().
function marriageSortKey(m) {
  if (typeof m.urutanPasangan === 'number') return m.urutanPasangan;
  return marriageTime(m);
}

const MIN_HGAP = 40; // Jarak horizontal minimum yg WAJIB ada antara "jangkauan" (reach) garis
                      // pasangan/anak dari 2 pernikahan berbeda (mis. 2 istri poligami yg
                      // berbeda) sebelum dianggap konflik dan wajib dipisah ke level
                      // kedalaman (depth) yg berbeda. "Jangkauan" = rentang X dari titik
                      // keluar suami & istri, DITAMBAH posisi X semua anaknya. Kalau 2
                      // pernikahan (beda ibu/poligami) jangkauannya berdekatan (< MIN_HGAP)
                      // atau malah tumpang tindih, salah satunya WAJIB digeser ke level Y
                      // lebih dalam -- supaya garis kesamping (ke pasangan) ataupun garis
                      // ke keturunan tidak PERNAH menyatu / seakan-akan tertindih garis
                      // pernikahan lain, selalu ada celah/spasi yg jelas terlihat.

function layoutTree(people, marriages) {
  const { generation, parentMarriageOfChild } = buildFamilyGraph(people, marriages);
  const peopleMap = new Map(people.map(p => [p.id, p]));
  const marriagesById = new Map(marriages.map(m => [m.id, m]));

  const byGen = new Map();
  people.forEach(p => {
    const g = generation.get(p.id);
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g).push(p.id);
  });

  const marriagesByPerson = new Map();
  marriages.forEach(m => {
    if (!marriagesByPerson.has(m.orangId1)) marriagesByPerson.set(m.orangId1, []);
    marriagesByPerson.get(m.orangId1).push(m);
    if (m.orangId2) {
      if (!marriagesByPerson.has(m.orangId2)) marriagesByPerson.set(m.orangId2, []);
      marriagesByPerson.get(m.orangId2).push(m);
    }
  });

  const positions = new Map();
  const marriageColor = new Map();
  const marriageLabel = new Map();
  // Untuk garis pasangan berbentuk "U" (keluar dari BAWAH kotak, bukan dari
  // samping) -- perlu tahu siapa "hub" (orang dgn kemungkinan banyak
  // pasangan) di tiap pernikahan, seberapa "dalam" siku U tsb harus turun
  // supaya tidak menembus/menyatu dgn garis istri lain yang berada di
  // antaranya (marriageDepth), dan sedikit pergeseran horizontal titik
  // keluar di sisi hub supaya beberapa garis dari hub yang sama tidak
  // saling menumpuk persis di titik yang sama (marriageCombOffset).
  const marriageHubId = new Map();
  const marriageDepth = new Map();
  const marriageCombOffset = new Map();
  const genKeys = [...byGen.keys()].sort((a, b) => a - b);

  // Setiap pernikahan diberi warna sendiri (bukan hanya yang poligami),
  // supaya garis keturunan tiap pasangan bisa dibedakan sampai ke cucu.
  // Warna berhenti "mewarisi" di generasi anak dari pasangan tsb -- begitu
  // anak itu sendiri menikah, pernikahannya dapat warna baru lagi.
  // ---------------------------------------------------------------
  // GENERATOR WARNA PER PERNIKAHAN -- "golden angle" pada roda warna HSL.
  // Sebelumnya warna diambil dari larik tetap berisi 10 warna, dipakai
  // ulang lewat modulo (warna ke-11 = warna ke-1 lagi). Begitu jumlah
  // pernikahan di satu pohon keluarga lebih dari 10, warna PASTI berulang
  // dari awal -- itulah sebabnya 2 keluarga yang sama sekali tidak
  // berkerabat (mis. keluarga Ibu Sareni/Bapak Saida vs keluarga Ibu
  // Ratini/Bapak Rastam) bisa kebagian warna identik, sehingga publik
  // bingung membaca garis keturunan siapa anak siapa.
  //
  // Dengan golden angle (137.508°), tiap pernikahan baru memutar hue
  // sejauh sudut emas ini dari pernikahan sebelumnya:
  //   1) TIDAK PERNAH ada 2 pernikahan berbeda dengan warna yang sama
  //      persis, berapa pun banyaknya pernikahan dalam pohon -- hue terus
  //      berputar mengelilingi roda warna, tidak pernah "habis"/kembali
  //      mengulang dari larik terbatas.
  //   2) Pernikahan yang diproses berurutan/berdekatan (mis. 2 keluarga
  //      yang posisinya bersebelahan di generasi yang sama) otomatis
  //      mendapat hue yang jauh berbeda di roda warna, karena lompatan
  //      137.508° per langkah membuat warna berurutan selalu kontras --
  //      tidak pernah "landai" ke warna tetangga yang mirip.
  //   3) Saturasi & lightness ikut digeser tiap beberapa putaran supaya
  //      bahkan hue yang kebetulan berdekatan antar putaran roda tetap
  //      bisa dibedakan (tidak semua warna jadi pucat/terang seragam).
  // ---------------------------------------------------------------
  const GOLDEN_ANGLE = 137.508;
  let colorCursor = 0;
  const colorForMarriage = new Map();
  const colorFor = (marriageId) => {
    if (!colorForMarriage.has(marriageId)) {
      const hue = (colorCursor * GOLDEN_ANGLE) % 360;
      const shade = Math.floor(colorCursor / 7) % 3; // 0,1,2 berulang tiap 7 warna
      const sat = [62, 72, 55][shade];
      const light = [42, 50, 35][shade];
      colorForMarriage.set(marriageId, `hsl(${hue.toFixed(1)}, ${sat}%, ${light}%)`);
      colorCursor++;
    }
    return colorForMarriage.get(marriageId);
  };

  // =====================================================================
  // TAHAP 1 -- POSISI X + METADATA PERNIKAHAN
  // Hitung urutan & posisi X tiap orang per generasi (logika sama seperti
  // sebelumnya: anak2 dari ibu yg sama dikelompokkan berdekatan, hub
  // poligami dikenali lewat derajat pernikahan, dst). Warna, label
  // "Istri/Suami ke-N", hubId, dan comb-offset (titik keluar garis di sisi
  // hub) juga ditentukan di sini karena semuanya cuma butuh tahu susunan
  // pasangan, BUKAN posisi anak.
  // Y (tinggi generasi) SENGAJA belum dihitung di sini -- itu baru bisa
  // benar setelah TAHAP 2, karena kedalaman siku yang tepat justru perlu
  // tahu sejauh mana garis anak "menjulur" ke samping, dan posisi X anak
  // (generasi berikutnya) belum tentu diketahui saat generasi ini
  // diproses.
  // =====================================================================
  genKeys.forEach(g => {
    const rawIds = byGen.get(g);
    const idSet = new Set(rawIds);

    // ---------------------------------------------------------------
    // Urutkan orang-orang dalam generasi ini berdasarkan posisi X orang
    // tuanya (yang sudah ditempatkan di generasi sebelumnya), BUKAN
    // berdasarkan urutan data dimasukkan. Tanpa ini, anak-anak dari ibu
    // yang berbeda (kasus poligami) bisa tercampur urutannya dengan
    // anak dari ibu lain, sehingga garis keturunan jadi saling silang
    // dan membingungkan meskipun tiap anak sudah tertaut ke pernikahan
    // yang benar.
    // Kunci urut: [posisi-X rata-rata orang tua, urutan anak dlm
    // childIds pernikahan itu]. Orang yang menikah masuk ke keluarga
    // (tidak diketahui orang tuanya) mewarisi kunci urut pasangannya
    // supaya tetap ditempatkan berdekatan. Orang tanpa orang tua & tanpa
    // pasangan beranak (misal generasi paling atas) tetap memakai urutan
    // data asli seperti sebelumnya.
    // ---------------------------------------------------------------
    const originalIndex = new Map(rawIds.map((id, i) => [id, i]));
    const keyCache = new Map();
    const resolveSortKey = (id, seen) => {
      if (keyCache.has(id)) return keyCache.get(id);
      seen = seen || new Set();
      if (seen.has(id)) return null;
      seen.add(id);
      let key = null;
      const mId = parentMarriageOfChild.get(id);
      if (mId) {
        const m = marriagesById.get(mId);
        const p1 = m && m.orangId1 ? positions.get(m.orangId1) : null;
        const p2 = m && m.orangId2 ? positions.get(m.orangId2) : null;
        if (p1 || p2) {
          const xs = [p1, p2].filter(Boolean).map(p => p.x);
          const parentX = xs.reduce((a, b) => a + b, 0) / xs.length;
          const childIdx = (m.childIds || []).indexOf(id);
          key = [parentX, childIdx >= 0 ? childIdx : 0];
        }
      }
      if (!key) {
        const myMarriages = marriagesByPerson.get(id) || [];
        for (const pm of myMarriages) {
          const partnerId = pm.orangId1 === id ? pm.orangId2 : pm.orangId1;
          if (partnerId && generation.get(partnerId) === g) {
            const pk = resolveSortKey(partnerId, seen);
            if (pk) { key = [pk[0], pk[1] + 0.5]; break; }
          }
        }
      }
      keyCache.set(id, key);
      return key;
    };

    const ids = [...rawIds].sort((a, b) => {
      const ka = resolveSortKey(a) || [Infinity, originalIndex.get(a)];
      const kb = resolveSortKey(b) || [Infinity, originalIndex.get(b)];
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return originalIndex.get(a) - originalIndex.get(b);
    });

    const placed = new Set();
    const units = [];

    // ---------------------------------------------------------------
    // Derajat pernikahan tiap orang DI GENERASI INI (berapa pasangan yang
    // dia punya dlm generasi yg sama) -- dihitung di awal, tetap (tidak
    // berubah oleh urutan proses), dipakai utk menentukan siapa "hub" yg
    // SEBENARNYA pada sebuah kelompok poligami. Tanpa ini, hub poligami
    // ditentukan hanya oleh siapa yg kebetulan lebih dulu muncul di data
    // mentah -- kalau yg lebih dulu adalah salah satu istri (bukan suami
    // yg py >1 istri), istri itu keburu "mengklaim" 1 pernikahan sbg
    // pasangan tunggal & menandai suaminya "selesai diproses", sehingga
    // pernikahan-pernikahan lain suami itu (dgn istri2 lain) gagal
    // terkelompok sbg satu unit hub -- akibatnya istri2 itu tidak dapat
    // warna, label "Istri ke-N", maupun siku garis yg benar (garisnya
    // memakai nilai default shg tampak menyatu dgn garis istri lain).
    // ---------------------------------------------------------------
    const degreeInGen = new Map();
    rawIds.forEach(pid => {
      const count = (marriagesByPerson.get(pid) || []).filter(m => {
        const partnerId = m.orangId1 === pid ? m.orangId2 : m.orangId1;
        return partnerId && idSet.has(partnerId) && generation.get(partnerId) === g;
      }).length;
      degreeInGen.set(pid, count);
    });

    ids.forEach(id => {
      if (placed.has(id)) return;
      const myMarriages = (marriagesByPerson.get(id) || [])
        .filter(m => {
          const partnerId = m.orangId1 === id ? m.orangId2 : m.orangId1;
          return partnerId && idSet.has(partnerId) && generation.get(partnerId) === g && !placed.has(partnerId);
        })
        .sort((a, b) => marriageSortKey(a) - marriageSortKey(b));

      // Kalau salah satu pasangan (yg belum diproses) sebenarnya py lebih
      // banyak pernikahan drpd `id`, berarti `id` cuma "istri/suami" dari
      // hub poligami yg blm giliran diproses -- tunda `id` (jangan
      // dijadikan hub sekarang), biar hub sebenarnya nanti menangkap
      // SEMUA pernikahannya sekaligus saat gilirannya tiba.
      const trueHubNotYetProcessed = myMarriages.some(m => {
        const partnerId = m.orangId1 === id ? m.orangId2 : m.orangId1;
        return (degreeInGen.get(partnerId) || 0) > (degreeInGen.get(id) || 0);
      });
      if (trueHubNotYetProcessed) return;

      if (myMarriages.length > 0) {
        const partners = myMarriages.map(m => ({
          id: m.orangId1 === id ? m.orangId2 : m.orangId1,
          marriageId: m.id
        }));
        placed.add(id);
        partners.forEach(p => placed.add(p.id));

        const isPoly = partners.length > 1;
        const hubGender = (peopleMap.get(id) || {}).jenisKelamin;
        const partnerWord = hubGender === 'Perempuan' ? 'Suami' : 'Istri';
        partners.forEach((p, idx) => {
          marriageColor.set(p.marriageId, colorFor(p.marriageId));
          if (isPoly) marriageLabel.set(p.marriageId, `${partnerWord} ke-${idx + 1}`);
        });

        const leftCount = Math.floor(partners.length / 2);
        const leftOrdered = [...partners.slice(0, leftCount)].reverse();
        const rightOrdered = partners.slice(leftCount);
        const orderedIds = [...leftOrdered.map(p => p.id), id, ...rightOrdered.map(p => p.id)];

        // Titik keluar disebar merata di sepanjang lebar kotak hub (bukan
        // cuma geser tipis dari tengah) -- supaya tiap istri jelas py
        // titik sendiri yang terpisah di kotak suami, tidak berdempetan.
        const hubIdx = orderedIds.indexOf(id);
        const kPartners = partners.length;
        orderedIds.forEach((pid, physIdx) => {
          if (pid === id) return;
          const partnerObj = partners.find(p => p.id === pid);
          if (!partnerObj) return;
          const combRank = physIdx < hubIdx ? physIdx : physIdx - 1; // 0-based, urut kiri->kanan
          marriageHubId.set(partnerObj.marriageId, id);
          const spreadX = (combRank + 1) * NODE_W / (kPartners + 1) - NODE_W / 2;
          marriageCombOffset.set(partnerObj.marriageId, spreadX);
        });

        units.push({ type: 'hub', orderedIds, marriagesForUnit: myMarriages, hubId: id });
      } else {
        placed.add(id);
        units.push({ type: 'single', ids: [id] });
      }
    });

    // ---------------------------------------------------------------
    // Kunci "keluarga" tiap unit -- dipakai utk mendeteksi OTOMATIS kapan
    // 2 unit yg bersebelahan sebenarnya berasal dari ORANG TUA YG BEDA,
    // supaya jaraknya bisa dilebarkan (FAMILY_GAP) drpd jarak antar-
    // saudara kandung biasa (H_GAP). Kunci diambil dari pernikahan orang
    // tua (parentMarriageOfChild) milik siapa saja dlm unit yg orang
    // tuanya diketahui. Kalau TIDAK ADA satupun anggota unit yg diketahui
    // orang tuanya (mis. leluhur paling atas, atau menantu yg orang
    // tuanya tdk tercatat di data), unit itu dianggap "keluarganya
    // sendiri" (kunci unik per unit) -- supaya tetap otomatis renggang
    // dari tetangganya, bukan malah dikira 1 keluarga yg sama krn sama2
    // tidak diketahui asal-usulnya.
    // ---------------------------------------------------------------
    const familyKeyOfUnit = (u) => {
      const rowIds = u.type === 'hub' ? u.orderedIds : u.ids;
      for (const pid of rowIds) {
        const mid = parentMarriageOfChild.get(pid);
        if (mid) return `fam:${mid}`;
      }
      return `solo:${rowIds[0]}`;
    };

    let x = 0;
    let prevFamilyKey = null;
    units.forEach((u, idx) => {
      const rowIds = u.type === 'hub' ? u.orderedIds : u.ids;
      const familyKey = familyKeyOfUnit(u);
      if (idx > 0) {
        // Beda keluarga (orang tua berbeda) -> renggang lebar (FAMILY_GAP).
        // Saudara/pasangan dari keluarga yg sama -> renggang normal (H_GAP).
        x += (familyKey !== prevFamilyKey) ? FAMILY_GAP : H_GAP;
      }
      rowIds.forEach((pid, i) => {
        // y diisi placeholder 0 dulu -- nilai final dipasang di TAHAP 3.
        positions.set(pid, { x: x + i * (NODE_W + COUPLE_GAP), y: 0 });
      });
      x += rowIds.length * NODE_W + (rowIds.length - 1) * COUPLE_GAP;
      prevFamilyKey = familyKey;
    });
  });

  // =====================================================================
  // TAHAP 1.5 -- PEMUSATAN HORIZONTAL ANTAR GENERASI (bentuk cemara/piramida)
  // TAHAP 1 di atas menata X tiap generasi mulai dari 0 ke kanan (rata
  // kiri) -- tanpa langkah ini, leluhur teratas (mis. Bapak Darsa & Ibu
  // Kesi, yg cuma 1 unit/2 kotak) akan selalu menempel di pojok kiri,
  // bukan di tengah pohon.
  //
  // Di sini tiap BARIS generasi digeser secara UTUH (rigid shift -- jarak
  // antar orang DALAM 1 baris yg sama sekali TIDAK berubah, cuma baris
  // itu digeser kiri/kanan) supaya titik tengahnya sejajar dgn titik
  // tengah generasi TERLEBAR (biasanya generasi paling bawah, dgn
  // keturunan terbanyak). Karena baris leluhur (generasi 0) ikut digeser
  // memakai patokan tengah yg sama, hasil akhirnya Bapak Darsa & Ibu Kesi
  // otomatis persis di tengah, dgn generasi2 di bawahnya melebar
  // simetris ke kiri & kanan -- mirip bentuk pohon cemara terbalik.
  //
  // Dilakukan SEBELUM TAHAP 2 (bukan sesudah) krn TAHAP 2 & 3 di bawah
  // memakai posisi X final (termasuk milik generasi anak) utk menghitung
  // kedalaman siku poligami -- harus sudah pasti/final duluan.
  // =====================================================================
  {
    const genExtent = new Map(); // g -> { minX, maxX, center, span }
    genKeys.forEach(g => {
      const ids = byGen.get(g) || [];
      if (!ids.length) return;
      const xs = ids.map(id => positions.get(id).x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs) + NODE_W;
      genExtent.set(g, { minX, maxX, center: (minX + maxX) / 2, span: maxX - minX });
    });

    let widestG = null, widestSpan = -1;
    genExtent.forEach((ext, g) => {
      if (ext.span > widestSpan) { widestSpan = ext.span; widestG = g; }
    });

    if (widestG !== null) {
      const targetCenter = genExtent.get(widestG).center;
      genKeys.forEach(g => {
        const ext = genExtent.get(g);
        if (!ext) return;
        const shift = targetCenter - ext.center;
        if (Math.abs(shift) < 0.01) return;
        (byGen.get(g) || []).forEach(id => {
          const pos = positions.get(id);
          if (pos) pos.x += shift;
        });
      });
    }
  }

  // =====================================================================
  // TAHAP 2 -- KEDALAMAN SIKU (marriageDepth) BERDASARKAN JANGKAUAN NYATA
  // Sekarang semua posisi X (termasuk anak di generasi bawah) sudah
  // diketahui. Untuk SETIAP GENERASI, hitung "jangkauan" (reach) horizontal
  // SEBENARNYA dari tiap pernikahan di generasi itu: rentang X dari titik
  // keluar suami & istri, DITAMBAH posisi X seluruh anaknya (karena garis
  // rel-anak ikut menjulur horizontal sampai ke posisi tiap anak, yang
  // posisinya bisa jauh dari kolom ibunya kalau anak itu sendiri berkeluarga
  // besar / berpasangan lagi).
  //
  // PENTING: pengecekan tumpang-tindih ini dilakukan utk SEMUA pernikahan
  // dalam 1 generasi sekaligus -- BUKAN cuma sesama istri dari 1 suami yg
  // sama (poligami). Sebelumnya cuma poligami yg dicek, sehingga 2
  // pernikahan dari KELUARGA YANG SAMA SEKALI BERBEDA (mis. keluarga Ibu
  // Sareni & keluarga Ibu Ratini) tidak pernah dibandingkan jangkauannya
  // satu sama lain -- kalau kebetulan jangkauan garis rel-anak keduanya
  // saling mendekat/tumpang tindih (mis. krn cucu2nya melebar), garisnya
  // bisa terlihat nempel/tertindih/seperti "membelakangi" padahal beda
  // keluarga & beda warna. Sekarang SEMUA pernikahan dlm 1 generasi ikut
  // diperiksa bersama, jadi jaminan renggangnya otomatis berlaku ke semua
  // pasangan garis yg berdekatan, bukan cuma yg sama-sama poligami.
  //
  // Dua pernikahan yang jangkauannya saling dekat (kurang dari MIN_HGAP)
  // atau tumpang tindih WAJIB dipisah ke level Y (depth) berbeda -- pakai
  // algoritma klasik "interval graph coloring" (mirip menyusun baris di
  // Gantt chart): urutkan tiap pernikahan berdasar titik-kiri jangkauannya,
  // taruh di level PERTAMA yang jangkauan sebelumnya di level itu sudah
  // selesai (+ jarak aman MIN_HGAP) sebelum titik-kiri pernikahan ini;
  // kalau tidak ada level yang cukup, baru buka level baru (lebih dalam /
  // Y lebih rendah).
  //
  // Hasilnya: pernikahan yang jangkauannya TIDAK saling dekat (baik sesama
  // istri dari 1 suami, ATAUPUN keluarga yg sama sekali tidak berkerabat)
  // tetap boleh berbagi level yang sama (depth 0) karena memang tidak akan
  // pernah bersinggungan -- tapi begitu salah satu jangkauannya melebar
  // sampai mendekati/melewati jangkauan pernikahan lain, otomatis digeser
  // lebih dalam sehingga selalu ada celah yang jelas terlihat, tidak pernah
  // menyatu ataupun seakan-akan tertindih garis pernikahan lain.
  // =====================================================================
  const rowGroups = new Map(); // generasi (angka) -> [marriageId, ...]
  marriageHubId.forEach((hubId, marriageId) => {
    const g = generation.get(hubId);
    if (!rowGroups.has(g)) rowGroups.set(g, []);
    rowGroups.get(g).push(marriageId);
  });

  rowGroups.forEach((marriageIds) => {
    const items = marriageIds.map(mid => {
      const m = marriagesById.get(mid);
      const hubId = marriageHubId.get(mid);
      const hubPos = positions.get(hubId);
      if (!hubPos) return null;
      const combOffset = marriageCombOffset.get(mid) || 0;
      const hubX = hubPos.x + NODE_W / 2 + combOffset;
      const wifeId = hubId === m.orangId1 ? m.orangId2 : m.orangId1;
      const wifePos = wifeId ? positions.get(wifeId) : null;
      const wifeX = wifePos ? wifePos.x + NODE_W / 2 : hubX;
      const childXs = (m.childIds || [])
        .map(cid => positions.get(cid))
        .filter(Boolean)
        .map(p => p.x + NODE_W / 2);
      const allXs = [hubX, wifeX, ...childXs];
      return { mid, lo: Math.min(...allXs), hi: Math.max(...allXs) };
    }).filter(Boolean);
    items.sort((a, b) => (a.lo - b.lo) || (a.hi - b.hi));

    const bandHi = []; // batas-kanan (+ margin aman MIN_HGAP) yg sudah terpakai tiap level
    items.forEach(item => {
      let depth = 0;
      while (depth < bandHi.length && bandHi[depth] > item.lo) depth++;
      if (depth === bandHi.length) bandHi.push(item.hi + MIN_HGAP);
      else bandHi[depth] = item.hi + MIN_HGAP;
      marriageDepth.set(item.mid, depth);
    });
  });

  // =====================================================================
  // TAHAP 3 -- TINGGI (Y) TIAP GENERASI
  // Kedalaman siku tiap pernikahan sudah pasti benar (TAHAP 2). Sekarang
  // hitung jarak vertikal ke generasi berikutnya berdasarkan siku
  // TERDALAM yang "berpangkal" (kedua orang tuanya berada) di generasi
  // itu, lalu tempelkan Y final ke posisi tiap orang (X sudah didapat dari
  // TAHAP 1).
  // =====================================================================
  const marriagesByAnchorGen = new Map();
  marriages.forEach(m => {
    if (!m.orangId1 || !m.orangId2) return;
    const g1 = generation.get(m.orangId1);
    const g2 = generation.get(m.orangId2);
    if (g1 !== g2) return;
    if (!marriagesByAnchorGen.has(g1)) marriagesByAnchorGen.set(g1, []);
    marriagesByAnchorGen.get(g1).push(m.id);
  });

  let cumulativeY = 0; // posisi Y generasi saat ini (kumulatif, melebar otomatis)
  genKeys.forEach(g => {
    (byGen.get(g) || []).forEach(pid => {
      const pos = positions.get(pid);
      if (pos) pos.y = cumulativeY;
    });

    // Garis rel anak terdalam pada generasi ini turun sejauh
    // STUB + maxDepthThisGen*STUB_STEP + CHILD_BUS_OFFSET dari bawah kotak.
    // Pastikan generasi berikutnya dimulai jauh melewati titik itu (+ GAP_SAFETY),
    // supaya siku poligami yang dalam (banyak istri sesisi) tidak pernah mepet
    // ataupun menembus baris kotak generasi berikutnya.
    const maxDepthThisGen = Math.max(
      0,
      ...(marriagesByAnchorGen.get(g) || []).map(mid => marriageDepth.get(mid) || 0)
    );
    const neededGap = STUB + maxDepthThisGen * STUB_STEP + CHILD_BUS_OFFSET + GAP_SAFETY;
    cumulativeY += NODE_H + Math.max(V_GAP, neededGap);
  });

  return { positions, generation, marriageColor, marriageLabel, marriageHubId, marriageDepth, marriageCombOffset };
}

// escapeHtml() sekarang didefinisikan sekali saja di db.js (v14) -- db.js selalu
// dimuat lebih dulu dari file ini di kedua halaman (index.html & admin.html).

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// rootIds (opsional): array id "pasangan utama" (mis. [idDarsa, idKesi]) --
// dipakai sbg TITIK AWAL BFS keterjangkauan di computeTreeVisibility(): yang
// tampil pertama kali dibuka HANYA rootIds itu sendiri, semua yang lain
// (pasangan lain yg tak berkerabat, mertua, ipar, keturunan, dst) baru
// muncul begitu jalur yg menghubungkannya dibuka lewat lencana +/- --
// persis konsep tab Jelajah. Kalau tidak diisi (undefined/[]), tidak ada
// pembatasan titik awal -- semua "leluhur" (org tanpa catatan orang tua)
// jadi titik awal sekaligus (perilaku lama, dipakai kalau pemanggilnya
// belum/tidak perlu fitur fokus 1 pasangan utama ini).
function renderTreeSVG(container, people, marriages, onNodeClick, rootIds) {
  // Simpan data render ini apa adanya (SEBELUM disaring status collapse) --
  // dipakai utk menggambar ulang pohon saat lencana +/- diklik nanti,
  // supaya tree.js tidak perlu bergantung ke admin.js/app.js lagi setelah render pertama.
  lastRenderByContainer.set(container, { people, marriages, onNodeClick, rootIds });

  const collapsedSet = getCollapsedSet(container);
  const { hidden, badgeOwnerSet, hiddenCountByCollapsedId } = computeTreeVisibility(people, marriages, collapsedSet, rootIds);

  const visiblePeople = people.filter(p => !hidden.has(p.id));
  const visibleIdSet = new Set(visiblePeople.map(p => p.id));
  const visibleMarriages = marriages
    .filter(m => !(m.orangId1 && hidden.has(m.orangId1)) && !(m.orangId2 && hidden.has(m.orangId2)))
    .map(m => ({ ...m, childIds: (m.childIds || []).filter(cid => visibleIdSet.has(cid)) }));

  const { positions, marriageColor, marriageLabel, marriageHubId, marriageDepth, marriageCombOffset } = layoutTree(visiblePeople, visibleMarriages);

  let maxX = 0, maxY = 0;
  positions.forEach(pos => {
    maxX = Math.max(maxX, pos.x + NODE_W);
    maxY = Math.max(maxY, pos.y + NODE_H);
  });
  const width = Math.max(maxX + 60, 400);
  const height = Math.max(maxY + 60, 300);

  let svg = `<svg id="tree-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  visibleMarriages.forEach(m => {
    const p1 = positions.get(m.orangId1);
    const p2 = m.orangId2 ? positions.get(m.orangId2) : null;
    if (!p1) return;

    const color = marriageColor.get(m.id) || DEFAULT_COLOR;
    const label = marriageLabel.get(m.id);

    // Kasus orang tua tunggal (ayah/ibu yang lain belum diketahui)
    if (!m.orangId2 || !p2 || p1.y !== p2.y) {
      const midX = p1.x + NODE_W / 2;
      const bottomY = p1.y + NODE_H;
      const stubY = bottomY + STUB;
      svg += `<line x1="${midX}" y1="${bottomY}" x2="${midX}" y2="${stubY}" stroke="${color}" stroke-width="2.5" />`;
      if (m.childIds && m.childIds.length) {
        const childXs = m.childIds.map(cid => positions.get(cid)).filter(Boolean).map(p => p.x + NODE_W / 2);
        if (childXs.length) {
          const allXs = [midX, ...childXs];
          const minCx = Math.min(...allXs), maxCx = Math.max(...allXs);
          svg += `<line x1="${minCx}" y1="${stubY}" x2="${maxCx}" y2="${stubY}" stroke="${color}" stroke-width="2.5" />`;
          m.childIds.forEach(cid => {
            const cp = positions.get(cid);
            if (cp) svg += `<line x1="${cp.x + NODE_W / 2}" y1="${stubY}" x2="${cp.x + NODE_W / 2}" y2="${cp.y}" stroke="${color}" stroke-width="2.5" />`;
          });
        }
      }
      return;
    }
    // Garis PASANGAN berbentuk "U": keluar dari BAWAH kotak istri, turun,
    // menyamping di bawah SEMUA kotak baris ini, lalu naik ke bawah kotak
    // hub (suami/istri yang mungkin py >1 pasangan). Karena seluruh bagian
    // menyamping ada DI BAWAH baris kotak, garis ini tidak pernah menembus
    // kotak pasangan lain -- meski istrinya lebih dari satu dan tidak
    // bersebelahan langsung dengan suami. Tiap pasangan (istri) dari hub
    // yang sama diberi kedalaman siku berbeda (marriageDepth) dan titik
    // keluar yang sedikit disebar di sisi hub (marriageCombOffset) supaya
    // garis-garisnya tidak saling tumpuk/berpotongan dengan siku istri lain.
    const hubId = marriageHubId.get(m.id) || m.orangId1;
    const wifeId = hubId === m.orangId1 ? m.orangId2 : m.orangId1;
    const hubPos = positions.get(hubId);
    const wifePos = positions.get(wifeId);
    const depth = marriageDepth.get(m.id) || 0;
    const combOffset = marriageCombOffset.get(m.id) || 0;

    const rowBottomY = p1.y + NODE_H;
    const hubX = hubPos.x + NODE_W / 2 + combOffset;
    const wifeX = wifePos.x + NODE_W / 2;
    const elbowY = rowBottomY + STUB + depth * STUB_STEP;

    svg += `<line x1="${hubX}" y1="${rowBottomY}" x2="${hubX}" y2="${elbowY}" stroke="${color}" stroke-width="2.5" />`;
    svg += `<line x1="${hubX}" y1="${elbowY}" x2="${wifeX}" y2="${elbowY}" stroke="${color}" stroke-width="2.5" />`;
    svg += `<line x1="${wifeX}" y1="${elbowY}" x2="${wifeX}" y2="${rowBottomY}" stroke="${color}" stroke-width="2.5" />`;
    svg += `<circle cx="${wifeX}" cy="${rowBottomY}" r="3" fill="${color}" />`;
    svg += `<circle cx="${hubX}" cy="${rowBottomY}" r="3" fill="${color}" />`;
    const midX = (hubX + wifeX) / 2;
    if (label) {
      svg += `<text x="${midX + 6}" y="${elbowY - 6}" class="marriage-label" fill="${color}">${label}</text>`;
    }

    if (m.childIds && m.childIds.length) {
      // Garis turun dari TENGAH garis "U" (bentuk T lanjutan) menuju anak
      const childBusY = elbowY + CHILD_BUS_OFFSET;
      svg += `<line x1="${midX}" y1="${elbowY}" x2="${midX}" y2="${childBusY}" stroke="${color}" stroke-width="2.5" />`;
      const childXs = m.childIds.map(cid => positions.get(cid)).filter(Boolean).map(p => p.x + NODE_W / 2);
      if (childXs.length) {
        const allXs = [midX, ...childXs];
        const minCx = Math.min(...allXs), maxCx = Math.max(...allXs);
        svg += `<line x1="${minCx}" y1="${childBusY}" x2="${maxCx}" y2="${childBusY}" stroke="${color}" stroke-width="2.5" />`;
        m.childIds.forEach(cid => {
          const cp = positions.get(cid);
          if (cp) {
            svg += `<line x1="${cp.x + NODE_W / 2}" y1="${childBusY}" x2="${cp.x + NODE_W / 2}" y2="${cp.y}" stroke="${color}" stroke-width="2.5" />`;
          }
        });
      }
    }
  });

  visiblePeople.forEach(p => {
    const pos = positions.get(p.id);
    if (!pos) return;
    const isMale = p.jenisKelamin === 'Laki-laki';
    const cls = isMale ? 'node-male' : 'node-female';
    const wafat = p.tglWafat ? ' (alm.)' : '';

    // Lencana +/- kecil di bawah-tengah kotak: HANYA muncul pada node istri
    // (pemilik jalur keturunan -- lihat aturan badgeOwnerSet di
    // computeTreeVisibility). Node suami TIDAK PERNAH diberi lencana, walau
    // dia juga tercatat sbg ayah dari anak-anak yg sama -- supaya jalur
    // keturunan tiap istri (termasuk kasus poligami) jelas dibuka lewat
    // istrinya masing-masing, bukan lewat suami yg bisa py >1 istri.
    // "-" = sedang ditampilkan (klik utk ciutkan/hide), "+N" = sedang
    // diciutkan, klik utk tampilkan lagi N keturunannya.
    let toggleSvg = '';
    if (badgeOwnerSet.has(p.id)) {
      const isCollapsed = collapsedSet.has(p.id);
      const hiddenCount = hiddenCountByCollapsedId.get(p.id) || 0;
      const badgeLabel = isCollapsed ? `+${hiddenCount}` : '\u2212';
      const badgeW = isCollapsed ? Math.max(20, 10 + String(hiddenCount).length * 7) : 18;
      toggleSvg = `
        <g class="tree-toggle" data-toggle-id="${p.id}" transform="translate(${NODE_W / 2 - badgeW / 2},${NODE_H - 9})" style="cursor:pointer">
          <rect width="${badgeW}" height="18" rx="9" class="toggle-badge-rect ${isCollapsed ? 'toggle-badge-collapsed' : ''}"/>
          <text x="${badgeW / 2}" y="13" text-anchor="middle" class="toggle-badge-text">${badgeLabel}</text>
        </g>`;
    }

    svg += `
      <g class="tree-node ${cls}" data-id="${p.id}" transform="translate(${pos.x},${pos.y})">
        <rect width="${NODE_W}" height="${NODE_H}" rx="10" class="node-rect" style="cursor:pointer"/>
        <text x="${NODE_W / 2}" y="26" text-anchor="middle" class="node-name" style="cursor:pointer">${escapeHtml(truncate(p.nama, 16))}</text>
        <text x="${NODE_W / 2}" y="44" text-anchor="middle" class="node-sub" style="cursor:pointer">${escapeHtml(p.jenisKelamin || '')}${wafat}</text>
        ${toggleSvg}
      </g>`;
  });

  svg += `</svg>`;
  container.innerHTML = svg;

  container.querySelectorAll('.tree-node').forEach(node => {
    // Klik di mana saja pada kotak node (KECUALI lencana toggle) membuka form edit/detail,
    // sama seperti perilaku sebelumnya.
    node.querySelectorAll('.node-rect, .node-name, .node-sub').forEach(el => {
      el.addEventListener('click', () => onNodeClick(node.dataset.id));
    });
  });
  container.querySelectorAll('.tree-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTreeNode(container, toggle.dataset.toggleId);
    });
  });
}
