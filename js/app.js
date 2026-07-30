// =====================================================================
// APP.JS — logika halaman publik (Tamu)
// =====================================================================

let allPeople = [];
let allMarriages = [];
let currentScale = 1;
let currentPersonId = null;
let appSettings = {};

const treeContainer = document.getElementById('tree-container');
const treeWrapper = document.getElementById('tree-wrapper');

async function init() {
  try {
    appSettings = await SettingsAPI.getAppSettings();
    document.getElementById('app-title').textContent = appSettings.judulAplikasi || 'Silsilah Keluarga';
    document.title = appSettings.judulAplikasi || 'Silsilah Keluarga';
  } catch (e) { appSettings = {}; /* pakai judul default jika gagal */ }

  await loadData();
  setupPanZoom();
  setupSearch();
  setupModal();
  setupLaporanModal();
  setupDashboardModal();
  setupJelajahModal();
  setupViewPicker();

  // Revisi: tampilan pertama yang dilihat pengunjung adalah LAYAR PILIHAN
  // TAMPILAN (kartu atau pohon), bukan langsung salah satu mode -- dan bukan
  // pula kanvas pohon/node yang otomatis kelihatan (baru dirender begitu
  // tamu memilih mode Pohon di layar pilihan ini).
  if (allPeople.length > 0) showViewPicker();
}

// ---------- Layar Pilihan Tampilan (Kartu / Pohon) ----------
let treeRendered = false;

function isRootFixed() {
  const rootId = appSettings.rootPersonId;
  return !!(rootId && allPeople.some(p => p.id === rootId));
}

function setupViewPicker() {
  document.getElementById('pick-kartu').addEventListener('click', showKartuView);
  document.getElementById('pick-pohon').addEventListener('click', showPohonView);
  document.getElementById('btn-jelajah').addEventListener('click', showKartuView);
  document.getElementById('btn-pohon-topbar').addEventListener('click', showPohonView);
  document.getElementById('btn-pohon-kembali').addEventListener('click', showViewPicker);
}

function showViewPicker() {
  closeJelajahModal();
  document.getElementById('pohon-view').style.display = 'none';
  document.getElementById('view-picker').style.display = 'flex';
}

function showPohonView() {
  document.getElementById('view-picker').style.display = 'none';
  document.getElementById('pohon-view').style.display = 'flex';
  renderTreeIfNeeded();
}

function showKartuView() {
  document.getElementById('view-picker').style.display = 'none';
  openJelajahModal();
}

// Pohon baru digambar sekali, saat pertama kali tamu memilih mode Pohon --
// bukan otomatis saat halaman dimuat -- supaya layar awal bebas dari
// tampilan node/garis yang bisa terasa penuh/mengganggu mata.
function renderTreeIfNeeded() {
  if (treeRendered) return;
  renderTreeSVG(treeContainer, allPeople, allMarriages, openDetail);
  TreeControls.collapseAll(treeContainer);
  treeRendered = true;
}

async function loadData() {
  const [peopleRaw, marriagesRaw] = await Promise.all([
    PeopleAPI.getAll(),
    MarriageAPI.getAll()
  ]);

  // Fitur "Keluarga Utama" (diatur admin lewat tab Setting > Keluarga Utama
  // untuk Tampilan Publik): kalau disetel, tampilan publik (pohon, pencarian,
  // Laporan, Dashboard) HANYA menampilkan 1 keluarga besar tertentu -- yaitu
  // orang yang dipilih beserta seluruh kerabat langsungnya (pasangan, orang
  // tua/leluhur, dan semua keturunan). Keluarga lain yang sama sekali tidak
  // berkerabat (mis. keluarga besar admin lain yang datanya kebetulan ada di
  // database yang sama) disembunyikan TOTAL, bukan cuma diciutkan -- beda
  // dengan status ciut/lebar per-cabang yang sudah ada (lihat tree.js) yang
  // hanya mengatur keturunan yang tampil pertama kali dibuka.
  let people = peopleRaw, marriages = marriagesRaw;
  const rootId = appSettings.rootPersonId;
  if (rootId && peopleRaw.some(p => p.id === rootId)) {
    const idsInFamily = FamilyGraph.getConnectedComponentIds(rootId, peopleRaw, marriagesRaw);
    people = peopleRaw.filter(p => idsInFamily.has(p.id));
    marriages = marriagesRaw
      .filter(m => (m.orangId1 && idsInFamily.has(m.orangId1)) || (m.orangId2 && idsInFamily.has(m.orangId2)))
      .map(m => ({ ...m, childIds: (m.childIds || []).filter(cid => idsInFamily.has(cid)) }));
  }
  allPeople = people;
  allMarriages = marriages;

  if (allPeople.length === 0) {
    document.getElementById('empty-state').style.display = 'flex';
    return;
  }
  // Catatan: pohon (SVG) TIDAK dirender di sini lagi -- baru digambar lewat
  // renderTreeIfNeeded() saat tamu memilih mode "Pohon Keluarga" di layar
  // pilihan tampilan, supaya layar awal bersih dari node/garis.
}

// ---------- Pan & Zoom ----------
function setupPanZoom() {
  let isPanning = false, startX, startY, scrollLeft, scrollTop;

  treeWrapper.addEventListener('mousedown', e => {
    isPanning = true;
    startX = e.pageX - treeWrapper.offsetLeft;
    startY = e.pageY - treeWrapper.offsetTop;
    scrollLeft = treeWrapper.scrollLeft;
    scrollTop = treeWrapper.scrollTop;
    treeWrapper.classList.add('grabbing');
  });
  window.addEventListener('mouseup', () => { isPanning = false; treeWrapper.classList.remove('grabbing'); });
  treeWrapper.addEventListener('mousemove', e => {
    if (!isPanning) return;
    e.preventDefault();
    const x = e.pageX - treeWrapper.offsetLeft;
    const y = e.pageY - treeWrapper.offsetTop;
    treeWrapper.scrollLeft = scrollLeft - (x - startX);
    treeWrapper.scrollTop = scrollTop - (y - startY);
  });

  document.getElementById('zoom-in').addEventListener('click', () => setZoom(currentScale + 0.15));
  document.getElementById('zoom-out').addEventListener('click', () => setZoom(currentScale - 0.15));
  document.getElementById('zoom-reset').addEventListener('click', () => setZoom(1));
  document.getElementById('tree-expand-all').addEventListener('click', () => TreeControls.expandAll(treeContainer));
  document.getElementById('tree-collapse-all').addEventListener('click', () => TreeControls.collapseAll(treeContainer));
}

function setZoom(scale) {
  currentScale = Math.min(Math.max(scale, 0.4), 2.5);
  treeContainer.style.transform = `scale(${currentScale})`;
  treeContainer.style.transformOrigin = 'top left';
}

// ---------- Search ----------
function setupSearch() {
  const input = document.getElementById('search-input');
  if (!input) return; // kotak pencarian topbar sudah digantikan tab "Pencarian Data"
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('.tree-node').forEach(node => {
      const id = node.dataset.id;
      const person = allPeople.find(p => p.id === id);
      const match = q && person && person.nama.toLowerCase().includes(q);
      node.classList.toggle('highlight', !!match);
    });
    if (q) {
      const found = allPeople.find(p => p.nama.toLowerCase().includes(q));
      if (found) {
        const el = document.querySelector(`.tree-node[data-id="${found.id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }
  });
}

// ---------- Modal detail ----------
function setupModal() {
  document.getElementById('modal-close').addEventListener('click', closeDetail);
  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target.id === 'detail-modal') closeDetail();
  });
  document.getElementById('comment-form').addEventListener('submit', submitComment);

  const textArea = document.getElementById('comment-text');
  const counter = document.getElementById('comment-counter');
  if (textArea && counter) {
    textArea.addEventListener('input', () => {
      counter.textContent = `${textArea.value.length}/${textArea.maxLength}`;
    });
  }
}

function openDetail(personId) {
  currentPersonId = personId;
  const p = allPeople.find(x => x.id === personId);
  if (!p) return;

  const pasangan = allMarriages
    .filter(m => m.orangId1 === personId || m.orangId2 === personId)
    .map(m => {
      const partnerId = m.orangId1 === personId ? m.orangId2 : m.orangId1;
      const partner = allPeople.find(x => x.id === partnerId);
      return partner ? partner.nama : null;
    }).filter(Boolean);

  const anak = allMarriages
    .filter(m => m.orangId1 === personId || m.orangId2 === personId)
    .flatMap(m => m.childIds || [])
    .map(cid => allPeople.find(x => x.id === cid))
    .filter(Boolean)
    .map(c => c.nama);

  const fotoHtml = p.fotoUrl
    ? `<img src="${p.fotoUrl}" class="detail-photo" alt="Foto ${escapeHtml(p.nama)}">`
    : `<div class="detail-photo detail-photo-placeholder">${escapeHtml((p.nama || '?').charAt(0))}</div>`;

  document.getElementById('detail-content').innerHTML = `
    ${fotoHtml}
    <h2 class="detail-name">${escapeHtml(p.nama)}${p.alias ? ` <span class="detail-alias">(${escapeHtml(p.alias)})</span>` : ''}</h2>
    <p class="detail-gender">${escapeHtml(p.jenisKelamin || '-')}</p>
    <table class="detail-table">
      ${row('Tanggal lahir', formatDate(p.tglLahir))}
      ${row('Tanggal wafat', formatDate(p.tglWafat))}
      ${row('Tempat lahir', p.tempatLahir)}
      ${row('Agama', p.agama)}
      ${row('Pekerjaan', p.pekerjaan)}
      ${row('Alamat', p.alamat)}
      ${row('Kontak', p.kontak)}
      ${row('Pasangan', pasangan.join(', '))}
      ${row('Anak', anak.join(', '))}
      ${row('Catatan', p.catatan)}
    </table>
  `;
  document.getElementById('comment-form').reset();
  document.getElementById('comment-feedback').textContent = '';
  document.getElementById('detail-modal').style.display = 'flex';
}

function row(label, value) {
  if (!value) return '';
  return `<tr><td class="detail-label">${label}</td><td>${escapeHtml(value)}</td></tr>`;
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function closeDetail() {
  document.getElementById('detail-modal').style.display = 'none';
  currentPersonId = null;
}

// ---------- Modal Laporan (cari relasi keluarga) ----------
let laporanSelectedId = null;

function setupLaporanModal() {
  document.getElementById('btn-laporan').addEventListener('click', openLaporanModal);
  document.getElementById('laporan-modal-close').addEventListener('click', closeLaporanModal);
  document.getElementById('laporan-modal').addEventListener('click', e => {
    if (e.target.id === 'laporan-modal') closeLaporanModal();
  });

  const searchInput = document.getElementById('laporan-search');
  searchInput.addEventListener('input', () => renderLaporanSearchResults(searchInput.value));

  document.getElementById('laporan-clear').addEventListener('click', () => {
    laporanSelectedId = null;
    document.getElementById('laporan-detail').style.display = 'none';
    searchInput.value = '';
    searchInput.focus();
    renderLaporanSearchResults('');
  });
}

function openLaporanModal() {
  document.getElementById('laporan-modal').style.display = 'flex';
  document.getElementById('laporan-search').value = '';
  document.getElementById('laporan-search-results').innerHTML = '';
  document.getElementById('laporan-detail').style.display = 'none';
  laporanSelectedId = null;
}

function closeLaporanModal() {
  document.getElementById('laporan-modal').style.display = 'none';
}

function renderLaporanSearchResults(query) {
  const box = document.getElementById('laporan-search-results');
  const q = query.trim().toLowerCase();
  if (!q) { box.innerHTML = ''; return; }

  const matches = allPeople.filter(p => p.nama.toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = matches.map(p => `
    <div class="relasi-result-item" onclick="selectLaporanPerson('${p.id}')">
      ${escapeHtml(p.nama)} <span class="relasi-result-sub">(${escapeHtml(p.jenisKelamin || '-')})</span>
    </div>
  `).join('') || '<div class="relasi-result-empty">Tidak ditemukan.</div>';
}

function selectLaporanPerson(id) {
  laporanSelectedId = id;
  document.getElementById('laporan-search').value = '';
  document.getElementById('laporan-search-results').innerHTML = '';
  document.getElementById('laporan-detail').style.display = 'block';

  const person = allPeople.find(p => p.id === id);
  const genInfo = RelationRules.getGenerationInfo(id, allPeople, allMarriages);
  document.getElementById('laporan-biodata-card').innerHTML = BiodataView.buildFolioHTML(person, genInfo);

  const lines = RelationRules.generateNarrative(id, allPeople, allMarriages);
  const listEl = document.getElementById('laporan-narrative-list');
  listEl.innerHTML = lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') || '<li>Belum ada informasi relasi yang bisa ditampilkan.</li>';
}

// ---------- Modal Dashboard (ringkasan statistik) ----------
function setupDashboardModal() {
  document.getElementById('btn-dashboard').addEventListener('click', openDashboardModal);
  document.getElementById('dashboard-modal-close').addEventListener('click', closeDashboardModal);
  document.getElementById('dashboard-modal').addEventListener('click', e => {
    if (e.target.id === 'dashboard-modal') closeDashboardModal();
  });
}

function openDashboardModal() {
  const stats = StatsAPI.computeBasicStats(allPeople, allMarriages);
  const cards = [
    { label: 'Total Orang', value: stats.totalOrang, icon: '👥', tone: 'blue' },
    { label: 'Total Keluarga / Pasangan', value: stats.totalKeluarga, icon: '💍', tone: 'green' },
    { label: 'Laki-laki', value: stats.laki, icon: '👨', tone: 'blue' },
    { label: 'Perempuan', value: stats.perempuan, icon: '👩', tone: 'pink' },
    { label: 'Anak Tercatat', value: stats.totalAnakTercatat, icon: '🧒', tone: 'green' },
    { label: 'Jumlah Generasi', value: stats.maxGenerasi, icon: '🌳', tone: 'blue' }
  ];
  document.getElementById('dashboard-content').innerHTML = DashboardView.buildCardsHTML(cards);
  document.getElementById('dashboard-modal').style.display = 'flex';
}

function closeDashboardModal() {
  document.getElementById('dashboard-modal').style.display = 'none';
}

// ---------- Jelajah Keluarga (mode kartu, drill-down per keturunan) ----------
// Satu "node" = satu pernikahan tertentu (personA + personB) ATAU satu orang
// tanpa pernikahan tercatat (personB null) -- ini yang dipakai utk KARTU BESAR
// (posisi sekarang), karena posisi sekarang selalu sudah "pasti" 1 pernikahan
// spesifik yg dipilih.
//
// Untuk daftar KARTU KECIL (leluhur atau anak-anak yg belum diklik), 1 orang =
// 1 "entry" (bukan 1 node per pernikahan lagi). Kalau orang itu py >1 pernikahan
// (poligami), kartunya TETAP 1, tapi di dalamnya ada sub-list pasangan (Istri/
// Suami ke-1, ke-2, ke-3, dst) -- tiap baris sub-list itulah yg diklik utk
// masuk ke keturunan dari pernikahan tsb. Kalau cuma 1 pernikahan (atau belum
// menikah), kartu tetap tampil polos (gabungan nama, spt sebelumnya) tanpa
// sub-list, langsung bisa diklik.
//
// `jelajahPath` menyimpan jalur NODE (bukan entry) dari leluhur sampai posisi
// sekarang -- dipakai utk breadcrumb & kartu besar yang sedang aktif.
let jelajahPath = [];
let jelajahCurrentChildEntries = [];   // entry level-anak yg sedang tampil di bawah kartu besar (utk lookup saat kartu/sub-list diklik)
let jelajahCurrentPickerEntries = [];  // entry level-leluhur yg sedang tampil saat jelajahPath masih kosong

// Apakah daftar "Anak & pasangannya" utk NODE PALING ATAS (jelajahPath teratas)
// sedang ditampilkan. Supaya publik/tamu pertama kali membuka Jelajah cuma
// melihat SATU kartu (leluhur utama) dulu -- baru setelah kartu itu diklik,
// daftar anaknya baru muncul. Setiap kali pindah ke node yg berbeda (masuk
// lebih dalam), status ini di-reset ke false lagi (harus diklik ulang utk
// level yg baru itu). Saat KEMBALI naik ke level sebelumnya (atau lewat
// breadcrumb), status di-set true lagi krn level itu memang sudah pernah
// dibuka sebelumnya (itulah caranya bisa turun ke level yg sekarang).
let jelajahShowChildren = false;

function setupJelajahModal() {
  document.getElementById('jelajah-modal-close').addEventListener('click', showViewPicker);
  document.getElementById('jelajah-modal').addEventListener('click', e => {
    if (e.target.id === 'jelajah-modal') showViewPicker();
  });
}

// Semua pernikahan personId, tiap pernikahan jadi 1 node (dipakai baik utk
// kartu besar maupun utk isi sub-list poligami). Kalau tidak punya pernikahan
// tercatat sama sekali, tetap 1 node (personB null).
function getPersonMarriageNodes(personId) {
  const marriagesOf = allMarriages
    .filter(m => m.orangId1 === personId || m.orangId2 === personId)
    .sort((a, b) => (a.urutanPasangan || 1) - (b.urutanPasangan || 1));

  if (marriagesOf.length === 0) {
    return [{ personAId: personId, personBId: null, marriageId: null, indexLabel: null, childIds: [] }];
  }
  const isPoly = marriagesOf.length > 1;
  return marriagesOf.map((m, idx) => {
    const partnerId = m.orangId1 === personId ? m.orangId2 : m.orangId1;
    return {
      personAId: personId,
      personBId: partnerId || null,
      marriageId: m.id,
      indexLabel: isPoly ? (idx + 1) : null,
      childIds: m.childIds || []
    };
  });
}

// 1 entry = 1 orang beserta seluruh node pernikahannya (dipakai utk kartu kecil).
function makeEntry(personId) {
  return { personId, nodes: getPersonMarriageNodes(personId) };
}

// Entry anak-anak dari sebuah node (dipanggil setelah kartu besar diklik) --
// tiap anak jadi 1 entry (poligami anak = 1 kartu ttp dgn sub-list di dalamnya).
function getChildEntriesOf(node) {
  return (node.childIds || []).map(cid => makeEntry(cid));
}

// Entry level paling awal, dipakai kalau admin belum menyetel "Keluarga Utama"
// -- tamu memilih dulu mau mulai jelajah dari leluhur mana. Leluhur = orang
// yang belum tercatat orang tuanya. Dedupe by marriageId supaya 1 pasangan
// leluhur (mis. suami & istri yg sama2 tanpa orang tua tercatat) tidak
// menghasilkan 2 kartu terpisah utk pernikahan yang sama.
function getRootPickerEntries() {
  const leluhurList = allPeople.filter(p => {
    const { ayah, ibu } = RelationRules.getParents(p.id, allPeople, allMarriages);
    return !ayah && !ibu;
  });
  const seenMarriageIds = new Set();
  const result = [];
  leluhurList.forEach(p => {
    const nodes = getPersonMarriageNodes(p.id);
    const belumMenikah = nodes.length === 1 && !nodes[0].marriageId;
    if (belumMenikah) { result.push({ personId: p.id, nodes }); return; }

    const nodesBaru = nodes.filter(n => !seenMarriageIds.has(n.marriageId));
    if (nodesBaru.length === 0) return; // semua pernikahannya sudah kebawa lewat kartu pasangannya
    nodesBaru.forEach(n => seenMarriageIds.add(n.marriageId));
    result.push({ personId: p.id, nodes: nodesBaru });
  });
  return result;
}

function openJelajahModal() {
  const rootId = appSettings.rootPersonId;
  const rootValid = rootId && allPeople.some(p => p.id === rootId);
  if (rootValid) {
    const rootNodes = getPersonMarriageNodes(rootId);
    // Kalau leluhur utama cuma py 1 pernikahan -> langsung tampil sbg kartu besar
    // tanpa perlu pilih dulu. Kalau poligami (jarang utk leluhur utama), tamu
    // pilih dulu (via sub-list) pernikahan mana yg mau ditelusuri.
    jelajahPath = rootNodes.length === 1 ? [rootNodes[0]] : [];
  } else {
    jelajahPath = [];
  }
  jelajahShowChildren = false;
  renderJelajah();
  document.getElementById('jelajah-modal').style.display = 'flex';
}

function closeJelajahModal() {
  document.getElementById('jelajah-modal').style.display = 'none';
}

// entryIdx = index kartu di jelajahCurrentPickerEntries/jelajahCurrentChildEntries.
// nodeIdx = index pernikahan di dalam entry itu (0 kalau kartu polos/1 pernikahan,
// atau sesuai baris sub-list yg diklik kalau poligami).
function jelajahMasukChild(entryIdx, nodeIdx) {
  const source = jelajahPath.length === 0 ? jelajahCurrentPickerEntries : jelajahCurrentChildEntries;
  const entry = source[entryIdx];
  if (!entry) return;
  const node = entry.nodes[nodeIdx || 0];
  if (!node) return;
  jelajahPath.push(node);
  jelajahShowChildren = false; // level baru ini blm diklik -- tampilkan 1 kartu dulu
  renderJelajah();
}

// Diklik saat kartu besar (leluhur/posisi sekarang) yg anaknya belum
// ditampilkan -- memunculkan daftar "Anak & pasangannya" di bawahnya.
function jelajahBukaAnak() {
  jelajahShowChildren = true;
  renderJelajah();
}

// Tombol "Kembali" selalu mundur PERSIS SATU LANGKAH sesuai urutan tamu
// masuk (hulu -> hilir saat maju, hilir -> hulu saat mundur). Kalau sudah
// berada di level paling atas (leluhur awal, atau leluhur tetap kalau admin
// sudah menyetel "Keluarga Utama"), langkah mundur berikutnya membawa tamu
// keluar dari mode Kartu, kembali ke layar Pilihan Tampilan paling awal --
// bukan berhenti begitu saja di tengah jalan.
function jelajahKembali() {
  const sudahDiLevelAwal = isRootFixed() ? jelajahPath.length <= 1 : jelajahPath.length <= 0;
  if (sudahDiLevelAwal) {
    showViewPicker();
    return;
  }
  jelajahPath.pop();
  jelajahShowChildren = true; // level ini sebelumnya memang sudah dibuka (asal bisa turun ke bawahnya)
  renderJelajah();
}

function jelajahKeBreadcrumb(index) {
  jelajahPath = jelajahPath.slice(0, index + 1);
  jelajahShowChildren = true; // level ini sebelumnya memang sudah dibuka
  renderJelajah();
}

function jelajahNodeLabel(node) {
  const a = allPeople.find(p => p.id === node.personAId);
  const b = node.personBId ? allPeople.find(p => p.id === node.personBId) : null;
  const namaA = a ? a.nama : '?';
  return escapeHtml(b ? `${namaA} & ${b.nama}` : namaA);
}

// Render KARTU BESAR (posisi sekarang) dari 1 node yg sudah pasti/dipilih --
// tidak ada sub-list di sini krn pernikahannya sudah spesifik dipilih; naik
// lagi lewat breadcrumb/tombol Kembali kalau mau lihat pasangan lain orang ini.
function renderJelajahBigCard(node, showChildren) {
  const personA = allPeople.find(p => p.id === node.personAId);
  if (!personA) return '';
  const personB = node.personBId ? allPeople.find(p => p.id === node.personBId) : null;
  const isFemaleA = personA.jenisKelamin === 'Perempuan';

  const title = personB
    ? `${escapeHtml(personA.nama)} &amp; ${escapeHtml(personB.nama)}`
    : escapeHtml(personA.nama);
  const genderSub = personB
    ? `${escapeHtml(personA.jenisKelamin || '-')} &amp; ${escapeHtml(personB.jenisKelamin || '-')}`
    : escapeHtml(personA.jenisKelamin || '-');
  const polyTag = node.indexLabel
    ? `<span class="jelajah-poly-tag">Pernikahan ke-${node.indexLabel}</span>`
    : '';
  const childCount = (node.childIds || []).length;
  const childInfo = `<div class="jelajah-card-childinfo">${childCount ? childCount + ' anak tercatat' : 'Belum ada anak tercatat'}</div>`;
  const biodataLinks = `
    <div class="jelajah-card-links">
      <button class="btn-link jelajah-biodata-link" onclick="event.stopPropagation();openDetail('${node.personAId}')">Biodata ${escapeHtml(personA.nama)}</button>
      ${personB ? `<button class="btn-link jelajah-biodata-link" onclick="event.stopPropagation();openDetail('${node.personBId}')">Biodata ${escapeHtml(personB.nama)}</button>` : ''}
    </div>
  `;
  // Selama daftar anak blm ditampilkan, kartu ini sendiri bisa diklik utk
  // memunculkannya (kalau memang ada anak tercatat) -- diberi hint "> Lihat
  // anak & pasangannya" spy tamu tahu kartu ini bisa diklik.
  const clickable = !showChildren && childCount > 0;
  const expandHint = clickable ? `<div class="jelajah-expand-hint">Lihat anak &amp; pasangannya</div>` : '';

  return `
    <div class="jelajah-card jelajah-card-big ${isFemaleA ? 'jelajah-card-female' : ''} ${clickable ? 'jelajah-card-big-clickable' : ''}"
      ${clickable ? 'onclick="jelajahBukaAnak()"' : ''}>
      <div class="jelajah-card-name">${title}</div>
      <div class="jelajah-card-sub">${genderSub}</div>
      ${polyTag}
      ${childInfo}
      ${expandHint}
      ${biodataLinks}
    </div>
  `;
}

// Render KARTU KECIL dari 1 entry (leluhur ATAU anak, belum dipilih/diklik).
// Kalau entry.nodes cuma 1 (blm menikah atau monogami) -> kartu polos, seluruh
// kartu bisa diklik langsung (spt sebelumnya, tanpa lapisan tambahan).
// Kalau entry.nodes > 1 (poligami) -> TETAP 1 kartu utk orangnya, tapi di
// dalamnya ada sub-list pasangan (Istri/Suami ke-1, ke-2, dst); tiap baris
// sub-list itulah yg diklik utk membuka keturunan dari pernikahan tsb.
function renderJelajahEntryCard(entry, entryIdx) {
  const person = allPeople.find(p => p.id === entry.personId);
  if (!person) return '';
  const nodes = entry.nodes;

  if (nodes.length <= 1) {
    const node = nodes[0];
    const personB = node.personBId ? allPeople.find(p => p.id === node.personBId) : null;
    const isFemaleA = person.jenisKelamin === 'Perempuan';
    const title = personB
      ? `${escapeHtml(person.nama)} &amp; ${escapeHtml(personB.nama)}`
      : escapeHtml(person.nama);
    const genderSub = personB
      ? `${escapeHtml(person.jenisKelamin || '-')} &amp; ${escapeHtml(personB.jenisKelamin || '-')}`
      : escapeHtml(person.jenisKelamin || '-');
    const childCount = (node.childIds || []).length;
    const childInfo = `<div class="jelajah-card-childinfo">${childCount ? childCount + ' anak tercatat' : 'Belum ada anak tercatat'}</div>`;
    const biodataLinks = `
      <div class="jelajah-card-links">
        <button class="btn-link jelajah-biodata-link" onclick="event.stopPropagation();openDetail('${person.id}')">Biodata ${escapeHtml(person.nama)}</button>
        ${personB ? `<button class="btn-link jelajah-biodata-link" onclick="event.stopPropagation();openDetail('${node.personBId}')">Biodata ${escapeHtml(personB.nama)}</button>` : ''}
      </div>
    `;
    return `
      <div class="jelajah-card jelajah-card-sm ${isFemaleA ? 'jelajah-card-female' : ''}" onclick="jelajahMasukChild(${entryIdx}, 0)">
        <div class="jelajah-card-name">${title}</div>
        <div class="jelajah-card-sub">${genderSub}</div>
        ${childInfo}
        ${biodataLinks}
      </div>
    `;
  }

  // Poligami: 1 kartu utk orangnya + sub-list pasangan di dalamnya.
  const isMale = person.jenisKelamin === 'Laki-laki';
  const isFemale = person.jenisKelamin === 'Perempuan';
  const partnerWord = isMale ? 'Istri' : (isFemale ? 'Suami' : 'Pasangan');
  const totalAnak = nodes.reduce((sum, n) => sum + (n.childIds || []).length, 0);

  const subRows = nodes.map((n, ni) => {
    const partner = n.personBId ? allPeople.find(p => p.id === n.personBId) : null;
    const partnerName = partner ? escapeHtml(partner.nama) : '<span class="jelajah-muted">belum tercatat</span>';
    const childCount = (n.childIds || []).length;
    return `
      <div class="jelajah-subcard" onclick="event.stopPropagation();jelajahMasukChild(${entryIdx}, ${ni})">
        <span class="jelajah-subcard-order">${partnerWord} ke-${n.indexLabel || (ni + 1)}</span>
        <span class="jelajah-subcard-name">${partnerName}</span>
        <span class="jelajah-subcard-info">${childCount ? childCount + ' anak' : 'belum ada anak'}</span>
        <span class="jelajah-subcard-arrow">&rsaquo;</span>
      </div>
    `;
  }).join('');

  return `
    <div class="jelajah-card jelajah-card-sm jelajah-card-poly ${isFemale ? 'jelajah-card-female' : ''}">
      <div class="jelajah-card-name">${escapeHtml(person.nama)}</div>
      <div class="jelajah-card-sub">${escapeHtml(person.jenisKelamin || '-')} &middot; ${nodes.length} pernikahan &middot; ${totalAnak} anak tercatat</div>
      <div class="jelajah-subcard-list">${subRows}</div>
      <div class="jelajah-card-links">
        <button class="btn-link jelajah-biodata-link" onclick="openDetail('${person.id}')">Biodata ${escapeHtml(person.nama)}</button>
      </div>
    </div>
  `;
}

function renderJelajah() {
  const breadcrumbEl = document.getElementById('jelajah-breadcrumb');
  const bodyEl = document.getElementById('jelajah-body');

  // Belum ada leluhur dipilih -- tampilkan kartu-kartu leluhur utk dipilih.
  if (jelajahPath.length === 0) {
    jelajahCurrentPickerEntries = getRootPickerEntries();
    breadcrumbEl.innerHTML = '';
    bodyEl.innerHTML = `
      <p class="jelajah-muted">Pilih leluhur untuk mulai menjelajah:</p>
      <div class="jelajah-card-list">
        ${jelajahCurrentPickerEntries.map((entry, i) => renderJelajahEntryCard(entry, i)).join('')
          || '<p class="jelajah-muted">Belum ada data orang.</p>'}
      </div>
      <div class="jelajah-back-row"><button class="btn-link" onclick="jelajahKembali()">&larr; Kembali ke Pilihan Tampilan</button></div>
    `;
    return;
  }

  // Breadcrumb dari jalur node yg sudah dilalui.
  const crumbHtml = jelajahPath.map((node, i) => {
    const isLast = i === jelajahPath.length - 1;
    return `<span class="jelajah-crumb${isLast ? ' jelajah-crumb-active' : ''}" onclick="jelajahKeBreadcrumb(${i})">${jelajahNodeLabel(node)}</span>${isLast ? '' : '<span class="jelajah-crumb-sep">&rsaquo;</span>'}`;
  }).join('');
  breadcrumbEl.innerHTML = crumbHtml;

  const topNode = jelajahPath[jelajahPath.length - 1];
  jelajahCurrentChildEntries = getChildEntriesOf(topNode);

  // Selama kartu besar belum diklik (jelajahShowChildren masih false), daftar
  // anak & pasangannya BELUM ditampilkan sama sekali -- publik/tamu hanya
  // melihat 1 kartu (leluhur/posisi sekarang) dulu, sesuai revisi.
  let childrenSection = '';
  if (jelajahShowChildren) {
    const childrenHtml = jelajahCurrentChildEntries.length
      ? `<div class="jelajah-card-list">${jelajahCurrentChildEntries.map((entry, i) => renderJelajahEntryCard(entry, i)).join('')}</div>`
      : '<p class="jelajah-muted jelajah-noanak">Belum ada anak tercatat.</p>';
    childrenSection = `
      <p class="jelajah-group-label jelajah-children-label">Anak &amp; pasangannya:</p>
      ${childrenHtml}
    `;
  }

  bodyEl.innerHTML = `
    ${renderJelajahBigCard(topNode, jelajahShowChildren)}
    ${childrenSection}
    <div class="jelajah-back-row"><button class="btn-link" onclick="jelajahKembali()">&larr; Kembali</button></div>
  `;
}

const COMMENT_COOLDOWN_MS = 15000; // jeda minimal 15 detik antar kirim komentar dari browser yang sama

async function submitComment(e) {
  e.preventDefault();
  const nama = document.getElementById('comment-name').value.trim();
  const isi = document.getElementById('comment-text').value.trim();
  const feedback = document.getElementById('comment-feedback');
  const submitBtn = document.querySelector('#comment-form button[type="submit"]');
  if (!nama || !isi) return;

  const lastSent = Number(localStorage.getItem('lastCommentAt') || 0);
  const elapsed = Date.now() - lastSent;
  if (elapsed < COMMENT_COOLDOWN_MS) {
    const sisaDetik = Math.ceil((COMMENT_COOLDOWN_MS - elapsed) / 1000);
    feedback.textContent = `Mohon tunggu ${sisaDetik} detik lagi sebelum mengirim komentar berikutnya.`;
    feedback.className = 'comment-feedback error';
    return;
  }

  submitBtn.disabled = true;
  try {
    await CommentAPI.add(currentPersonId, nama, isi);
    localStorage.setItem('lastCommentAt', String(Date.now()));
    feedback.textContent = 'Terima kasih, komentar kamu sudah terkirim ke admin.';
    feedback.className = 'comment-feedback success';
    document.getElementById('comment-form').reset();
    document.getElementById('comment-counter').textContent = '0/1000';
  } catch (err) {
    feedback.textContent = 'Gagal mengirim komentar. Coba lagi.';
    feedback.className = 'comment-feedback error';
  } finally {
    submitBtn.disabled = false;
  }
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
