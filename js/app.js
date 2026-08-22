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

// Terapkan background/wallpaper kustom (diatur admin lewat tab Setting) di
// belakang tampilan publik. Kalau admin unggah gambar, itu yang dipakai;
// kalau tidak, dipakai warna/gradasi dari palet; kalau belum diatur sama
// sekali, tampilan bawaan (CSS var(--bg)) dibiarkan seperti biasa.
function applyPublicBackground(settings) {
  const type = settings && settings.backgroundType;
  if (type === 'image' && settings.backgroundImage) {
    document.body.style.background = 'none';
    document.body.style.backgroundImage = `url(${settings.backgroundImage})`;
    document.body.classList.add('public-custom-bg');
  } else if (type === 'color' && settings.backgroundColor) {
    document.body.style.backgroundImage = 'none';
    document.body.style.background = settings.backgroundColor;
    document.body.classList.add('public-custom-bg');
  }
  // Kalau 'default'/belum diatur: tidak melakukan apa-apa, biarkan CSS bawaan.
}

async function init() {
  try {
    appSettings = await SettingsAPI.getAppSettings();
    document.getElementById('app-title').textContent = appSettings.judulAplikasi || 'Silsilah Keluarga';
    document.title = appSettings.judulAplikasi || 'Silsilah Keluarga';
    applyPublicBackground(appSettings);
  } catch (e) { appSettings = {}; /* pakai judul default jika gagal */ }

  await loadData();
  setupPanZoom();
  setupSearch();
  setupModal();
  setupLaporanModal();
  setupDashboardModal();
  setupJelajahModal();
  setupSubKeluargaReset();
  setupViewChooser();
  setupBirthdayModal();

  updateLayoutOffsets();
  window.addEventListener('resize', debouncedUpdateLayoutOffsets);
  window.addEventListener('orientationchange', debouncedUpdateLayoutOffsets);
}

// ---------- Ukur tinggi asli topbar & toolbar pencarian pohon ----------
// Dipakai oleh CSS (var(--topbar-h), var(--tree-toolbar-h)) supaya tinggi
// area pohon/empty-state & jarak aman di bawah toolbar selalu pas dengan
// tinggi topbar/toolbar yang SEBENARNYA -- bukan angka tetap. Ini penting
// terutama di HP: topbar bisa melebar jadi 2 baris (judul + tombol-tombol),
// dan toolbar pencarian pohon (kotak cari + tombol Perluas/Ciutkan) bisa
// melebar jadi beberapa baris juga -- kalau dipatok angka tetap, di layar
// sempit toolbar akan menutupi bagian atas pohon (lihat CSS media query
// max-width:640px). Dipanggil saat halaman dimuat & saat ukuran layar
// berubah (resize/putar HP).
function updateLayoutOffsets() {
  const root = document.documentElement;
  const topbar = document.querySelector('.topbar');
  if (topbar) root.style.setProperty('--topbar-h', topbar.offsetHeight + 'px');

  // Toolbar pencarian pohon hanya punya ukuran nyata (offsetHeight > 0)
  // ketika tree-view-section sedang terlihat (bukan display:none) -- kalau
  // section-nya masih tersembunyi (mis. layar pilihan awal belum dipilih),
  // biarkan nilai sebelumnya / fallback 0px dari CSS, nanti diukur ulang
  // begitu tampilan Pohon dipilih (lihat setupViewChooser()).
  const toolbar = document.querySelector('.tree-toolbar-float');
  const treeSection = document.getElementById('tree-view-section');
  if (toolbar && treeSection && treeSection.style.display !== 'none') {
    root.style.setProperty('--tree-toolbar-h', (toolbar.offsetHeight + 14) + 'px');
  }
}

let _layoutOffsetsTimer = null;
function debouncedUpdateLayoutOffsets() {
  clearTimeout(_layoutOffsetsTimer);
  _layoutOffsetsTimer = setTimeout(updateLayoutOffsets, 150);
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

  refreshBirthdayNotif();

  if (allPeople.length === 0) {
    document.getElementById('empty-state').style.display = 'flex';
    return;
  }
  // rootIds (pasangan utama, mis. [idDarsa, idKesi]) dipakai tree.js utk
  // menyembunyikan default akar keluarga lain yg tdk berkerabat (lihat
  // computeAlienRootIds di tree.js). Di tampilan publik ini sebetulnya
  // biasanya sudah tidak ada leluhur lain lagi (kalau rootPersonId diisi,
  // people/marriages di atas sudah disaring FamilyGraph ke 1 keluarga saja)
  // -- tapi tetap dikirim supaya perilakunya konsisten dgn tab admin, dan
  // tetap berguna kalau rootPersonId TIDAK diisi (tampilan publik memuat
  // semua keluarga sekaligus).
  const rootIds = RelationRules.findDefaultTreeRootIds(allPeople, allMarriages, appSettings.rootPersonId);
  renderTreeSVG(treeContainer, allPeople, allMarriages, openDetail, rootIds);

  // Halaman publik: sembunyikan SEMUA keturunan secara default saat pertama
  // dibuka, jadi yang tamu lihat pertama kali cuma leluhur paling atas
  // (mis. Bapak Darsa & Ibu Kesi) -- bukan seluruh pohon sekaligus yang
  // bisa terasa penuh/membingungkan. Tamu lalu klik lencana "+" pada kotak
  // seseorang utk membuka (unhide) keturunannya satu per satu, lengkap
  // dgn animasi fade singkat yang sudah ditangani oleh toggleTreeNode()
  // di tree.js. Ini TIDAK memengaruhi tampilan admin (admin punya
  // container SVG sendiri, statusnya disimpan terpisah per container).
  TreeControls.collapseAll(treeContainer);

  // v15: setelah diciutkan, geser viewport supaya kotak leluhur utama (mis.
  // Bapak Darsa & Ibu Kesi) langsung terlihat di tengah layar begitu pohon
  // dibuka -- bukan pojok kiri-atas kanvas apa adanya (lihat
  // RelationRules.findDefaultTreeFocusId() di db.js utk urutan prioritasnya).
  TreeControls.focusOn(treeContainer, RelationRules.findDefaultTreeFocusId(allPeople, allMarriages, appSettings.rootPersonId));
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

  const getTitle = () => appSettings.judulAplikasi;
  TreeExportAPI.attachButton('tree-download-jpg', treeContainer, getTitle, 'downloadJPG');
  TreeExportAPI.attachButton('tree-download-pdf-cetak', treeContainer, getTitle, 'downloadPDFCetak');
}

function setZoom(scale) {
  currentScale = Math.min(Math.max(scale, 0.4), 2.5);
  treeContainer.style.transform = `scale(${currentScale})`;
  treeContainer.style.transformOrigin = 'top left';
}

// ---------- Search ----------
// Kotak pencarian pohon punya 2 MODE, dipilih lewat filter <select>
// #tree-search-mode di sebelahnya:
//   - "all" (Seluruh Pohon): perilaku lama -- highlight semua kotak yang
//     namanya cocok di pohon yang SEDANG tampil, lalu scroll ke hasil
//     pertama (mis. sama persis dengan setupAdminTreeSearch() di admin.js).
//   - "sub" (Sub Keluarga): mengetik menampilkan daftar saran nama (mirip
//     modal Cari Sub Keluarga versi sebelumnya, cuma sekarang inline di
//     bawah kotak cari, tidak perlu buka modal terpisah). Klik salah satu
//     saran akan MEMPERSEMPIT pohon lewat TreeControls.buildSubFamily()
//     -- hanya pasangan orang itu, anak, menantu, dan cucunya saja (lihat
//     applySubFamily() di bawah).
function setupSearch() {
  const input = document.getElementById('tree-search');
  const modeSelect = document.getElementById('tree-search-mode');
  const suggestBox = document.getElementById('tree-search-suggest');
  const navBox = document.getElementById('tree-search-nav');
  const navCount = document.getElementById('tree-search-count');
  const navPrev = document.getElementById('tree-search-prev');
  const navNext = document.getElementById('tree-search-next');
  if (!input) return;

  function closeSuggest() {
    if (!suggestBox) return;
    suggestBox.style.display = 'none';
    suggestBox.innerHTML = '';
  }

  // v15: nama yang sama/kembar bisa cocok lebih dari satu orang -- semua
  // kotak yang cocok tetap di-highlight seperti dulu, tapi sekarang kita
  // juga simpan SELURUH daftar kecocokan (bukan cuma yang pertama) supaya
  // user bisa lompat antar hasil lewat tombol ‹ › / Enter, dibantu
  // penghitung "X dari Y hasil" di navBox.
  let currentMatches = [];
  let currentMatchIndex = 0;

  function updateNav() {
    if (!navBox) return;
    if (currentMatches.length > 0) {
      navBox.style.display = 'flex';
      if (navCount) navCount.textContent = `${currentMatchIndex + 1} dari ${currentMatches.length} hasil`;
    } else {
      navBox.style.display = 'none';
      if (navCount) navCount.textContent = '';
    }
  }

  function focusMatch(index) {
    if (!currentMatches.length) return;
    currentMatchIndex = ((index % currentMatches.length) + currentMatches.length) % currentMatches.length;
    const person = currentMatches[currentMatchIndex];
    document.querySelectorAll('#tree-container .tree-node.search-focus').forEach(n => n.classList.remove('search-focus'));
    const el = document.querySelector(`#tree-container .tree-node[data-id="${person.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      // Paksa reflow sblm nambah kelas supaya animasi glow selalu mulai
      // dr awal lagi, walau elemen yg sama sdh pernah kena glow ini
      // sebelumnya (mis. user masih mengetik nama yg sama tokohnya).
      void el.getBoundingClientRect();
      el.classList.add('search-focus');
    }
    updateNav();
  }

  function highlightWholeTree(q) {
    document.querySelectorAll('#tree-container .tree-node').forEach(node => {
      const id = node.dataset.id;
      const person = allPeople.find(p => p.id === id);
      const match = q && person && person.nama.toLowerCase().includes(q);
      node.classList.toggle('highlight', !!match);
      // Lepas glow lama dari SEMUA node dulu (bukan cuma dr hasil sebelumnya)
      // supaya saat pencarian diganti, node lama yg tak lagi relevan tidak
      // ikut menyala terus.
      node.classList.remove('search-focus');
    });
    currentMatches = q ? allPeople.filter(p => p.nama.toLowerCase().includes(q)) : [];
    currentMatchIndex = 0;
    if (currentMatches.length) {
      focusMatch(0);
    } else {
      updateNav();
    }
  }

  function showSubFamilySuggest(q) {
    if (!suggestBox) return;
    if (!q) { closeSuggest(); return; }
    const matches = allPeople.filter(p => p.nama.toLowerCase().includes(q)).slice(0, 8);
    suggestBox.innerHTML = matches.length
      ? matches.map(p => `
          <div class="tree-search-suggest-item" data-id="${p.id}">
            ${escapeHtml(p.nama)} <span class="tree-search-suggest-sub">(${escapeHtml(p.jenisKelamin || '-')}${escapeHtml(getPasanganLabelSuffix(p.id, allPeople, allMarriages))})</span>
          </div>
        `).join('')
      : '<div class="tree-search-suggest-empty">Tidak ditemukan.</div>';
    suggestBox.style.display = 'block';
    suggestBox.querySelectorAll('.tree-search-suggest-item').forEach(item => {
      // mousedown (bukan click) supaya sempat terpicu SEBELUM event blur
      // pada input menutup dropdown ini duluan.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applySubFamily(item.dataset.id);
        input.value = '';
        closeSuggest();
      });
    });
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const mode = modeSelect ? modeSelect.value : 'all';
    if (mode === 'sub') {
      showSubFamilySuggest(q);
    } else {
      closeSuggest();
      highlightWholeTree(q);
    }
  });

  // Enter (atau Shift+Enter utk mundur) melompat ke hasil berikutnya --
  // berguna saat nama yang sama muncul berkali-kali & user sudah tahu mau
  // cek satu-satu tanpa menyentuh mouse.
  input.addEventListener('keydown', (e) => {
    const mode = modeSelect ? modeSelect.value : 'all';
    if (mode === 'all' && e.key === 'Enter' && currentMatches.length) {
      e.preventDefault();
      focusMatch(currentMatchIndex + (e.shiftKey ? -1 : 1));
    }
  });

  if (navPrev) navPrev.addEventListener('click', () => focusMatch(currentMatchIndex - 1));
  if (navNext) navNext.addEventListener('click', () => focusMatch(currentMatchIndex + 1));

  input.addEventListener('blur', () => {
    // Ditunda sebentar supaya klik pada item saran (lihat mousedown di atas)
    // sempat terproses sebelum dropdown-nya ditutup oleh blur ini.
    setTimeout(closeSuggest, 150);
  });

  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      closeSuggest();
      input.value = '';
      if (modeSelect.value === 'all') {
        // Pindah dari mode Sub Keluarga -> Seluruh Pohon: kalau sebelumnya
        // sudah ada sub keluarga yg diterapkan, kembalikan dulu ke pohon
        // lengkap supaya konsisten dgn label filter yg sekarang dipilih.
        if (subFamilyPersonId) resetSubFamily(); else highlightWholeTree('');
      } else {
        // Pindah ke mode Sub Keluarga: bersihkan highlight pencarian
        // "Seluruh Pohon" sebelumnya supaya tidak nyangkut di kotak lama.
        highlightWholeTree('');
      }
      input.focus();
    });
  }
}

// ---------- Pilihan tampilan awal (Pohon vs Jelajah/Kartu) ----------
// Saat halaman publik pertama dibuka, tamu memilih dulu mau lihat silsilah
// dlm bentuk pohon (grafik lengkap, #tree-view-section) atau kartu/Jelajah
// (drill-down satu keluarga per layar, pakai modal Jelajah yang sudah ada).
// Kalau tamu memilih Jelajah dari layar ini lalu menutupnya (tombol X atau
// klik area luar), dikembalikan lagi ke layar pilihan ini -- bukan ke layar
// kosong -- supaya tamu bisa pilih ulang. Kalau Jelajah dibuka belakangan
// lewat tombol topbar (setelah salah satu tampilan sudah aktif), menutupnya
// cukup kembali ke tampilan yang sedang aktif seperti biasa.
let jelajahOpenedFromChooser = false;

function setupViewChooser() {
  const chooser = document.getElementById('view-chooser');
  const treeSection = document.getElementById('tree-view-section');
  const landingHint = document.getElementById('landing-hint');
  if (!chooser || !treeSection) return;

  document.getElementById('choose-tree').addEventListener('click', () => {
    chooser.style.display = 'none';
    if (landingHint) landingHint.style.display = 'none';
    treeSection.style.display = '';
    subFamilyPersonId = null;
    document.getElementById('subkeluarga-active-label').style.display = 'none';
    document.getElementById('btn-subkeluarga-reset').style.display = 'none';
    const modeSelectTree = document.getElementById('tree-search-mode');
    if (modeSelectTree) modeSelectTree.value = 'all';
    // Saat loadData() memanggil TreeControls.focusOn() tadi, tree-view-section
    // masih display:none sehingga scrollIntoView tidak berpengaruh apa-apa
    // (elemen belum punya ukuran/posisi). Panggil ulang sekarang setelah
    // section-nya benar-benar terlihat, supaya leluhur utama tetap langsung
    // ke tengah layar begitu tampilan Pohon dipilih.
    requestAnimationFrame(() => {
      updateLayoutOffsets(); // toolbar baru punya ukuran nyata setelah section ini terlihat
      TreeControls.focusOn(treeContainer, RelationRules.findDefaultTreeFocusId(allPeople, allMarriages, appSettings.rootPersonId));
    });
  });

  document.getElementById('choose-jelajah').addEventListener('click', () => {
    chooser.style.display = 'none';
    if (landingHint) landingHint.style.display = 'none';
    jelajahOpenedFromChooser = true;
    openJelajahModal();
  });

  // Tombol close bundar kecil di pojok kartu pilihan: tamu yang tidak mau
  // langsung pilih Pohon/Jelajah bisa menutup layar ini saja, supaya topbar
  // (Cari Data, Dashboard, Admin) -- yang tadinya tertutup penuh oleh overlay
  // pilihan ini -- jadi bisa dipakai langsung.
  const chooserClose = document.getElementById('chooser-close');
  if (chooserClose) {
    chooserClose.addEventListener('click', () => {
      chooser.style.display = 'none';
      if (landingHint) landingHint.style.display = 'flex';
    });
  }

  // Dari layar landing-hint, tamu masih bisa kembali membuka layar pilihan
  // Pohon/Jelajah kalau berubah pikiran.
  const landingShowChooser = document.getElementById('landing-show-chooser');
  if (landingShowChooser) {
    landingShowChooser.addEventListener('click', () => {
      if (landingHint) landingHint.style.display = 'none';
      chooser.style.display = 'flex';
    });
  }

  const btnSwitch = document.getElementById('btn-switch-view');
  if (btnSwitch) {
    btnSwitch.addEventListener('click', () => {
      document.getElementById('jelajah-modal').style.display = 'none';
      jelajahOpenedFromChooser = false;
      if (landingHint) landingHint.style.display = 'none';
      treeSection.style.display = 'none';
      subFamilyPersonId = null;
      document.getElementById('subkeluarga-active-label').style.display = 'none';
      document.getElementById('btn-subkeluarga-reset').style.display = 'none';
      const modeSelectSwitch = document.getElementById('tree-search-mode');
      if (modeSelectSwitch) modeSelectSwitch.value = 'all';
      chooser.style.display = 'flex';
    });
  }
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
  initCommentCaptcha();
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

// ---------- Notifikasi Ulang Tahun ----------
// Lonceng di topbar publik: menyala (badge + animasi) kalau ada anggota
// keluarga yang berulang tahun hari ini. Diklik -> tampil daftar nama, dan
// tiap nama bisa diklik lagi utk membuka detail biodatanya (modal yang sama
// dgn openDetail() yang sudah ada).
let birthdayTodayList = [];

function setupBirthdayModal() {
  document.getElementById('btn-notif-ultah').addEventListener('click', openBirthdayModal);
  document.getElementById('birthday-modal-close').addEventListener('click', closeBirthdayModal);
  document.getElementById('birthday-modal').addEventListener('click', e => {
    if (e.target.id === 'birthday-modal') closeBirthdayModal();
  });
}

// Dipanggil ulang tiap loadData() supaya badge selalu sesuai data terbaru.
function refreshBirthdayNotif() {
  birthdayTodayList = BirthdayUtil.getUlangTahunHariIni(allPeople);
  const btn = document.getElementById('btn-notif-ultah');
  const badge = document.getElementById('notif-ultah-badge');
  if (birthdayTodayList.length > 0) {
    badge.textContent = birthdayTodayList.length;
    badge.style.display = 'inline-block';
    btn.classList.add('has-birthday');
    btn.title = `${birthdayTodayList.length} orang berulang tahun hari ini`;
  } else {
    badge.style.display = 'none';
    btn.classList.remove('has-birthday');
    btn.title = 'Notifikasi Ulang Tahun';
  }
}

function openBirthdayModal() {
  const list = document.getElementById('birthday-list');
  if (birthdayTodayList.length === 0) {
    list.innerHTML = '<li class="empty-row-sm">Tidak ada anggota keluarga yang berulang tahun hari ini.</li>';
  } else {
    list.innerHTML = birthdayTodayList.map(({ person, umur }) => `
      <li class="dashboard-detail-row birthday-row" onclick="openBirthdayPerson('${person.id}')">
        <span class="dashboard-detail-nama">🎂 ${escapeHtml(person.nama)}</span>
        <span class="dashboard-detail-ket">${(umur !== null && umur >= 0) ? `Genap ${umur} tahun` : 'Ulang tahun hari ini'}</span>
      </li>
    `).join('');
  }
  document.getElementById('birthday-modal').style.display = 'flex';
}

function closeBirthdayModal() {
  document.getElementById('birthday-modal').style.display = 'none';
}

function openBirthdayPerson(personId) {
  closeBirthdayModal();
  openDetail(personId);
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

  setupKinshipChecker();
}

function openLaporanModal() {
  document.getElementById('laporan-modal').style.display = 'flex';
  document.getElementById('laporan-search').value = '';
  document.getElementById('laporan-search-results').innerHTML = '';
  document.getElementById('laporan-detail').style.display = 'none';
  laporanSelectedId = null;
  const kinshipSearch = document.getElementById('kinship-search');
  if (kinshipSearch) kinshipSearch.value = '';
  const kinshipResults = document.getElementById('kinship-search-results');
  if (kinshipResults) kinshipResults.innerHTML = '';
  const kinshipResult = document.getElementById('kinship-result');
  if (kinshipResult) kinshipResult.innerHTML = '';
}

// ---------- Cek Hubungan Kekerabatan (antar 2 orang) ----------
function setupKinshipChecker() {
  const input = document.getElementById('kinship-search');
  if (!input) return;
  input.addEventListener('input', () => renderKinshipSearchResults(input.value));
}

function renderKinshipSearchResults(query) {
  const box = document.getElementById('kinship-search-results');
  const q = query.trim().toLowerCase();
  if (!q) { box.innerHTML = ''; return; }

  const matches = allPeople
    .filter(p => p.id !== laporanSelectedId && p.nama.toLowerCase().includes(q))
    .slice(0, 8);
  box.innerHTML = matches.map(p => `
    <div class="relasi-result-item" onclick="selectKinshipPerson('${p.id}')">
      ${escapeHtml(p.nama)} <span class="relasi-result-sub">(${escapeHtml(p.jenisKelamin || '-')}${escapeHtml(getPasanganLabelSuffix(p.id, allPeople, allMarriages))})</span>
    </div>
  `).join('') || '<div class="relasi-result-empty">Tidak ditemukan.</div>';
}

function selectKinshipPerson(id) {
  const personA = allPeople.find(p => p.id === laporanSelectedId);
  const personB = allPeople.find(p => p.id === id);
  if (!personA || !personB) return;
  document.getElementById('kinship-search').value = '';
  document.getElementById('kinship-search-results').innerHTML = '';
  document.getElementById('kinship-result').innerHTML = KinshipView.buildResultHTML(personA, personB, allPeople, allMarriages);
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
      ${escapeHtml(p.nama)} <span class="relasi-result-sub">(${escapeHtml(p.jenisKelamin || '-')}${escapeHtml(getPasanganLabelSuffix(p.id, allPeople, allMarriages))})</span>
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

  // Anchor kekerabatan berganti -- kosongkan pencarian & hasil cek hubungan sebelumnya
  document.getElementById('kinship-search').value = '';
  document.getElementById('kinship-search-results').innerHTML = '';
  document.getElementById('kinship-result').innerHTML = '';
}

// ---------- Sub Keluarga (pohon dipersempit: pasangan + anak + cucu saja) ----------
// Berbeda dengan lencana ciut/lebar biasa (yang cuma menyembunyikan
// SEMENTARA, datanya tetap "ada" di baliknya dan bisa dibuka kapan saja),
// mode ini benar-benar MEMOTONG data sebelum digambar: pohon yang tampil
// jadi cuma pasangan yang dicari + anak + menantu + cucunya saja, tidak
// melebar ke leluhur di atasnya maupun ke buyut di bawah cucu. Cocok utk
// keluarga besar yang datanya banyak, supaya tamu bisa langsung fokus ke
// 1 keluarga inti tanpa harus meraba-raba klik lencana +/- satu-satu.
let subFamilyPersonId = null;

function setupSubKeluargaReset() {
  const btn = document.getElementById('btn-subkeluarga-reset');
  if (btn) btn.addEventListener('click', resetSubFamily);
}

function applySubFamily(personId) {
  const person = allPeople.find(p => p.id === personId);
  if (!person) return;

  const { subPeople, subMarriages, rootIds } = TreeControls.buildSubFamily(allPeople, allMarriages, personId);

  // Status ciut/lebar dari tampilan sebelumnya (pohon lengkap) dibuang dulu,
  // supaya di mode sub keluarga ini semuanya tampil terbuka penuh (memang
  // sudah sengaja dipersempit cuma sampai cucu, jadi tidak perlu diciutkan lagi).
  TreeControls.resetCollapse(treeContainer);
  renderTreeSVG(treeContainer, subPeople, subMarriages, openDetail, rootIds);

  subFamilyPersonId = personId;
  const label = document.getElementById('subkeluarga-active-label');
  if (label) {
    label.textContent = `👪 Sub keluarga: ${person.nama}`;
    label.style.display = '';
  }
  document.getElementById('btn-subkeluarga-reset').style.display = '';

  requestAnimationFrame(() => {
    updateLayoutOffsets();
    TreeControls.focusOn(treeContainer, rootIds[0] || personId);
  });
}

function resetSubFamily() {
  if (!subFamilyPersonId) return;
  subFamilyPersonId = null;

  TreeControls.resetCollapse(treeContainer);
  const rootIds = RelationRules.findDefaultTreeRootIds(allPeople, allMarriages, appSettings.rootPersonId);
  renderTreeSVG(treeContainer, allPeople, allMarriages, openDetail, rootIds);
  TreeControls.collapseAll(treeContainer);

  document.getElementById('subkeluarga-active-label').style.display = 'none';
  document.getElementById('btn-subkeluarga-reset').style.display = 'none';
  const modeSelect = document.getElementById('tree-search-mode');
  if (modeSelect) modeSelect.value = 'all';
  const searchInput = document.getElementById('tree-search');
  if (searchInput) searchInput.value = '';

  requestAnimationFrame(() => {
    updateLayoutOffsets();
    TreeControls.focusOn(treeContainer, RelationRules.findDefaultTreeFocusId(allPeople, allMarriages, appSettings.rootPersonId));
  });
}

// ---------- Modal Dashboard (ringkasan statistik) ----------
function setupDashboardModal() {
  document.getElementById('btn-dashboard').addEventListener('click', openDashboardModal);
  document.getElementById('dashboard-modal-close').addEventListener('click', closeDashboardModal);
  document.getElementById('dashboard-modal').addEventListener('click', e => {
    if (e.target.id === 'dashboard-modal') closeDashboardModal();
  });

  // Klik salah satu kartu -> tampilkan daftar nama di baliknya.
  document.getElementById('dashboard-content').addEventListener('click', e => {
    const card = e.target.closest('.dashboard-card-clickable');
    if (card) openDashboardDetail(card.dataset.key);
  });
  document.getElementById('dashboard-detail-close').addEventListener('click', closeDashboardDetail);
  document.getElementById('dashboard-detail-modal').addEventListener('click', e => {
    if (e.target.id === 'dashboard-detail-modal') closeDashboardDetail();
  });
  document.getElementById('dashboard-detail-search').addEventListener('input', searchDashboardDetailRows);
}

function openDashboardModal() {
  const stats = StatsAPI.computeBasicStats(allPeople, allMarriages);
  const cards = [
    { label: 'Total Orang', value: stats.totalOrang, icon: '👥', tone: 'blue', key: 'totalOrang' },
    { label: 'Total Keluarga / Pasangan', value: stats.totalKeluarga, icon: '💍', tone: 'green', key: 'totalKeluarga' },
    { label: 'Laki-laki', value: stats.laki, icon: '👨', tone: 'blue', key: 'laki' },
    { label: 'Perempuan', value: stats.perempuan, icon: '👩', tone: 'pink', key: 'perempuan' },
    { label: 'Anak Tercatat', value: stats.totalAnakTercatat, icon: '🧒', tone: 'green', key: 'totalAnakTercatat' },
    { label: 'Jumlah Generasi', value: stats.maxGenerasi, icon: '🌳', tone: 'blue', key: 'maxGenerasi' }
  ];
  document.getElementById('dashboard-content').innerHTML = DashboardView.buildCardsHTML(cards);
  document.getElementById('dashboard-modal').style.display = 'flex';
}

function closeDashboardModal() {
  document.getElementById('dashboard-modal').style.display = 'none';
}

// ---------- Modal Detail Dashboard (daftar nama di balik satu kartu) ----------
const DASHBOARD_DETAIL_PAGE_SIZE = 10;
let dashboardDetailRows = [];
let currentDashboardDetailPage = 1;

function openDashboardDetail(key) {
  const detail = StatsAPI.getDetail(key, allPeople, allMarriages);
  dashboardDetailRows = detail.rows;
  currentDashboardDetailPage = 1;
  document.getElementById('dashboard-detail-title').textContent = detail.title || 'Detail';
  document.getElementById('dashboard-detail-count').textContent = `${detail.rows.length} data`;
  const searchBox = document.getElementById('dashboard-detail-search');
  searchBox.value = '';
  searchBox.style.display = detail.rows.length > 8 ? 'block' : 'none';
  renderDashboardDetailRows();
  document.getElementById('dashboard-detail-modal').style.display = 'flex';
}

function searchDashboardDetailRows() {
  currentDashboardDetailPage = 1;
  renderDashboardDetailRows();
}

function renderDashboardDetailRows() {
  const q = (document.getElementById('dashboard-detail-search').value || '').trim().toLowerCase();
  const rows = q ? dashboardDetailRows.filter(r => (r.nama || '').toLowerCase().includes(q)) : dashboardDetailRows;

  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / DASHBOARD_DETAIL_PAGE_SIZE));
  if (currentDashboardDetailPage > totalPages) currentDashboardDetailPage = totalPages;
  if (currentDashboardDetailPage < 1) currentDashboardDetailPage = 1;
  const startIdx = (currentDashboardDetailPage - 1) * DASHBOARD_DETAIL_PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + DASHBOARD_DETAIL_PAGE_SIZE);

  document.getElementById('dashboard-detail-list').innerHTML = DashboardView.buildDetailListHTML(pageRows);
  renderDashboardDetailPagination(totalCount, totalPages);
}

function renderDashboardDetailPagination(totalCount, totalPages) {
  const container = document.getElementById('dashboard-detail-pagination');
  if (!container) return;
  if (totalCount === 0) { container.innerHTML = ''; return; }

  const startItem = (currentDashboardDetailPage - 1) * DASHBOARD_DETAIL_PAGE_SIZE + 1;
  const endItem = Math.min(currentDashboardDetailPage * DASHBOARD_DETAIL_PAGE_SIZE, totalCount);

  let pageButtons = '';
  for (let i = 1; i <= totalPages; i++) {
    pageButtons += `<button class="page-btn ${i === currentDashboardDetailPage ? 'active' : ''}" onclick="goToDashboardDetailPage(${i})">${i}</button>`;
  }

  container.innerHTML = `
    <div class="pagination-info">Menampilkan ${startItem}-${endItem} dari ${totalCount} data</div>
    ${totalPages > 1 ? `
    <div class="pagination-controls">
      <button class="page-btn" onclick="goToDashboardDetailPage(${currentDashboardDetailPage - 1})" ${currentDashboardDetailPage === 1 ? 'disabled' : ''}>&laquo;</button>
      ${pageButtons}
      <button class="page-btn" onclick="goToDashboardDetailPage(${currentDashboardDetailPage + 1})" ${currentDashboardDetailPage === totalPages ? 'disabled' : ''}>&raquo;</button>
    </div>` : ''}
  `;
}

function goToDashboardDetailPage(page) {
  currentDashboardDetailPage = page;
  renderDashboardDetailRows();
}

function closeDashboardDetail() {
  document.getElementById('dashboard-detail-modal').style.display = 'none';
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

// Apakah sesi Jelajah ini dimulai langsung dari 1 leluhur utama tetap (root
// disetel admin di Setting, dan tidak poligami) -- artinya kartu leluhur itu
// SENDIRI adalah "tampilan utama"/titik paling awal jalur ini, jadi tombol
// "Kembali" harus BERHENTI di situ (tidak boleh mundur lagi ke daftar pilih
// leluhur, karena tamu memang tidak pernah lewat daftar itu). Kalau false
// (root belum disetel / poligami / harus pilih dulu), titik paling awal
// jalurnya adalah daftar pilih leluhur (jelajahPath kosong).
let jelajahHasFixedRoot = false;

function setupJelajahModal() {
  const btnJelajah = document.getElementById('btn-jelajah');
  if (btnJelajah) btnJelajah.addEventListener('click', openJelajahModal);
  document.getElementById('jelajah-modal-close').addEventListener('click', closeJelajahModal);
  document.getElementById('jelajah-modal').addEventListener('click', e => {
    if (e.target.id === 'jelajah-modal') closeJelajahModal();
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
    jelajahHasFixedRoot = rootNodes.length === 1;
    jelajahPath = jelajahHasFixedRoot ? [rootNodes[0]] : [];
  } else {
    jelajahHasFixedRoot = false;
    jelajahPath = [];
  }
  jelajahShowChildren = false;
  renderJelajah();
  document.getElementById('jelajah-modal').style.display = 'flex';
}

function closeJelajahModal() {
  document.getElementById('jelajah-modal').style.display = 'none';
  if (jelajahOpenedFromChooser) {
    jelajahOpenedFromChooser = false;
    const chooser = document.getElementById('view-chooser');
    if (chooser) chooser.style.display = 'flex';
  }
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

// Titik paling awal jalur jelajah sekarang -- kalau sesi ini mulai dari
// leluhur utama tetap, titik awalnya adalah kartu leluhur itu sendiri
// (panjang jalur 1), bukan daftar pilih leluhur (panjang jalur 0).
function jelajahMinPathLen() {
  return jelajahHasFixedRoot ? 1 : 0;
}

function jelajahKembali() {
  // Sudah di kartu/panel paling awal (mis. leluhur utama) -- jangan mundur
  // lebih jauh lagi, supaya urutan "Kembali" berhenti persis di titik mulai
  // yang sama dengan urutan maju sebelumnya (kebalikan urutan kunjungan).
  if (jelajahPath.length <= jelajahMinPathLen()) return;
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
    ${jelajahPath.length > jelajahMinPathLen() ? `<div class="jelajah-back-row"><button class="btn-link" onclick="jelajahKembali()">&larr; Kembali</button></div>` : ''}
  `;
}

const COMMENT_COOLDOWN_MS = 15000; // jeda minimal 15 detik antar kirim komentar dari browser yang sama

// =====================================================================
// ANTI-SPAM FORM KOMENTAR PUBLIK -- v21.
// Sebelumnya form komentar hanya dijaga jeda 15 detik + batas panjang teks
// (di atas & di Firestore Rules) -- keduanya bisa dilewati bot sederhana
// yang langsung mengisi & submit tanpa mematuhi apapun di sisi klien.
// Ditambah 2 lapis proteksi murni sisi klien (aplikasi ini statis, tanpa
// server sendiri untuk verifikasi captcha pihak ketiga seperti reCAPTCHA):
//   1. Honeypot -- field #comment-website disembunyikan dari manusia lewat
//      CSS (.hp-field di style.css), tapi tetap ada di DOM sehingga bot
//      generik yang mengisi SEMUA field form biasanya ikut mengisinya.
//      Terisi = kiriman ditolak diam-diam (lihat submitComment()).
//   2. Captcha hitung sederhana + jeda minimum sebelum form boleh dikirim
//      (bot yang submit dalam hitungan milidetik setelah form muncul akan
//      tertahan di sini).
// Ini BUKAN proteksi sempurna terhadap penyerang yang menargetkan aplikasi
// ini secara manual -- tapi menahan mayoritas spam bot generik/asal-asalan
// yang jadi kasus paling umum di form publik tanpa login.
// =====================================================================
let commentCaptchaAnswer = null;
let commentFormOpenedAt = 0;
const COMMENT_MIN_FILL_MS = 2000; // form tidak boleh dikirim dlm 2 detik pertama sejak dibuka

function initCommentCaptcha() {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  commentCaptchaAnswer = a + b;
  commentFormOpenedAt = Date.now();
  const label = document.getElementById('comment-captcha-question');
  const input = document.getElementById('comment-captcha-answer');
  if (label) label.textContent = `Berapa ${a} + ${b}?`;
  if (input) input.value = '';
  const hp = document.getElementById('comment-website');
  if (hp) hp.value = '';
}

async function submitComment(e) {
  e.preventDefault();
  const nama = document.getElementById('comment-name').value.trim();
  const isi = document.getElementById('comment-text').value.trim();
  const feedback = document.getElementById('comment-feedback');
  const submitBtn = document.querySelector('#comment-form button[type="submit"]');
  if (!nama || !isi) return;

  // 1) Honeypot: field ini seharusnya SELALU kosong untuk pengguna asli
  // (disembunyikan lewat CSS). Kalau terisi, ini bot -- ditolak diam-diam
  // dengan pesan sukses palsu, supaya bot tidak "belajar" mendeteksi
  // penolakan & mencoba menghindarinya di percobaan berikutnya.
  const honeypot = document.getElementById('comment-website').value;
  if (honeypot) {
    feedback.textContent = 'Terima kasih, komentar kamu sudah terkirim ke admin.';
    feedback.className = 'comment-feedback success';
    document.getElementById('comment-form').reset();
    document.getElementById('comment-counter').textContent = '0/1000';
    initCommentCaptcha();
    return;
  }

  // 2) Jeda minimum sejak form dibuka -- bot yang mengisi & submit dalam
  // hitungan milidetik akan tertahan di sini (manusia butuh waktu membaca
  // & mengetik).
  if (Date.now() - commentFormOpenedAt < COMMENT_MIN_FILL_MS) {
    feedback.textContent = 'Mohon isi form dengan wajar sebelum mengirim.';
    feedback.className = 'comment-feedback error';
    return;
  }

  // 3) Captcha hitung sederhana.
  const captchaInput = document.getElementById('comment-captcha-answer');
  const captchaVal = Number(captchaInput.value);
  if (!captchaInput.value || captchaVal !== commentCaptchaAnswer) {
    feedback.textContent = 'Jawaban captcha salah, coba lagi.';
    feedback.className = 'comment-feedback error';
    initCommentCaptcha(); // soal baru supaya tidak bisa ditebak berulang dgn soal yg sama
    return;
  }

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
    initCommentCaptcha();
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
