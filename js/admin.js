// =====================================================================
// ADMIN.JS
// =====================================================================

let allPeople = [];
let allMarriages = [];
let editingPersonId = null;
let pendingFotoFile = null;
let relasiSelectedId = null;

const PEOPLE_PAGE_SIZE = 20;
let currentPeopleFilter = '';
let currentPeoplePage = 1;
let currentRelasiFilter = 'all'; // 'all' | 'sudah' | 'belum'
let selectedPersonIds = new Set();   // id orang yang dicentang di tab Data Orang
let currentFilteredPersonIds = [];   // semua id yang cocok dgn pencarian + filter (semua halaman)

const authScreen = document.getElementById('auth-screen');
const adminApp = document.getElementById('admin-app');

// ---------- PEMETAAN USERNAME -> EMAIL ----------
// Firebase Authentication (metode email/password) mengharuskan akun
// tersimpan dengan format email asli di baliknya -- tidak bisa diganti
// jadi username polos di sisi server. Supaya pengguna tetap bisa login
// cukup dengan mengetik "ajipranomo" (tanpa @, titik, dll), kita simpan
// pemetaan username -> email asli di sini, lalu diterjemahkan otomatis
// sebelum dikirim ke Firebase.
const USERNAME_TO_EMAIL = {
  'ajipranomo': 'ajidigitalcirebon@gmail.com'
};

function resolveLoginEmail(input) {
  const trimmed = input.trim();
  // Kalau yang diketik sudah berbentuk email (mengandung @), pakai apa adanya
  // -- supaya tetap fleksibel kalau suatu saat mau login pakai email asli juga.
  if (trimmed.includes('@')) return trimmed;
  const mapped = USERNAME_TO_EMAIL[trimmed.toLowerCase()];
  return mapped || trimmed;
}

// ---------- AUTH ----------
auth.onAuthStateChanged(async user => {
  if (user) {
    authScreen.style.display = 'none';
    adminApp.style.display = 'block';
    await bootAdmin();
  } else {
    adminApp.style.display = 'none';
    authScreen.style.display = 'flex';
    await setupAuthForm();
  }
});

async function setupAuthForm() {
  const isRegistered = await SettingsAPI.isAdminRegistered();
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const submitBtn = document.getElementById('auth-submit');
  const forgotBtn = document.getElementById('auth-forgot-btn');

  const emailInput = document.getElementById('auth-email');

  if (isRegistered) {
    title.textContent = 'Masuk Admin';
    subtitle.textContent = 'Masuk untuk mengelola data silsilah keluarga.';
    submitBtn.textContent = 'Masuk';
    emailInput.type = 'text';
    emailInput.placeholder = 'Username';
    // v14: link "Lupa kata sandi?" -- sebelumnya satu-satunya cara reset
    // password admin adalah lewat Firebase Console secara manual (perlu paham
    // Firebase), yang jadi titik gagal serius untuk pengguna awam. Firebase
    // Auth sudah punya fitur reset via email bawaan, tinggal dipanggil.
    forgotBtn.style.display = 'block';
  } else {
    title.textContent = 'Daftar sebagai Admin';
    subtitle.textContent = 'Belum ada admin terdaftar. Daftar sekali di sini — setelah ini, tidak bisa ada admin lain.';
    submitBtn.textContent = 'Daftar & Masuk';
    forgotBtn.style.display = 'none';
    emailInput.type = 'email';
    emailInput.placeholder = 'Email';
  }

  forgotBtn.onclick = async () => {
    const errorEl = document.getElementById('auth-error');
    const infoEl = document.getElementById('auth-info');
    errorEl.textContent = '';
    infoEl.textContent = '';
    const rawInput = document.getElementById('auth-email').value.trim();
    if (!rawInput) {
      errorEl.textContent = 'Isi dulu kolom Username di atas, lalu klik "Lupa kata sandi?" lagi.';
      return;
    }
    const email = resolveLoginEmail(rawInput);
    try {
      await auth.sendPasswordResetEmail(email);
      infoEl.textContent = `Link reset kata sandi sudah dikirim ke ${email}. Cek juga folder Spam/Promosi kalau tidak terlihat di kotak masuk.`;
    } catch (err) {
      errorEl.textContent = translateAuthError(err.code) || err.message;
    }
  };

  const form = document.getElementById('auth-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const rawInput = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = '';
    document.getElementById('auth-info').textContent = '';

    try {
      if (isRegistered) {
        const email = resolveLoginEmail(rawInput);
        await auth.signInWithEmailAndPassword(email, password);
        AuditLogAPI.log('login_admin', {});
      } else {
        const stillNotRegistered = !(await SettingsAPI.isAdminRegistered());
        if (!stillNotRegistered) {
          errorEl.textContent = 'Admin sudah terdaftar. Silakan masuk.';
          return;
        }
        await auth.createUserWithEmailAndPassword(rawInput, password);
        try {
          await SettingsAPI.markAdminRegistered(auth.currentUser.uid);
          AuditLogAPI.log('register_admin', {});
        } catch (settingErr) {
          // Ditolak oleh Firestore Rules -- artinya ada orang lain yang barusan
          // lebih dulu terdaftar sebagai admin (race condition). Akun auth yang
          // baru dibuat ini tidak berguna (tidak akan pernah lolos cek UID admin),
          // jadi keluarkan lagi dan beri tahu pengguna untuk login saja.
          await auth.signOut();
          errorEl.textContent = 'Admin sudah terdaftar oleh orang lain barusan. Silakan masuk (login).';
          return;
        }
      }
    } catch (err) {
      errorEl.textContent = translateAuthError(err.code) || err.message;
    }
  };
}

function translateAuthError(code) {
  const map = {
    'auth/wrong-password': 'Kata sandi salah.',
    'auth/user-not-found': 'Akun tidak ditemukan.',
    'auth/invalid-email': 'Format email tidak valid.',
    'auth/email-already-in-use': 'Email sudah terdaftar.',
    'auth/weak-password': 'Kata sandi minimal 6 karakter.',
    'auth/invalid-credential': 'Email atau kata sandi salah.',
    'auth/too-many-requests': 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.'
  };
  return map[code];
}

document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());

// ---------- BOOT ADMIN ----------
async function bootAdmin() {
  setupTabs();
  setupPersonModal();
  setupRelasiModal();
  setupLaporanTab();
  setupSettings();
  setupDownload();
  setupAdminTreeSearch();
  setupDashboardDetailModal();
  setupBirthdayModal();
  setupAdminViewSwitch();
  setupAuditLogTab();
  await refreshAll();
  await refreshCommentBadge();
  await refreshTrashBadge();
  await renderAdminDashboard();
}

// v15: supaya tab "Pohon Keluarga" admin juga default ciutkan & fokus ke
// leluhur utama (spt tampilan publik) TAPI cuma sekali saja per sesi login --
// kalau dipaksa ciutkan ulang tiap refreshAll() (dipanggil stlh hampir setiap
// aksi CRUD admin), cabang yang sedang admin buka utk kerja akan terus
// tertutup lagi tiap habis menyimpan sesuatu, yang justru mengganggu.
let adminTreeFocusApplied = false;

async function refreshAll() {
  [allPeople, allMarriages] = await Promise.all([PeopleAPI.getAll(), MarriageAPI.getAll()]);
  renderPeopleTable();
  const adminTreeContainer = document.getElementById('admin-tree-container');
  // Admin menampilkan SEMUA keluarga sekaligus (tdk difilter spt publik) --
  // rootIds dikirim supaya keluarga lain yg tdk berkerabat dgn pasangan
  // utama tersembunyi default & tidak merusak bentuk piramida (lihat
  // computeAlienRootIds di tree.js).
  const adminRootIds = RelationRules.findDefaultTreeRootIds(allPeople, allMarriages, cachedAppSettings.rootPersonId);
  renderTreeSVG(adminTreeContainer, allPeople, allMarriages, openEditPerson, adminRootIds);
  if (!adminTreeFocusApplied) {
    adminTreeFocusApplied = true;
    TreeControls.collapseAll(adminTreeContainer);
    TreeControls.focusOn(adminTreeContainer, RelationRules.findDefaultTreeFocusId(allPeople, allMarriages, cachedAppSettings.rootPersonId));
  }
  if (laporanSelectedId) renderLaporanDetail();
  refreshRootPersonSelectOptions();
  refreshBirthdayNotif();
}

// ---------- Notifikasi Ulang Tahun ----------
// Sama seperti versi publik (app.js): lonceng di topbar admin menyala kalau
// ada anggota keluarga yang berulang tahun hari ini. Klik nama pada daftar
// -> langsung membuka form edit orang tsb (openEditPerson), berguna kalau
// admin ingin sekalian melengkapi/mengecek datanya saat itu juga.
let birthdayTodayListAdmin = [];

function setupBirthdayModal() {
  document.getElementById('btn-notif-ultah').addEventListener('click', openBirthdayModal);
  document.getElementById('birthday-modal-close').addEventListener('click', closeBirthdayModal);
  document.getElementById('birthday-modal').addEventListener('click', e => {
    if (e.target.id === 'birthday-modal') closeBirthdayModal();
  });
}

function refreshBirthdayNotif() {
  birthdayTodayListAdmin = BirthdayUtil.getUlangTahunHariIni(allPeople);
  const btn = document.getElementById('btn-notif-ultah');
  const badge = document.getElementById('notif-ultah-badge');
  if (birthdayTodayListAdmin.length > 0) {
    badge.textContent = birthdayTodayListAdmin.length;
    badge.style.display = 'inline-block';
    btn.classList.add('has-birthday');
    btn.title = `${birthdayTodayListAdmin.length} orang berulang tahun hari ini`;
  } else {
    badge.style.display = 'none';
    btn.classList.remove('has-birthday');
    btn.title = 'Notifikasi Ulang Tahun';
  }
}

function openBirthdayModal() {
  const list = document.getElementById('birthday-list');
  if (birthdayTodayListAdmin.length === 0) {
    list.innerHTML = '<li class="empty-row-sm">Tidak ada anggota keluarga yang berulang tahun hari ini.</li>';
  } else {
    list.innerHTML = birthdayTodayListAdmin.map(({ person, umur }) => `
      <li class="dashboard-detail-row birthday-row" onclick="openBirthdayPersonAdmin('${person.id}')">
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

function openBirthdayPersonAdmin(personId) {
  closeBirthdayModal();
  document.querySelector('.nav-btn[data-tab="tab-orang"]').click();
  openEditPerson(personId);
}

// escapeHtml() sekarang didefinisikan sekali saja di db.js (v14) -- db.js selalu
// dimuat lebih dulu dari file ini (lihat urutan <script> di admin.html).

function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- TABS ----------
function setupTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-komentar') renderComments();
      if (btn.dataset.tab === 'tab-sampah') renderTrash();
      if (btn.dataset.tab === 'tab-dashboard') renderAdminDashboard();
      if (btn.dataset.tab === 'tab-log') renderAuditLog(true);
    });
  });
}

// ---------- Ganti Tampilan (Pohon Keluarga / Jelajah) ----------
// Dulu "Pohon Keluarga" & "Jelajah" adalah tab tersendiri di nav admin.
// Sekarang keduanya diakses lewat 1 tombol "Ganti Tampilan" di topbar
// (sama seperti tampilan publik) yang membuka overlay pilihan -- lalu
// menampilkan section tab-pohon/tab-jelajah yang sama seperti sebelumnya,
// hanya saja tidak lagi lewat nav-btn biasa.
function setupAdminViewSwitch() {
  const chooser = document.getElementById('admin-view-chooser');
  const btnSwitch = document.getElementById('btn-ganti-tampilan');
  if (!chooser || !btnSwitch) return;

  function showTabPanel(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
  }

  btnSwitch.addEventListener('click', () => { chooser.style.display = 'flex'; });

  document.getElementById('admin-chooser-close').addEventListener('click', () => {
    chooser.style.display = 'none';
  });
  chooser.addEventListener('click', e => {
    if (e.target.id === 'admin-view-chooser') chooser.style.display = 'none';
  });

  document.getElementById('admin-choose-tree').addEventListener('click', () => {
    chooser.style.display = 'none';
    showTabPanel('tab-pohon');
  });

  document.getElementById('admin-choose-jelajah').addEventListener('click', () => {
    chooser.style.display = 'none';
    showTabPanel('tab-jelajah');
    openAdminJelajah();
  });
}

// ======================================================================
// TAB 1: DATA ORANG (biodata saja, tanpa relasi)
// ======================================================================

// Apakah data orang ini sudah pernah disetting relasinya (sebagai pasangan,
// orang tua, atau anak pada pernikahan manapun)?
function hasRelasiSet(personId) {
  return allMarriages.some(m =>
    m.orangId1 === personId || m.orangId2 === personId || (m.childIds || []).includes(personId)
  );
}

function checkIconSVG() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="12" fill="#4F7CAC"/>
    <path d="M7 12.5l3 3 7-7" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function belumIconSVG() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="12" fill="#D97706"/>
    <path d="M12 7v6" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <circle cx="12" cy="16.5" r="1.3" fill="white"/>
  </svg>`;
}

function renderPeopleTable(filter = currentPeopleFilter) {
  currentPeopleFilter = filter;
  const tbody = document.getElementById('people-table-body');
  const q = filter.trim().toLowerCase();

  // Semua data yang cocok dengan pencarian nama saja (dipakai untuk hitung ringkasan)
  const searched = allPeople
    .filter(p => !q || p.nama.toLowerCase().includes(q))
    .sort((a, b) => a.nama.localeCompare(b.nama));

  const sudahCount = searched.filter(p => hasRelasiSet(p.id)).length;
  const belumCount = searched.length - sudahCount;

  // Terapkan filter status relasi di atas hasil pencarian nama
  const filtered = searched.filter(p => {
    if (currentRelasiFilter === 'sudah') return hasRelasiSet(p.id);
    if (currentRelasiFilter === 'belum') return !hasRelasiSet(p.id);
    return true;
  });

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PEOPLE_PAGE_SIZE));
  if (currentPeoplePage > totalPages) currentPeoplePage = totalPages;
  if (currentPeoplePage < 1) currentPeoplePage = 1;
  const startIdx = (currentPeoplePage - 1) * PEOPLE_PAGE_SIZE;
  const rows = filtered.slice(startIdx, startIdx + PEOPLE_PAGE_SIZE);

  // Simpan daftar id yang cocok dgn pencarian+filter saat ini (semua halaman) --
  // dipakai untuk fitur "pilih semua data" pada checkbox.
  currentFilteredPersonIds = filtered.map(p => p.id);
  // Buang seleksi id yang sudah tidak ada lagi di data (misal setelah dihapus)
  const validIds = new Set(allPeople.map(p => p.id));
  selectedPersonIds.forEach(id => { if (!validIds.has(id)) selectedPersonIds.delete(id); });

  tbody.innerHTML = rows.map(p => {
    const sudahRelasi = hasRelasiSet(p.id);
    const badge = sudahRelasi
      ? `<span class="relasi-check relasi-check-sudah" title="Sudah disetting relasi (pasangan/orang tua/anak)">${checkIconSVG()}</span>`
      : `<span class="relasi-check relasi-check-belum" title="Belum disetting relasi apapun">${belumIconSVG()}</span>`;
    const genderValid = RelationRules.hasValidGender(p);
    const genderCell = genderValid
      ? escapeHtml(p.jenisKelamin)
      : `<span class="gender-invalid" title="Jenis kelamin kosong/tidak baku -- orang ini TIDAK akan pernah terdeteksi sebagai ayah/ibu di manapun sampai ini diperbaiki lewat tombol Edit">${escapeHtml(p.jenisKelamin || '(kosong)')} ⚠️</span>`;
    const checked = selectedPersonIds.has(p.id) ? 'checked' : '';
    return `
    <tr class="${checked ? 'row-selected' : ''}">
      <td class="checkbox-cell"><input type="checkbox" class="row-select-checkbox" data-id="${p.id}" ${checked}></td>
      <td>${escapeHtml(p.nama)}${badge}</td>
      <td>${genderCell}</td>
      <td>${formatDate(p.tglLahir)}</td>
      <td>${formatDate(p.tglWafat)}</td>
      <td class="aksi-cell">
        <button class="btn-aksi btn-aksi-edit" onclick="openEditPerson('${p.id}')">Edit</button>
        <button class="btn-aksi btn-aksi-relasi" onclick="openRelasiModal('${p.id}')">Relasi</button>
        <button class="btn-aksi btn-aksi-hapus" onclick="deletePersonRow('${p.id}')">Hapus</button>
      </td>
    </tr>
  `;
  }).join('') || `<tr><td colspan="6" class="empty-row">${
    currentRelasiFilter === 'all' ? 'Belum ada data.' :
    currentRelasiFilter === 'sudah' ? 'Belum ada data yang sudah terelasi.' :
    'Semua data sudah terelasi. 🎉'
  }</td></tr>`;

  renderGenderInvalidWarning();
  renderPeoplePagination(totalCount, totalPages);
  renderRelasiFilterSummary(searched.length, sudahCount, belumCount);
  document.querySelectorAll('.row-select-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      toggleRowSelect(cb.dataset.id, cb.checked);
    });
  });
  syncSelectAllCheckbox();
  renderBulkActionBar();
}

// ----------------------------------------------------------------------
// Seleksi checkbox (bulk actions: edit / relasi / hapus)
// ----------------------------------------------------------------------

function toggleRowSelect(id, checked) {
  if (checked) selectedPersonIds.add(id); else selectedPersonIds.delete(id);
  const tr = document.querySelector(`.row-select-checkbox[data-id="${id}"]`)?.closest('tr');
  if (tr) tr.classList.toggle('row-selected', checked);
  syncSelectAllCheckbox();
  renderBulkActionBar();
}

function syncSelectAllCheckbox() {
  const headerCb = document.getElementById('select-all-checkbox');
  if (!headerCb) return;
  const rowCbs = Array.from(document.querySelectorAll('.row-select-checkbox'));
  if (rowCbs.length === 0) { headerCb.checked = false; headerCb.indeterminate = false; return; }
  const checkedCount = rowCbs.filter(cb => selectedPersonIds.has(cb.dataset.id)).length;
  headerCb.checked = checkedCount === rowCbs.length;
  headerCb.indeterminate = checkedCount > 0 && checkedCount < rowCbs.length;
}

// Klik checkbox di header tabel: pilih/batalkan semua baris yang TAMPIL di halaman ini.
function toggleSelectAllOnPage(checked) {
  document.querySelectorAll('.row-select-checkbox').forEach(cb => {
    cb.checked = checked;
    if (checked) selectedPersonIds.add(cb.dataset.id); else selectedPersonIds.delete(cb.dataset.id);
    cb.closest('tr')?.classList.toggle('row-selected', checked);
  });
  syncSelectAllCheckbox();
  renderBulkActionBar();
}

// Pilih SEMUA data hasil pencarian/filter saat ini (bukan cuma halaman yang tampil).
function selectAllFilteredPeople() {
  currentFilteredPersonIds.forEach(id => selectedPersonIds.add(id));
  renderPeopleTable();
}

function clearPeopleSelection() {
  selectedPersonIds.clear();
  renderPeopleTable();
}

function renderBulkActionBar() {
  const bar = document.getElementById('bulk-action-bar');
  if (!bar) return;
  const count = selectedPersonIds.size;
  const totalFiltered = currentFilteredPersonIds.length;

  if (count === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  document.getElementById('bulk-selected-count').textContent = `✅ ${count} dipilih`;

  const linkBtn = document.getElementById('bulk-select-all-filtered');
  if (count < totalFiltered) {
    linkBtn.textContent = `Pilih semua ${totalFiltered} data`;
    linkBtn.style.display = '';
  } else {
    linkBtn.textContent = '';
    linkBtn.style.display = 'none';
  }

  const btnEdit = document.getElementById('bulk-btn-edit');
  const btnRelasi = document.getElementById('bulk-btn-relasi');
  btnEdit.disabled = count !== 1;
  btnRelasi.disabled = count !== 1;
  btnEdit.title = count === 1 ? '' : 'Pilih tepat 1 data untuk Edit';
  btnRelasi.title = count === 1 ? '' : 'Pilih tepat 1 data untuk atur Relasi';
  btnEdit.style.opacity = count === 1 ? '1' : '0.5';
  btnRelasi.style.opacity = count === 1 ? '1' : '0.5';
  btnEdit.style.cursor = count === 1 ? 'pointer' : 'not-allowed';
  btnRelasi.style.cursor = count === 1 ? 'pointer' : 'not-allowed';
}

async function bulkDeleteSelected() {
  const ids = Array.from(selectedPersonIds);
  if (ids.length === 0) return;
  const names = allPeople.filter(p => ids.includes(p.id)).map(p => p.nama);
  const preview = names.slice(0, 8).join(', ') + (names.length > 8 ? `, dan ${names.length - 8} lainnya` : '');
  const ok = confirm(
    `Pindahkan ${ids.length} orang ke Sampah?\n\n${preview}\n\n` +
    `Data TIDAK langsung hilang -- bisa dipulihkan kapan saja lewat tab Sampah.`
  );
  if (!ok) return;
  for (const id of ids) {
    await PeopleAPI.delete(id);
  }
  AuditLogAPI.log('soft_delete_person', { label: `${ids.length} orang sekaligus`, detail: preview });
  selectedPersonIds.clear();
  await refreshAll();
  await refreshTrashBadge();
}

function renderGenderInvalidWarning() {
  const el = document.getElementById('gender-invalid-warning');
  if (!el) return;
  const bermasalah = allPeople.filter(p => !RelationRules.hasValidGender(p));
  if (bermasalah.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `⚠️ ${bermasalah.length} data punya jenis kelamin kosong/tidak baku
    (ditandai ⚠️ di kolom Jenis Kelamin) -- orang-orang ini tidak akan pernah
    terdeteksi sebagai ayah/ibu di pohon maupun laporan sampai diperbaiki lewat tombol Edit.`;
}

function renderRelasiFilterSummary(totalSearched, sudahCount, belumCount) {
  const el = document.getElementById('relasi-filter-summary');
  if (!el) return;
  el.innerHTML = `
    <button type="button" class="relasi-summary-chip relasi-summary-all ${currentRelasiFilter === 'all' ? 'active' : ''}" onclick="setRelasiFilter('all')">
      Semua <strong>${totalSearched}</strong>
    </button>
    <button type="button" class="relasi-summary-chip relasi-summary-sudah ${currentRelasiFilter === 'sudah' ? 'active' : ''}" onclick="setRelasiFilter('sudah')">
      ${checkIconSVG()} Sudah Terelasi <strong>${sudahCount}</strong>
    </button>
    <button type="button" class="relasi-summary-chip relasi-summary-belum ${currentRelasiFilter === 'belum' ? 'active' : ''}" onclick="setRelasiFilter('belum')">
      ${belumIconSVG()} Belum Terelasi <strong>${belumCount}</strong>
    </button>
  `;
}

function setRelasiFilter(value) {
  currentRelasiFilter = value;
  currentPeoplePage = 1;
  const selectEl = document.getElementById('admin-relasi-filter');
  if (selectEl) selectEl.value = value;
  renderPeopleTable();
}

function renderPeoplePagination(totalCount, totalPages) {
  const container = document.getElementById('people-pagination');
  if (!container) return;

  const startItem = totalCount === 0 ? 0 : (currentPeoplePage - 1) * PEOPLE_PAGE_SIZE + 1;
  const endItem = Math.min(currentPeoplePage * PEOPLE_PAGE_SIZE, totalCount);

  let pageButtons = '';
  for (let i = 1; i <= totalPages; i++) {
    pageButtons += `<button class="page-btn ${i === currentPeoplePage ? 'active' : ''}" onclick="goToPeoplePage(${i})">${i}</button>`;
  }

  container.innerHTML = `
    <div class="pagination-info">Menampilkan ${startItem}-${endItem} dari ${totalCount} data</div>
    ${totalPages > 1 ? `
    <div class="pagination-controls">
      <button class="page-btn" onclick="goToPeoplePage(${currentPeoplePage - 1})" ${currentPeoplePage === 1 ? 'disabled' : ''}>&laquo;</button>
      ${pageButtons}
      <button class="page-btn" onclick="goToPeoplePage(${currentPeoplePage + 1})" ${currentPeoplePage === totalPages ? 'disabled' : ''}>&raquo;</button>
    </div>` : ''}
  `;
}

function goToPeoplePage(page) {
  currentPeoplePage = page;
  renderPeopleTable();
}

// Hitung dampak penghapusan seseorang: berapa pernikahan & anak yang akan terdampak
function getDeleteImpact(personId) {
  const related = allMarriages.filter(m => m.orangId1 === personId || m.orangId2 === personId);
  const affectedChildIds = new Set(related.flatMap(m => m.childIds || []));
  return { marriageCount: related.length, childCount: affectedChildIds.size };
}

function buildDeleteConfirmMessage(person) {
  const { marriageCount, childCount } = getDeleteImpact(person.id);
  let dampak = 'Orang ini belum tercatat memiliki relasi apapun.';
  if (marriageCount > 0) {
    const parts = [];
    parts.push(`${marriageCount} data pernikahan terkait tidak akan tampil di pohon sementara ini`);
    if (childCount > 0) parts.push(`${childCount} anak akan tampak kehilangan relasi orang tua ini di pohon sementara ini`);
    dampak = parts.join(', ') + '.';
  }
  return `Pindahkan "${person.nama}" ke Sampah?\n\nDampak: ${dampak}\n\n` +
    `Data TIDAK langsung hilang -- bisa dipulihkan kapan saja lewat tab Sampah. ` +
    `Kalau memang ingin dihapus selamanya, itu dilakukan terpisah dari tab Sampah.`;
}

async function deletePersonRow(id) {
  const p = allPeople.find(x => x.id === id);
  if (!p) return;
  if (!confirm(buildDeleteConfirmMessage(p))) return;
  await PeopleAPI.delete(id);
  AuditLogAPI.log('soft_delete_person', { label: p.nama });
  await refreshAll();
  await refreshTrashBadge();
}

document.getElementById('admin-search').addEventListener('input', e => {
  currentPeoplePage = 1;
  renderPeopleTable(e.target.value);
});
document.getElementById('admin-relasi-filter').addEventListener('change', e => {
  setRelasiFilter(e.target.value);
});
document.getElementById('btn-add-person').addEventListener('click', () => openPersonForm(null));

document.getElementById('select-all-checkbox').addEventListener('change', e => {
  toggleSelectAllOnPage(e.target.checked);
});
document.getElementById('bulk-select-all-filtered').addEventListener('click', selectAllFilteredPeople);
document.getElementById('bulk-btn-clear').addEventListener('click', clearPeopleSelection);
document.getElementById('bulk-btn-hapus').addEventListener('click', bulkDeleteSelected);
document.getElementById('bulk-btn-edit').addEventListener('click', () => {
  if (selectedPersonIds.size !== 1) return;
  openEditPerson(Array.from(selectedPersonIds)[0]);
});
document.getElementById('bulk-btn-relasi').addEventListener('click', () => {
  if (selectedPersonIds.size !== 1) return;
  openRelasiModal(Array.from(selectedPersonIds)[0]);
});

function setupPersonModal() {
  document.getElementById('person-modal-close').addEventListener('click', closePersonForm);
  document.getElementById('person-form').addEventListener('submit', savePerson);
  document.getElementById('btn-delete-person').addEventListener('click', deleteCurrentPerson);
  document.getElementById('f-foto').addEventListener('change', handleFotoPreview);
  document.getElementById('f-nama').addEventListener('input', renderNamaSamaHint);
}

// Nama sama itu WAJAR (banyak keluarga sengaja memakai nama yang sama antar
// generasi/cabang), jadi ini BUKAN validasi yang memblokir atau minta
// konfirmasi -- cuma info pembanding (tanggal lahir, orang tua yang sudah
// tercatat) supaya admin sendiri yang menilai. Identitas sebenarnya tetap
// dibedakan lewat ID unik yang dikelola sistem, bukan lewat nama.
function renderNamaSamaHint() {
  const hintEl = document.getElementById('f-nama-duplicate-hint');
  if (!hintEl) return;
  const nama = document.getElementById('f-nama').value.trim().toLowerCase();
  if (!nama) { hintEl.innerHTML = ''; return; }

  const namesake = allPeople.filter(p =>
    p.id !== editingPersonId && p.nama && p.nama.trim().toLowerCase() === nama
  );
  if (namesake.length === 0) { hintEl.innerHTML = ''; return; }

  const items = namesake.map(p => {
    const { ayah, ibu } = RelationRules.getParents(p.id, allPeople, allMarriages);
    const ortu = [ayah && ayah.nama, ibu && ibu.nama].filter(Boolean).join(' & ');
    const rincian = [
      p.tglLahir ? `lahir ${formatDate(p.tglLahir)}` : null,
      ortu ? `anak dari ${ortu}` : null
    ].filter(Boolean).join(', ') || 'belum ada info pembeda (tanggal lahir/orang tua) tercatat';
    return `<li>${escapeHtml(p.nama)} -- ${escapeHtml(rincian)}</li>`;
  }).join('');

  hintEl.innerHTML = `
    <div class="nama-sama-hint">
      Sudah ada ${namesake.length} orang dengan nama sama di database. Ini normal kalau memang
      orang berbeda (sistem tetap membedakan lewat ID masing-masing) -- daftar berikut cuma
      bantuan supaya kamu bisa pastikan ini bukan data yang sama yang tidak sengaja diinput dua kali:
      <ul>${items}</ul>
    </div>`;
}

function openPersonForm(personId) {
  editingPersonId = personId;
  pendingFotoFile = null;

  const form = document.getElementById('person-form');
  form.reset();
  document.getElementById('f-foto-preview').style.display = 'none';
  document.getElementById('f-nama-duplicate-hint').innerHTML = '';
  document.getElementById('btn-delete-person').style.display = personId ? 'inline-block' : 'none';
  document.getElementById('person-form-title').textContent = personId ? 'Edit Orang' : 'Tambah Orang';

  if (personId) {
    const p = allPeople.find(x => x.id === personId);
    document.getElementById('f-nama').value = p.nama || '';
    document.getElementById('f-gender').value = p.jenisKelamin || '';
    document.getElementById('f-alias').value = p.alias || '';
    document.getElementById('f-tgl-lahir').value = p.tglLahir || '';
    document.getElementById('f-tgl-wafat').value = p.tglWafat || '';
    document.getElementById('f-tempat-lahir').value = p.tempatLahir || '';
    document.getElementById('f-agama').value = p.agama || '';
    document.getElementById('f-pekerjaan').value = p.pekerjaan || '';
    document.getElementById('f-alamat').value = p.alamat || '';
    document.getElementById('f-kontak').value = p.kontak || '';
    document.getElementById('f-catatan').value = p.catatan || '';
    if (p.fotoUrl) {
      const img = document.getElementById('f-foto-preview');
      img.src = p.fotoUrl; img.style.display = 'block';
    }
  }

  document.getElementById('person-modal').style.display = 'flex';
}

function openEditPerson(id) { openPersonForm(id); }

function closePersonForm() {
  document.getElementById('person-modal').style.display = 'none';
  editingPersonId = null;
}

const MAX_FOTO_SOURCE_MB = 15; // batas ukuran file ASLI sebelum dikompres (bukan hasil kompresi)
// v14: batas ukuran HASIL kompresi (base64) yang akan disimpan ke field fotoUrl.
// Firestore membatasi 1 dokumen ~1MB total; 700KB di sini menyisakan margin
// aman utk field biodata lain (nama, alamat, catatan, dll) di dokumen yang sama.
const MAX_FOTO_BASE64_BYTES = 700 * 1024;

function handleFotoPreview(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type || !file.type.startsWith('image/')) {
    alert('File yang dipilih bukan gambar. Pilih file berformat JPG, PNG, atau sejenisnya.');
    e.target.value = '';
    return;
  }
  if (file.size > MAX_FOTO_SOURCE_MB * 1024 * 1024) {
    alert(`Ukuran file terlalu besar (maks. ${MAX_FOTO_SOURCE_MB}MB sebelum dikompres). Pilih foto lain.`);
    e.target.value = '';
    return;
  }

  pendingFotoFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = document.getElementById('f-foto-preview');
    img.src = ev.target.result;
    img.style.display = 'block';
  };
  reader.onerror = () => {
    alert('Gagal membaca file gambar. Coba pilih file lain.');
    pendingFotoFile = null;
  };
  reader.readAsDataURL(file);
}

async function savePerson(e) {
  e.preventDefault();
  const data = {
    nama: document.getElementById('f-nama').value.trim(),
    jenisKelamin: document.getElementById('f-gender').value,
    alias: document.getElementById('f-alias').value.trim() || null,
    tglLahir: document.getElementById('f-tgl-lahir').value || null,
    tglWafat: document.getElementById('f-tgl-wafat').value || null,
    tempatLahir: document.getElementById('f-tempat-lahir').value.trim() || null,
    agama: document.getElementById('f-agama').value || null,
    pekerjaan: document.getElementById('f-pekerjaan').value.trim() || null,
    alamat: document.getElementById('f-alamat').value.trim() || null,
    kontak: document.getElementById('f-kontak').value.trim() || null,
    catatan: document.getElementById('f-catatan').value.trim() || null
  };

  if (!data.nama || !data.jenisKelamin) return;

  const wafatCheck = RelationRules.validateWafatDate(data.tglLahir, data.tglWafat);
  if (!wafatCheck.valid) {
    alert(wafatCheck.message);
    return;
  }

  // Kalau orang ini sudah punya ortu tercatat, pastikan tanggal lahir baru
  // (jika diubah) tetap masuk akal dibanding tanggal lahir ortu tersebut.
  if (editingPersonId && data.tglLahir) {
    const { ayah, ibu } = RelationRules.getParents(editingPersonId, allPeople, allMarriages);
    const childCheck = RelationRules.validateChildBirthDate(data.tglLahir, ayah, ibu);
    if (!childCheck.valid) {
      alert(childCheck.message);
      return;
    }
  }

  try {
    let personId = editingPersonId;
    if (personId) {
      await PeopleAPI.update(personId, data);
      AuditLogAPI.log('update_person', { label: data.nama });
    } else {
      personId = await PeopleAPI.add(data);
      AuditLogAPI.log('create_person', { label: data.nama });
    }

    if (pendingFotoFile) {
      const base64 = await compressImageToBase64(pendingFotoFile);
      // v14: Firestore membatasi 1 dokumen maksimal ~1MB (semua field
      // digabung). Foto sudah dikompres ke maxDim 300px, biasanya jauh di
      // bawah batas ini -- tapi utk jaga-jaga (foto sangat ramai detail/
      // noise yang susah dikompres), dicek dulu sebelum disimpan supaya
      // pengguna dapat pesan yang jelas, bukan error Firestore mentah.
      const approxBytes = Math.ceil(base64.length * 3 / 4);
      if (approxBytes > MAX_FOTO_BASE64_BYTES) {
        alert('Foto masih terlalu besar setelah dikompres otomatis (kemungkinan gambar sangat detail/ramai). ' +
          'Coba pilih foto lain, atau potong (crop) dulu jadi lebih sederhana/fokus ke wajah sebelum diunggah.\n\n' +
          'Data biodata lainnya sudah tersimpan; foto saja yang belum -- silakan Edit lagi untuk menambahkan foto.');
      } else {
        await PeopleAPI.update(personId, { fotoUrl: base64 });
      }
    }

    closePersonForm();
    await refreshAll();
  } catch (err) {
    alert('Gagal menyimpan data: ' + err.message);
  }
}

async function deleteCurrentPerson() {
  if (!editingPersonId) return;
  const p = allPeople.find(x => x.id === editingPersonId);
  if (!p) return;
  if (!confirm(buildDeleteConfirmMessage(p))) return;
  await PeopleAPI.delete(editingPersonId);
  AuditLogAPI.log('soft_delete_person', { label: p.nama });
  closePersonForm();
  await refreshAll();
  await refreshTrashBadge();
}

// ======================================================================
// MODAL RELASI KELUARGA (dibuka lewat tombol "Relasi" di Tab Data Orang)
// ======================================================================

// Widget dropdown pencarian (lihat js/searchable-select.js). Dibuat sekali
// saja di sini dan dipakai ulang tiap modal Relasi dibuka -- render ulang
// isinya cukup lewat .setOptions(), tidak perlu bikin ulang widgetnya.
let pasanganSelectWidget, ayahSelectWidget, ibuSelectWidget;

function setupRelasiModal() {
  document.getElementById('relasi-modal-close').addEventListener('click', closeRelasiModal);
  document.getElementById('relasi-btn-add-pasangan').addEventListener('click', addPasanganForSelected);
  document.getElementById('relasi-btn-save-ortu').addEventListener('click', saveOrtuForSelected);

  pasanganSelectWidget = new SearchableSelect(document.getElementById('relasi-select-pasangan'), {
    placeholder: 'Cari nama...',
    emptyOptionLabel: 'Pilih orang...'
  });
  ayahSelectWidget = new SearchableSelect(document.getElementById('relasi-select-ayah'), {
    placeholder: 'Cari nama ayah...',
    emptyOptionLabel: 'Tidak diketahui',
    // Begitu ayah dipilih/diganti, saring pilihan Ibu supaya cuma menampilkan
    // istri-istri yang SUDAH tercatat dari ayah tsb (kalau ada) -- lihat
    // applyOrtuCascade() untuk detail & alasan fallback-nya.
    onChange: () => applyOrtuCascade('ayah')
  });
  ibuSelectWidget = new SearchableSelect(document.getElementById('relasi-select-ibu'), {
    placeholder: 'Cari nama ibu...',
    emptyOptionLabel: 'Tidak diketahui',
    onChange: () => applyOrtuCascade('ibu')
  });
}

function openRelasiModal(id) {
  relasiSelectedId = id;
  renderRelasiDetail();
  document.getElementById('relasi-modal').style.display = 'flex';
}

function closeRelasiModal() {
  document.getElementById('relasi-modal').style.display = 'none';
  relasiSelectedId = null;
}

function renderRelasiDetail() {
  const person = allPeople.find(p => p.id === relasiSelectedId);
  if (!person) return;

  document.getElementById('relasi-selected-name').textContent = `${person.nama} (${person.jenisKelamin || '-'})`;

  renderPasanganSection(person);
  renderOrtuSection(person);
  renderAnakSection(person);
}

// ---------- Bagian Pasangan ----------
function renderPasanganSection(person) {
  const myMarriages = allMarriages
    .filter(m => m.orangId1 === person.id || m.orangId2 === person.id)
    .sort((a, b) => (a.urutanPasangan || 1) - (b.urutanPasangan || 1));
  const isPoly = myMarriages.length > 1;
  const listEl = document.getElementById('relasi-pasangan-list');
  listEl.innerHTML = myMarriages.map((m, idx) => {
    const partnerId = m.orangId1 === person.id ? m.orangId2 : m.orangId1;
    const partner = partnerId ? allPeople.find(p => p.id === partnerId) : null;
    const orderLabel = isPoly ? `<span class="chip-sub">ke-${idx + 1}</span>` : '';
    // Naik/turun urutan hanya berguna kalau ada >1 pasangan (poligami) --
    // untuk memperbaiki kasus mis. Dewi ternyata istri pertama tapi baru
    // diinput belakangan sehingga tersimpan sbg istri ke-2/3.
    const upBtn = isPoly && idx > 0
      ? `<button type="button" class="btn-reorder" title="Naikkan urutan" onclick="movePasanganUp('${person.id}','${m.id}')">&uarr;</button>` : '';
    const downBtn = isPoly && idx < myMarriages.length - 1
      ? `<button type="button" class="btn-reorder" title="Turunkan urutan" onclick="movePasanganDown('${person.id}','${m.id}')">&darr;</button>` : '';
    return `<div class="relation-chip">${orderLabel} ${escapeHtml(partner ? partner.nama : '(tidak diketahui)')}
      ${upBtn}${downBtn}
      <button type="button" onclick="removePasangan('${m.id}')">&times;</button></div>`;
  }).join('') || '<p class="empty-row-sm">Belum ada pasangan tercatat.</p>';

  const takenPartnerIds = new Set(myMarriages.map(m => m.orangId1 === person.id ? m.orangId2 : m.orangId1));
  const oppositeGender = person.jenisKelamin === 'Laki-laki' ? 'Perempuan' : 'Laki-laki';
  const candidates = allPeople.filter(p =>
    p.id !== person.id &&
    p.jenisKelamin === oppositeGender &&
    !takenPartnerIds.has(p.id) &&
    !RelationRules.isBloodRelated(person.id, p.id, allPeople, allMarriages)
  );

  pasanganSelectWidget.setOptions(candidates.map(p => ({ value: p.id, label: p.nama, sublabel: buildPersonPickerSublabel(p) })));
  pasanganSelectWidget.setValue('', true);

  const hiddenCount = allPeople.filter(p => p.id !== person.id && p.jenisKelamin === oppositeGender).length - candidates.length;
  document.getElementById('relasi-pasangan-note').textContent = hiddenCount > 0
    ? `${hiddenCount} orang disembunyikan dari pilihan karena hubungan darah atau sudah tercatat.`
    : '';
}

async function addPasanganForSelected() {
  const partnerId = pasanganSelectWidget.getValue();
  if (!partnerId || !relasiSelectedId) return;

  const person = allPeople.find(p => p.id === relasiSelectedId);
  const partner = allPeople.find(p => p.id === partnerId);
  const existingForPerson = allMarriages.filter(m => m.orangId1 === person.id || m.orangId2 === person.id).length;

  if (existingForPerson > 0) {
    const ok = confirm(`${person.nama} sudah tercatat memiliki pasangan sebelumnya. Tambahkan ${partner.nama} sebagai pasangan baru (poligami/menikah lagi)?`);
    if (!ok) return;
  }

  const isMale = person.jenisKelamin === 'Laki-laki';
  const ayahId = isMale ? person.id : partner.id;
  const ibuId = isMale ? partner.id : person.id;
  await MarriageAPI.findOrCreate(ayahId, ibuId, allMarriages);
  AuditLogAPI.log('add_pasangan', { label: `${person.nama} & ${partner.nama}` });

  await refreshRelasiData();
}

async function removePasangan(marriageId) {
  if (!confirm('Hapus relasi pasangan ini? Anak-anak dari pernikahan ini juga akan kehilangan relasi orang tua tersebut.')) return;
  const m = allMarriages.find(x => x.id === marriageId);
  const label = m ? [allPeople.find(p => p.id === m.orangId1), allPeople.find(p => p.id === m.orangId2)]
    .filter(Boolean).map(p => p.nama).join(' & ') : marriageId;
  await MarriageAPI.delete(marriageId);
  AuditLogAPI.log('remove_pasangan', { label });
  await refreshRelasiData();
}

// Naik/turunkan urutan istri/suami (mis. Dewi baru diketahui & diinput
// belakangan, padahal sebenarnya istri pertama). Menukar angka
// urutanPasangan dgn pernikahan tetangganya di urutan tampil saat ini.
function getSortedMarriagesOf(personId) {
  return allMarriages
    .filter(m => m.orangId1 === personId || m.orangId2 === personId)
    .sort((a, b) => (a.urutanPasangan || 1) - (b.urutanPasangan || 1));
}

async function movePasanganUp(personId, marriageId) {
  const sorted = getSortedMarriagesOf(personId);
  const idx = sorted.findIndex(m => m.id === marriageId);
  if (idx <= 0) return;
  const current = sorted[idx], prev = sorted[idx - 1];
  await MarriageAPI.swapUrutanPasangan(
    current.id, current.urutanPasangan || (idx + 1),
    prev.id, prev.urutanPasangan || idx
  );
  await refreshRelasiData();
}

async function movePasanganDown(personId, marriageId) {
  const sorted = getSortedMarriagesOf(personId);
  const idx = sorted.findIndex(m => m.id === marriageId);
  if (idx < 0 || idx >= sorted.length - 1) return;
  const current = sorted[idx], next = sorted[idx + 1];
  await MarriageAPI.swapUrutanPasangan(
    current.id, current.urutanPasangan || (idx + 1),
    next.id, next.urutanPasangan || (idx + 2)
  );
  await refreshRelasiData();
}

// ---------- Bagian Orang Tua ----------

// Kandidat dasar ayah/ibu untuk seseorang: jenis kelamin cocok, bukan diri
// sendiri, dan bukan leluhurnya sendiri (mencegah relasi melingkar).
function getOrtuCandidates(person) {
  const ayahCandidates = allPeople.filter(p =>
    p.jenisKelamin === 'Laki-laki' &&
    p.id !== person.id &&
    !RelationRules.isAncestor(person.id, p.id, allPeople, allMarriages)
  );
  const ibuCandidates = allPeople.filter(p =>
    p.jenisKelamin === 'Perempuan' &&
    p.id !== person.id &&
    !RelationRules.isAncestor(person.id, p.id, allPeople, allMarriages)
  );
  return { ayahCandidates, ibuCandidates };
}

// Pasangan (istri/suami) yang SUDAH tercatat menikah dengan seseorang lewat data pernikahan.
function getRecordedSpouseIds(personId) {
  return allMarriages
    .filter(m => m.orangId1 === personId || m.orangId2 === personId)
    .map(m => (m.orangId1 === personId ? m.orangId2 : m.orangId1))
    .filter(Boolean);
}

// Baris keterangan pembeda yang ditampilkan di bawah tiap nama pada dropdown
// pencarian orang (Pasangan/Ayah/Ibu di modal Relasi). Kalau ada beberapa
// orang dengan nama sama/mirip (mis. 2 orang bernama "Dewi"), admin bisa
// langsung melihat tanggal lahir, orang tua yang sudah tercatat, dan status
// pasangan (sudah/belum) tanpa perlu membuka data masing-masing orang dulu --
// supaya tidak salah pilih. Dipakai bersama notif ambiguitas nama di
// js/searchable-select.js (muncul otomatis begitu ketikan cocok dgn >1 orang).
//
// context:
//  - 'pasangan' (default) -- dipakai di picker Pasangan. Info lengkap,
//    termasuk status "sudah/belum berpasangan" karena di sini status itu
//    memang relevan (menentukan siapa yang masih bisa dipasangkan).
//  - 'ortu' -- dipakai di picker Ayah/Ibu. Status pasangan orang tersebut
//    TIDAK relevan untuk boleh/tidaknya dijadikan ayah/ibu (seseorang yang
//    sudah menikah tetap bisa dipilih sbg ortu), jadi disederhanakan jadi
//    "suami/istri dari <nama pasangan>" saja supaya tidak terkesan seperti
//    status "sudah berpasangan" itu jadi penghalang pemilihan.
function buildPersonPickerSublabel(person, context = 'pasangan') {
  const spouseNames = getRecordedSpouseIds(person.id)
    .map(id => allPeople.find(p => p.id === id))
    .filter(Boolean)
    .map(p => p.nama);

  if (context === 'ortu') {
    if (spouseNames.length === 0) return '';
    const sebutan = person.jenisKelamin === 'Perempuan' ? 'istri dari' : 'suami dari';
    return `${sebutan} ${spouseNames.join(', ')}`;
  }

  const parts = [];
  if (person.tglLahir) parts.push(`lahir ${formatDate(person.tglLahir)}`);

  const { ayah, ibu } = RelationRules.getParents(person.id, allPeople, allMarriages);
  const ortu = [ayah && ayah.nama, ibu && ibu.nama].filter(Boolean).join(' & ');
  if (ortu) parts.push(`anak dari ${ortu}`);

  parts.push(spouseNames.length > 0
    ? `sudah berpasangan dengan ${spouseNames.join(', ')}`
    : 'belum tercatat berpasangan');

  return parts.join(' \u00b7 ');
}

function renderOrtuSection(person) {
  const { ayah, ibu } = RelationRules.getParents(person.id, allPeople, allMarriages);
  const { ayahCandidates, ibuCandidates } = getOrtuCandidates(person);

  ayahSelectWidget.setOptions(ayahCandidates.map(p => ({ value: p.id, label: p.nama, sublabel: buildPersonPickerSublabel(p, 'ortu') })));
  ibuSelectWidget.setOptions(ibuCandidates.map(p => ({ value: p.id, label: p.nama, sublabel: buildPersonPickerSublabel(p, 'ortu') })));
  ayahSelectWidget.setValue(ayah ? ayah.id : '', true);
  ibuSelectWidget.setValue(ibu ? ibu.id : '', true);

  // Terapkan penyaringan "istri dari ayah yang dipilih" / "suami dari ibu
  // yang dipilih" begitu form dibuka juga -- bukan cuma saat admin mengganti
  // pilihan secara aktif -- supaya konsisten dengan data yang sudah ada.
  applyOrtuCascade('ayah', person);
  applyOrtuCascade('ibu', person);

  document.getElementById('relasi-ortu-note').textContent = '';
}

// Menyaring pilihan Ayah <-> Ibu supaya admin tidak perlu mencari manual di
// antara puluhan orang: kalau ayahnya poligami dan sudah tercatat 3 istri
// (mis. Ibu Muena, Ibu Samina, Ibu Roni), begitu ayah itu dipilih, dropdown
// Ibu otomatis HANYA menampilkan ke-3 istri tsb -- bukan semua perempuan di
// database. Berlaku juga sebaliknya (pilih ibu dulu -> dropdown ayah
// menyaring ke suami-suami ibu itu).
//
// Fallback: kalau orang yang dipilih itu BELUM tercatat py pasangan sama
// sekali (mis. pernikahan pertama yang datanya baru mulai diinput), dropdown
// lawannya tetap menampilkan SEMUA kandidat seperti biasa -- supaya tidak
// mentok jadi kosong.
//
// changedSide: 'ayah' = ayah baru dipilih/diganti -> saring opsi IBU.
//              'ibu'  = ibu baru dipilih/diganti  -> saring opsi AYAH.
function applyOrtuCascade(changedSide, personOverride) {
  const person = personOverride || allPeople.find(p => p.id === relasiSelectedId);
  if (!person) return;
  const { ayahCandidates, ibuCandidates } = getOrtuCandidates(person);

  if (changedSide === 'ayah') {
    const ayahId = ayahSelectWidget.getValue();
    let options = ibuCandidates;
    if (ayahId) {
      const wivesIds = new Set(getRecordedSpouseIds(ayahId));
      const wivesOnly = ibuCandidates.filter(p => wivesIds.has(p.id));
      if (wivesOnly.length > 0) options = wivesOnly;
    }
    ibuSelectWidget.setOptions(options.map(p => ({ value: p.id, label: p.nama, sublabel: buildPersonPickerSublabel(p, 'ortu') })));
  } else {
    const ibuId = ibuSelectWidget.getValue();
    let options = ayahCandidates;
    if (ibuId) {
      const husbandsIds = new Set(getRecordedSpouseIds(ibuId));
      const husbandsOnly = ayahCandidates.filter(p => husbandsIds.has(p.id));
      if (husbandsOnly.length > 0) options = husbandsOnly;
    }
    ayahSelectWidget.setOptions(options.map(p => ({ value: p.id, label: p.nama, sublabel: buildPersonPickerSublabel(p, 'ortu') })));
  }
}

async function saveOrtuForSelected() {
  const person = allPeople.find(p => p.id === relasiSelectedId);
  const ayahId = ayahSelectWidget.getValue() || null;
  const ibuId = ibuSelectWidget.getValue() || null;
  const noteEl = document.getElementById('relasi-ortu-note');
  noteEl.className = 'relasi-note';

  const { ayah: currentAyah, ibu: currentIbu } = RelationRules.getParents(person.id, allPeople, allMarriages);
  const changed = (currentAyah?.id || null) !== ayahId || (currentIbu?.id || null) !== ibuId;

  if (!changed) { noteEl.textContent = 'Tidak ada perubahan.'; return; }

  if (currentAyah || currentIbu) {
    const ok = confirm(`${person.nama} sudah tercatat sebagai anak dari ${currentAyah ? currentAyah.nama : '?'} & ${currentIbu ? currentIbu.nama : '?'}. Yakin ingin mengubahnya?`);
    if (!ok) return;
  }

  const ayahPerson = ayahId ? allPeople.find(p => p.id === ayahId) : null;
  const ibuPerson = ibuId ? allPeople.find(p => p.id === ibuId) : null;
  const dateCheck = RelationRules.validateChildBirthDate(person.tglLahir, ayahPerson, ibuPerson);
  if (!dateCheck.valid) {
    noteEl.textContent = dateCheck.message;
    noteEl.className = 'relasi-note relasi-note-error';
    return;
  }

  // Cek hubungan darah antara ayah & ibu yang dipilih -- jalur "Tambah Pasangan"
  // sudah otomatis menyembunyikan kandidat yang berhubungan darah, tapi jalur
  // dropdown ortu ini terpisah sehingga perlu dicek ulang di sini juga.
  if (ayahId && ibuId && RelationRules.isBloodRelated(ayahId, ibuId, allPeople, allMarriages)) {
    noteEl.textContent = `${ayahPerson.nama} dan ${ibuPerson.nama} terdeteksi memiliki hubungan darah langsung (ortu/anak/saudara). Periksa kembali data sebelum melanjutkan.`;
    noteEl.className = 'relasi-note relasi-note-error';
    const ok = confirm(`${ayahPerson.nama} dan ${ibuPerson.nama} terdeteksi berhubungan darah langsung. Tetap simpan sebagai pasangan ortu dari ${person.nama}?`);
    if (!ok) return;
  }

  const hasOtherSpouseAyah = ayahId && allMarriages.some(m => m.orangId1 === ayahId || m.orangId2 === ayahId);
  const hasOtherSpouseIbu = ibuId && allMarriages.some(m => m.orangId1 === ibuId || m.orangId2 === ibuId);
  const existingMarriage = MarriageAPI.findBetween(allMarriages, ayahId, ibuId);
  if (!existingMarriage && (hasOtherSpouseAyah || hasOtherSpouseIbu) && ayahId && ibuId) {
    const who = hasOtherSpouseAyah ? ayahPerson.nama : ibuPerson.nama;
    const ok = confirm(`${who} sudah tercatat menikah dengan orang lain sebelumnya. Simpan ini sebagai pernikahan baru (poligami/menikah lagi)?`);
    if (!ok) return;
  }

  await MarriageAPI.setParents(person.id, ayahId, ibuId, allMarriages);
  AuditLogAPI.log('set_ortu', {
    label: person.nama,
    detail: `Ayah: ${ayahPerson ? ayahPerson.nama : '-'}, Ibu: ${ibuPerson ? ibuPerson.nama : '-'}`
  });
  await refreshRelasiData();
  const noteEl2 = document.getElementById('relasi-ortu-note');
  noteEl2.textContent = 'Berhasil disimpan.';
  noteEl2.className = 'relasi-note relasi-note-success';
}

// ---------- Bagian Anak (read-only) ----------
function renderAnakSection(person) {
  // Dikelompokkan per pernikahan (bukan digabung semua) -- urutan anak
  // (childIds) memang tersimpan per pernikahan, jadi naik/turun & urutkan
  // otomatis juga harus beroperasi per pernikahan, bukan lintas pernikahan.
  const myMarriages = allMarriages
    .filter(m => (m.orangId1 === person.id || m.orangId2 === person.id) && (m.childIds || []).length > 0)
    .sort((a, b) => (a.urutanPasangan || 1) - (b.urutanPasangan || 1));
  const listEl = document.getElementById('relasi-anak-list');

  if (myMarriages.length === 0) {
    listEl.textContent = 'Belum ada anak tercatat.';
    return;
  }

  const isPoly = myMarriages.length > 1;
  listEl.innerHTML = myMarriages.map(m => {
    const partnerId = m.orangId1 === person.id ? m.orangId2 : m.orangId1;
    const partner = partnerId ? allPeople.find(p => p.id === partnerId) : null;
    const groupLabel = isPoly
      ? `<p class="relasi-anak-group-label">Dari pernikahan dengan ${escapeHtml(partner ? partner.nama : '(tidak diketahui)')}:</p>`
      : '';

    const childIds = m.childIds || [];
    const allHaveTgl = childIds.length > 1 && childIds.every(cid => {
      const c = allPeople.find(p => p.id === cid);
      return c && c.tglLahir;
    });
    const sortBtn = childIds.length > 1
      ? `<button type="button" class="btn-link" style="font-size:12px;margin:4px 0 6px" onclick="autoSortAnakByTglLahir('${m.id}')" ${allHaveTgl ? '' : 'disabled title="Isi Tanggal Lahir semua anak di pernikahan ini dulu"'}>Urutkan otomatis berdasarkan Tanggal Lahir</button><br>`
      : '';

    const chips = childIds.map((cid, idx) => {
      const c = allPeople.find(p => p.id === cid);
      const nama = c ? c.nama : '(tidak ditemukan)';
      const upBtn = idx > 0
        ? `<button type="button" class="btn-reorder" title="Naikkan urutan" onclick="moveAnakUp('${m.id}','${cid}')">&uarr;</button>` : '';
      const downBtn = idx < childIds.length - 1
        ? `<button type="button" class="btn-reorder" title="Turunkan urutan" onclick="moveAnakDown('${m.id}','${cid}')">&darr;</button>` : '';
      return `<span class="relation-chip"><span class="chip-sub">${idx + 1}.</span> ${escapeHtml(nama)} ${upBtn}${downBtn}</span>`;
    }).join(' ');

    return `<div class="relasi-anak-group">${groupLabel}${sortBtn}${chips}</div>`;
  }).join('');
}

function moveAnakUp(marriageId, childId) {
  return reorderAnak(marriageId, childId, -1);
}
function moveAnakDown(marriageId, childId) {
  return reorderAnak(marriageId, childId, 1);
}

async function reorderAnak(marriageId, childId, direction) {
  const m = allMarriages.find(x => x.id === marriageId);
  if (!m) return;
  const ids = [...(m.childIds || [])];
  const idx = ids.indexOf(childId);
  const swapWith = idx + direction;
  if (idx < 0 || swapWith < 0 || swapWith >= ids.length) return;
  [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
  await MarriageAPI.setChildOrder(marriageId, ids);
  await refreshRelasiData();
}

// Urutkan childIds satu pernikahan berdasarkan Tanggal Lahir (hanya bisa
// dipanggil kalau semua anak di pernikahan itu sudah punya Tanggal Lahir --
// lihat pengecekan `allHaveTgl` di renderAnakSection).
async function autoSortAnakByTglLahir(marriageId) {
  const m = allMarriages.find(x => x.id === marriageId);
  if (!m) return;
  const ids = [...(m.childIds || [])];
  const withDates = ids.map(cid => ({ id: cid, tgl: (allPeople.find(p => p.id === cid) || {}).tglLahir }));
  if (withDates.some(x => !x.tgl)) return; // jaga-jaga kalau tombol somehow ke-klik saat tidak lengkap
  withDates.sort((a, b) => new Date(a.tgl) - new Date(b.tgl));
  await MarriageAPI.setChildOrder(marriageId, withDates.map(x => x.id));
  await refreshRelasiData();
}

async function refreshRelasiData() {
  [allPeople, allMarriages] = await Promise.all([PeopleAPI.getAll(), MarriageAPI.getAll()]);
  renderPeopleTable();
  const relasiRootIds = RelationRules.findDefaultTreeRootIds(allPeople, allMarriages, cachedAppSettings.rootPersonId);
  renderTreeSVG(document.getElementById('admin-tree-container'), allPeople, allMarriages, openEditPerson, relasiRootIds);
  if (relasiSelectedId) renderRelasiDetail();
  if (laporanSelectedId) renderLaporanDetail();
}

// ======================================================================
// TAB: LAPORAN (narasi hubungan otomatis)
// ======================================================================

let laporanSelectedId = null;

function setupLaporanTab() {
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
      ${escapeHtml(p.nama)} <span class="relasi-result-sub">(${escapeHtml(p.jenisKelamin || '-')})</span>
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
  renderLaporanDetail();
}

function renderLaporanDetail() {
  const person = allPeople.find(p => p.id === laporanSelectedId);
  if (!person) return;

  const genInfo = RelationRules.getGenerationInfo(laporanSelectedId, allPeople, allMarriages);
  document.getElementById('laporan-biodata-card').innerHTML = BiodataView.buildFolioHTML(person, genInfo);

  const lines = RelationRules.generateNarrative(laporanSelectedId, allPeople, allMarriages);
  const listEl = document.getElementById('laporan-narrative-list');
  listEl.innerHTML = lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') || '<li>Belum ada informasi relasi yang bisa ditampilkan.</li>';

  // Anchor kekerabatan berganti -- kosongkan pencarian & hasil cek hubungan sebelumnya
  const kinshipSearch = document.getElementById('kinship-search');
  if (kinshipSearch) kinshipSearch.value = '';
  const kinshipResults = document.getElementById('kinship-search-results');
  if (kinshipResults) kinshipResults.innerHTML = '';
  const kinshipResult = document.getElementById('kinship-result');
  if (kinshipResult) kinshipResult.innerHTML = '';
}

// ======================================================================
// KOMENTAR
// ======================================================================

async function refreshCommentBadge() {
  const count = await CommentAPI.getUnreadCount();
  const badge = document.getElementById('badge-komentar');
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function renderComments() {
  const comments = await CommentAPI.getAll();
  const container = document.getElementById('comment-list');

  if (comments.length === 0) {
    container.innerHTML = '<p class="empty-row">Belum ada komentar masuk.</p>';
    return;
  }

  container.innerHTML = comments.map(c => {
    const person = allPeople.find(p => p.id === c.orangId);
    const waktu = c.waktuKirim && c.waktuKirim.toDate ? c.waktuKirim.toDate().toLocaleString('id-ID') : '';
    return `
      <div class="comment-card ${c.sudahDibaca ? '' : 'unread'}">
        <div class="comment-card-header">
          <strong>${escapeHtml(c.namaPengirim)}</strong>
          <span class="comment-card-target">tentang ${escapeHtml(person ? person.nama : 'data tidak ditemukan')}</span>
        </div>
        <p class="comment-card-text">${escapeHtml(c.isiKomentar)}</p>
        <div class="comment-card-footer">
          <span class="comment-card-time">${waktu}</span>
          <div>
            ${!c.sudahDibaca ? `<button class="btn-link" onclick="markCommentRead('${c.id}')">Tandai Dibaca</button>` : ''}
            <button class="btn-link btn-link-danger" onclick="deleteComment('${c.id}')">Hapus</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function markCommentRead(id) {
  await CommentAPI.markRead(id);
  await renderComments();
  await refreshCommentBadge();
}

async function deleteComment(id) {
  if (!confirm('Hapus komentar ini?')) return;
  await CommentAPI.delete(id);
  AuditLogAPI.log('delete_comment', {});
  await renderComments();
  await refreshCommentBadge();
}

// ======================================================================
// TAB: SAMPAH (orang yang di-soft-delete, bisa dipulihkan atau dihapus permanen)
// ======================================================================

async function refreshTrashBadge() {
  const trash = await PeopleAPI.getTrash();
  const badge = document.getElementById('badge-sampah');
  if (!badge) return;
  if (trash.length > 0) {
    badge.textContent = trash.length;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function renderTrash() {
  const container = document.getElementById('trash-list');
  if (!container) return;
  const trash = await PeopleAPI.getTrash();

  if (trash.length === 0) {
    container.innerHTML = '<p class="empty-row">Sampah kosong.</p>';
    return;
  }

  trash.sort((a, b) => (b.deletedAt?.toMillis ? b.deletedAt.toMillis() : 0) - (a.deletedAt?.toMillis ? a.deletedAt.toMillis() : 0));

  container.innerHTML = trash.map(p => {
    const waktu = p.deletedAt && p.deletedAt.toDate ? p.deletedAt.toDate().toLocaleString('id-ID') : '-';
    return `
      <div class="comment-card">
        <div class="comment-card-header">
          <strong>${escapeHtml(p.nama)}</strong>
          <span class="comment-card-target">${escapeHtml(p.jenisKelamin || '-')}</span>
        </div>
        <p class="comment-card-text">Dipindahkan ke sampah: ${waktu}</p>
        <div class="comment-card-footer">
          <span></span>
          <div>
            <button class="btn-link" onclick="restorePersonRow('${p.id}')">Pulihkan</button>
            <button class="btn-link btn-link-danger" onclick="hardDeletePersonRow('${p.id}')">Hapus Permanen</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function restorePersonRow(id) {
  const trash = await PeopleAPI.getTrash();
  const p = trash.find(x => x.id === id);
  await PeopleAPI.restore(id);
  AuditLogAPI.log('restore_person', { label: p ? p.nama : id });
  await refreshAll();
  await renderTrash();
  await refreshTrashBadge();
}

async function hardDeletePersonRow(id) {
  const trash = await PeopleAPI.getTrash();
  const p = trash.find(x => x.id === id);
  const nama = p ? p.nama : 'orang ini';
  const ok = confirm(
    `Hapus "${nama}" secara PERMANEN?\n\n` +
    `Ini akan sungguh-sungguh menghapus data beserta seluruh rujukan relasi ` +
    `(pernikahan yang melibatkannya) dari database. TIDAK BISA DIPULIHKAN LAGI ` +
    `setelah ini -- kecuali kamu punya file backup JSON yang diunduh sebelumnya.`
  );
  if (!ok) return;
  await PeopleAPI.hardDelete(id);
  AuditLogAPI.log('hard_delete_person', { label: nama });
  await refreshAll();
  await renderTrash();
  await refreshTrashBadge();
}

// ======================================================================
// TAB: LOG AKTIVITAS (audit log)
// ======================================================================

// Peta kode aksi (dicatat apa adanya di Firestore lewat AuditLogAPI.log())
// -> teks & ikon yang mudah dibaca admin. Dipisah dari kode aksi supaya
// teks tampilan bisa diubah/diterjemahkan kapan saja tanpa mengubah data
// yang sudah tersimpan di riwayat lama.
const AUDIT_ACTION_LABELS = {
  login_admin: { icon: '🔑', text: 'Login admin' },
  register_admin: { icon: '🔑', text: 'Pendaftaran admin pertama' },
  change_password: { icon: '🔑', text: 'Mengubah kata sandi admin' },
  create_person: { icon: '➕', text: 'Menambah data orang' },
  update_person: { icon: '✏️', text: 'Mengubah data orang' },
  soft_delete_person: { icon: '🗑️', text: 'Memindahkan orang ke Sampah' },
  restore_person: { icon: '♻️', text: 'Memulihkan orang dari Sampah' },
  hard_delete_person: { icon: '❌', text: 'Menghapus orang secara permanen' },
  add_pasangan: { icon: '💍', text: 'Menambah relasi pasangan' },
  remove_pasangan: { icon: '💔', text: 'Menghapus relasi pasangan' },
  set_ortu: { icon: '👪', text: 'Mengatur relasi orang tua' },
  delete_comment: { icon: '🗑️', text: 'Menghapus komentar' },
  update_settings: { icon: '⚙️', text: 'Mengubah pengaturan aplikasi' },
  update_background: { icon: '🎨', text: 'Mengubah background tampilan publik' },
  import_json: { icon: '📥', text: 'Impor/restore data dari backup JSON' },
  import_gedcom: { icon: '📥', text: 'Impor data dari file GEDCOM' }
};

function auditLogActionMeta(action) {
  return AUDIT_ACTION_LABELS[action] || { icon: '•', text: action };
}

let auditLogCursor = null;
let auditLogHasMore = false;
let auditLogItems = [];

function setupAuditLogTab() {
  const btnMore = document.getElementById('btn-auditlog-more');
  if (btnMore) btnMore.addEventListener('click', () => renderAuditLog(false));

  const btnCleanup = document.getElementById('btn-auditlog-cleanup');
  if (btnCleanup) btnCleanup.addEventListener('click', async () => {
    const ok = confirm(
      'Hapus semua entri Log Aktivitas yang lebih lama dari 90 hari?\n\n' +
      'Ini hanya membersihkan riwayat log lama untuk kerapian/menghemat kuota -- ' +
      'TIDAK mempengaruhi data orang/pernikahan/pengaturan yang sesungguhnya, dan tidak bisa dibatalkan.'
    );
    if (!ok) return;
    const feedback = document.getElementById('auditlog-feedback');
    feedback.textContent = 'Sedang membersihkan...';
    feedback.className = 'comment-feedback';
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const count = await AuditLogAPI.deleteOlderThan(cutoff);
      feedback.textContent = count > 0
        ? `Berhasil menghapus ${count} entri log lama.`
        : 'Tidak ada entri log yang lebih lama dari 90 hari.';
      feedback.className = 'comment-feedback success';
      await renderAuditLog(true);
    } catch (err) {
      feedback.textContent = 'Gagal membersihkan log: ' + err.message;
      feedback.className = 'comment-feedback error';
    }
  });
}

async function renderAuditLog(reset) {
  const listEl = document.getElementById('auditlog-list');
  const btnMore = document.getElementById('btn-auditlog-more');
  if (!listEl) return;

  if (reset) {
    auditLogItems = [];
    auditLogCursor = null;
    listEl.innerHTML = '<p class="empty-row">Memuat...</p>';
  }

  try {
    const { items, lastDoc, hasMore } = await AuditLogAPI.getPage(auditLogCursor);
    auditLogItems = reset ? items : auditLogItems.concat(items);
    auditLogCursor = lastDoc;
    auditLogHasMore = hasMore;
  } catch (err) {
    listEl.innerHTML = `<p class="empty-row">Gagal memuat log aktivitas: ${escapeHtml(err.message)}</p>`;
    return;
  }

  if (auditLogItems.length === 0) {
    listEl.innerHTML = '<p class="empty-row">Belum ada aktivitas tercatat.</p>';
    if (btnMore) btnMore.style.display = 'none';
    return;
  }

  listEl.innerHTML = auditLogItems.map(entry => {
    const meta = auditLogActionMeta(entry.action);
    const waktu = entry.waktu && entry.waktu.toDate ? entry.waktu.toDate().toLocaleString('id-ID') : '(baru saja)';
    const siapa = entry.adminEmail || '(tidak diketahui)';
    return `
      <div class="comment-card">
        <div class="comment-card-header">
          <strong>${meta.icon} ${escapeHtml(meta.text)}</strong>
          ${entry.label ? `<span class="comment-card-target">${escapeHtml(entry.label)}</span>` : ''}
        </div>
        ${entry.detail ? `<p class="comment-card-text">${escapeHtml(entry.detail)}</p>` : ''}
        <div class="comment-card-footer">
          <span class="comment-card-time">${escapeHtml(siapa)} &middot; ${waktu}</span>
          <span></span>
        </div>
      </div>`;
  }).join('');

  if (btnMore) btnMore.style.display = auditLogHasMore ? 'inline-block' : 'none';
}

// ======================================================================
// TAB: DASHBOARD
// ======================================================================

async function renderAdminDashboard() {
  const contentEl = document.getElementById('admin-dashboard-content');
  const recentEl = document.getElementById('admin-dashboard-recent');
  if (!contentEl) return;

  const stats = StatsAPI.computeBasicStats(allPeople, allMarriages);
  const [unreadComments, trash] = await Promise.all([
    CommentAPI.getUnreadCount().catch(() => 0),
    PeopleAPI.getTrash().catch(() => [])
  ]);

  const cards = [
    { label: 'Total Orang', value: stats.totalOrang, icon: '👥', tone: 'blue', key: 'totalOrang' },
    { label: 'Total Keluarga / Pasangan', value: stats.totalKeluarga, icon: '💍', tone: 'green', key: 'totalKeluarga' },
    { label: 'Laki-laki', value: stats.laki, icon: '👨', tone: 'blue', key: 'laki' },
    { label: 'Perempuan', value: stats.perempuan, icon: '👩', tone: 'pink', key: 'perempuan' },
    { label: 'Anak Tercatat', value: stats.totalAnakTercatat, icon: '🧒', tone: 'green', key: 'totalAnakTercatat' },
    { label: 'Jumlah Generasi', value: stats.maxGenerasi, icon: '🌳', tone: 'blue', key: 'maxGenerasi' },
    { label: 'Keluarga Poligami', value: stats.totalPoligami, icon: '🔀', tone: 'green', key: 'totalPoligami' },
    { label: 'Komentar Belum Dibaca', value: unreadComments, icon: '💬', tone: unreadComments > 0 ? 'amber' : 'blue', key: 'komentarBelumDibaca' },
    { label: 'Belum Ada Relasi', value: stats.belumTerelasi, icon: '⚠️', tone: stats.belumTerelasi > 0 ? 'amber' : 'blue', key: 'belumTerelasi' },
    { label: 'Jenis Kelamin Bermasalah', value: stats.genderInvalid, icon: '⚠️', tone: stats.genderInvalid > 0 ? 'amber' : 'blue', key: 'genderInvalid' },
    { label: 'Belum Ada Foto', value: stats.tanpaFoto, icon: '🖼️', tone: 'blue', key: 'tanpaFoto' },
    { label: 'Belum Ada Tanggal Lahir', value: stats.tanpaTglLahir, icon: '📅', tone: 'blue', key: 'tanpaTglLahir' },
    { label: 'Data di Sampah', value: trash.length, icon: '🗑️', tone: trash.length > 0 ? 'amber' : 'blue', key: 'dataSampah' }
  ];
  contentEl.innerHTML = DashboardView.buildCardsHTML(cards);

  if (recentEl) {
    const recent = [...allPeople]
      .filter(p => p.createdAt && p.createdAt.toMillis)
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
      .slice(0, 5);
    recentEl.innerHTML = recent.length
      ? recent.map(p => `
        <div class="dashboard-recent-row">
          <span class="dashboard-recent-name">${escapeHtml(p.nama)}</span>
          <span class="dashboard-recent-sub">${escapeHtml(p.jenisKelamin || '-')} &middot; ${p.createdAt.toDate().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>`).join('')
      : '<p class="empty-row-sm">Belum ada data.</p>';
  }
}

// ---------- Modal Detail Dashboard (daftar nama di balik satu kartu) ----------
const DASHBOARD_DETAIL_PAGE_SIZE = 10;
let dashboardDetailRows = [];
let currentDashboardDetailPage = 1;

function setupDashboardDetailModal() {
  // #admin-dashboard-content sendiri tidak pernah diganti (cuma isinya lewat
  // innerHTML tiap renderAdminDashboard), jadi delegasi klik di sini aman
  // dipasang sekali saja saat boot.
  document.getElementById('admin-dashboard-content').addEventListener('click', e => {
    const card = e.target.closest('.dashboard-card-clickable');
    if (card) openDashboardDetail(card.dataset.key);
  });
  document.getElementById('dashboard-detail-close').addEventListener('click', closeDashboardDetail);
  document.getElementById('dashboard-detail-modal').addEventListener('click', e => {
    if (e.target.id === 'dashboard-detail-modal') closeDashboardDetail();
  });
  document.getElementById('dashboard-detail-search').addEventListener('input', searchDashboardDetailRows);
}

// Kartu "Komentar Belum Dibaca" & "Data di Sampah" datanya bukan dari
// allPeople/allMarriages (beda koleksi Firestore), jadi diambil terpisah
// di sini -- kartu lainnya cukup lewat StatsAPI.getDetail().
async function openDashboardDetail(key) {
  let title = '', rows = [];

  if (key === 'komentarBelumDibaca') {
    const peopleMap = new Map(allPeople.map(p => [p.id, p]));
    const semuaKomentar = await CommentAPI.getAll().catch(() => []);
    title = 'Komentar Belum Dibaca';
    rows = semuaKomentar
      .filter(c => !c.sudahDibaca)
      .map(c => ({
        nama: c.namaPengirim || '(tanpa nama)',
        ket: `untuk ${peopleMap.get(c.orangId)?.nama || 'orang tidak diketahui'}`
      }));
  } else if (key === 'dataSampah') {
    const trash = await PeopleAPI.getTrash().catch(() => []);
    title = 'Data di Sampah';
    rows = trash.map(p => ({ nama: p.nama, ket: p.jenisKelamin || '-' }));
  } else {
    const detail = StatsAPI.getDetail(key, allPeople, allMarriages);
    title = detail.title;
    rows = detail.rows;
  }

  dashboardDetailRows = rows;
  currentDashboardDetailPage = 1;
  document.getElementById('dashboard-detail-title').textContent = title || 'Detail';
  document.getElementById('dashboard-detail-count').textContent = `${rows.length} data`;
  const searchBox = document.getElementById('dashboard-detail-search');
  searchBox.value = '';
  searchBox.style.display = rows.length > 8 ? 'block' : 'none';
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

// ======================================================================
// SETTINGS
// ======================================================================

let rootPersonSelectWidget = null;
let cachedAppSettings = {};

function setupSettings() {
  SettingsAPI.getAppSettings().then(s => {
    cachedAppSettings = s || {};
    document.getElementById('setting-title').value = cachedAppSettings.judulAplikasi || 'Silsilah Keluarga';
    refreshRootPersonSelectOptions();
    renderBackgroundPreview();
  });

  setupBackgroundSettings();

  document.getElementById('btn-save-title').addEventListener('click', async () => {
    const title = document.getElementById('setting-title').value.trim() || 'Silsilah Keluarga';
    await SettingsAPI.updateAppSettings({ judulAplikasi: title });
    AuditLogAPI.log('update_settings', { label: 'Judul aplikasi', detail: title });
    showSettingFeedback('Judul aplikasi disimpan.');
  });

  rootPersonSelectWidget = new SearchableSelect(document.getElementById('setting-root-person-select'), {
    placeholder: 'Cari nama...',
    emptyOptionLabel: 'Tampilkan semua keluarga (default)'
  });

  document.getElementById('btn-save-root-person').addEventListener('click', async () => {
    const rootPersonId = rootPersonSelectWidget.getValue() || null;
    await SettingsAPI.updateAppSettings({ rootPersonId });
    cachedAppSettings.rootPersonId = rootPersonId;
    const rootPersonNama = rootPersonId ? (allPeople.find(p => p.id === rootPersonId) || {}).nama : null;
    AuditLogAPI.log('update_settings', {
      label: 'Keluarga Utama untuk Tampilan Publik',
      detail: rootPersonNama || '(dikosongkan -- tampilkan semua keluarga)'
    });
    showSettingFeedback(rootPersonId
      ? 'Keluarga utama untuk tampilan publik disimpan. Tampilan publik sekarang hanya menampilkan keluarga ini.'
      : 'Pembatasan keluarga utama dihapus -- tampilan publik akan menampilkan semua keluarga lagi.');
  });

  document.getElementById('btn-change-pass').addEventListener('click', async () => {
    const newPass = document.getElementById('setting-newpass').value;
    if (!newPass || newPass.length < 6) {
      showSettingFeedback('Kata sandi minimal 6 karakter.', true);
      return;
    }
    try {
      await auth.currentUser.updatePassword(newPass);
      document.getElementById('setting-newpass').value = '';
      // Catatan: hanya AKSInya yang dicatat -- kata sandi baru itu sendiri
      // TIDAK PERNAH ditulis ke log aktivitas dengan alasan apapun.
      AuditLogAPI.log('change_password', {});
      showSettingFeedback('Kata sandi berhasil diubah.');
    } catch (err) {
      showSettingFeedback('Gagal ubah kata sandi: ' + err.message, true);
    }
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    // v14: sekarang ikut menyertakan settings/app (judul aplikasi & rootPersonId
    // "Keluarga Utama") -- sebelumnya backup TIDAK menyimpan ini, jadi kalau
    // suatu saat perlu restore ke project Firebase baru, pengaturan ini hilang
    // dan harus diset ulang manual. settings/admin (UID admin) SENGAJA tidak
    // diekspor -- itu bukan data keluarga & tidak relevan dipulihkan mentah.
    const [people, marriages, comments, settings] = await Promise.all([
      PeopleAPI.getAll(), MarriageAPI.getAll(), CommentAPI.getAll(), SettingsAPI.getAppSettings()
    ]);
    const blob = new Blob([JSON.stringify({ people, marriages, comments, settings }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-silsilah-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const importInput = document.getElementById('import-file-input');
  document.getElementById('btn-import').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', handleImportFile);

  document.getElementById('btn-export-gedcom').addEventListener('click', async () => {
    const btn = document.getElementById('btn-export-gedcom');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Menyiapkan...';
    try {
      const [people, marriages] = await Promise.all([PeopleAPI.getAll(), MarriageAPI.getAll()]);
      const text = GedcomAPI.toText(people, marriages);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `silsilah-${new Date().toISOString().slice(0, 10)}.ged`;
      a.click();
      URL.revokeObjectURL(url);
      showGedcomFeedback(`Berhasil mengekspor ${people.length} orang & ${marriages.length} pernikahan ke file GEDCOM.`);
    } catch (err) {
      showGedcomFeedback('Gagal mengekspor GEDCOM: ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  const importGedcomInput = document.getElementById('import-gedcom-input');
  document.getElementById('btn-import-gedcom').addEventListener('click', () => importGedcomInput.click());
  importGedcomInput.addEventListener('change', handleImportGedcomFile);
}

async function handleImportGedcomFile(e) {
  const file = e.target.files[0];
  e.target.value = ''; // supaya bisa pilih file yang sama lagi kalau perlu
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (err) {
    showGedcomFeedback('Gagal membaca file.', true);
    return;
  }

  let parsed;
  try {
    parsed = GedcomAPI.parse(text);
  } catch (err) {
    showGedcomFeedback('File GEDCOM tidak valid atau gagal diparse: ' + err.message, true);
    return;
  }

  const { indis, fams } = parsed;
  if (indis.length === 0) {
    showGedcomFeedback('File ini tidak berisi data orang (INDI) yang bisa dibaca. Pastikan ini file GEDCOM (.ged) yang valid.', true);
    return;
  }

  const genderKosong = indis.filter(p => !p.jenisKelamin).length;
  const catatanGender = genderKosong > 0
    ? `\n\n⚠️ ${genderKosong} dari data orang di file ini tidak punya jenis kelamin yang terbaca (field SEX kosong/bukan M atau F) -- mereka tidak akan terdeteksi sebagai ayah/ibu sampai diperbaiki manual lewat Edit setelah impor.`
    : '';

  const ok = confirm(
    `File ini berisi ${indis.length} data orang dan ${fams.length} data keluarga (pernikahan).\n\n` +
    `Semua akan ditambahkan sebagai data BARU (tidak menimpa data yang sudah ada di database). ` +
    `Kalau ada kemungkinan sebagian orang ini sudah tercatat sebelumnya, akan ada data ganda -- cek & gabungkan manual lewat tab Data Orang setelah ini. Proses ini tidak bisa dibatalkan.` +
    catatanGender +
    `\n\nLanjutkan impor sekarang?`
  );
  if (!ok) return;

  showGedcomFeedback('Sedang mengimpor data, mohon tunggu...');
  try {
    const result = await GedcomAPI.importToFirestore(indis, fams);
    AuditLogAPI.log('import_gedcom', {
      label: file.name,
      detail: `${result.peopleCount} orang, ${result.marriageCount} pernikahan`
    });
    await refreshAll();
    await refreshCommentBadge();
    showGedcomFeedback(`Berhasil mengimpor ${result.peopleCount} orang & ${result.marriageCount} pernikahan dari file GEDCOM.`);
  } catch (err) {
    showGedcomFeedback('Gagal mengimpor GEDCOM: ' + err.message, true);
  }
}

function showGedcomFeedback(msg, isError = false) {
  const el = document.getElementById('gedcom-feedback');
  el.textContent = msg;
  el.className = 'comment-feedback ' + (isError ? 'error' : 'success');
}

// ======================================================================
// SETTINGS -- Background/wallpaper tampilan publik
// ======================================================================

const MAX_BG_SOURCE_MB = 15; // batas ukuran file ASLI sebelum dikompres
// Batas ukuran HASIL kompresi (base64) yang disimpan ke field backgroundImage
// di dokumen settings/app -- sama alasannya dgn MAX_FOTO_BASE64_BYTES: doc
// Firestore dibatasi ~1MB, jadi 700KB menyisakan margin aman.
const MAX_BG_BASE64_BYTES = 700 * 1024;

function setupBackgroundSettings() {
  const grid = document.getElementById('bg-palette-grid');
  grid.innerHTML = BackgroundPalettes.map((p, i) => `
    <button type="button" class="bg-palette-swatch" data-idx="${i}" title="${escapeHtml(p.name)}"
      style="background:${p.value}"></button>
  `).join('');
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.bg-palette-swatch');
    if (!btn) return;
    const palette = BackgroundPalettes[Number(btn.dataset.idx)];
    try {
      await SettingsAPI.updateAppSettings({
        backgroundType: 'color',
        backgroundColor: palette.value,
        backgroundImage: firebase.firestore.FieldValue.delete()
      });
      cachedAppSettings.backgroundType = 'color';
      cachedAppSettings.backgroundColor = palette.value;
      delete cachedAppSettings.backgroundImage;
      renderBackgroundPreview();
      AuditLogAPI.log('update_background', { label: `Warna: ${palette.name}` });
      showBgFeedback(`Background diganti ke warna "${palette.name}".`);
    } catch (err) {
      showBgFeedback('Gagal menyimpan warna background: ' + err.message, true);
    }
  });

  const fileInput = document.getElementById('bg-image-input');
  document.getElementById('btn-bg-upload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleBackgroundImageChange);

  document.getElementById('btn-bg-remove-image').addEventListener('click', async () => {
    if (!confirm('Hapus gambar background ini? Tampilan publik akan kembali memakai warna palet (atau bawaan kalau belum pernah pilih warna).')) return;
    try {
      await SettingsAPI.updateAppSettings({
        backgroundType: cachedAppSettings.backgroundColor ? 'color' : 'default',
        backgroundImage: firebase.firestore.FieldValue.delete()
      });
      cachedAppSettings.backgroundType = cachedAppSettings.backgroundColor ? 'color' : 'default';
      delete cachedAppSettings.backgroundImage;
      renderBackgroundPreview();
      AuditLogAPI.log('update_background', { label: 'Gambar background dihapus' });
      showBgFeedback('Gambar background dihapus.');
    } catch (err) {
      showBgFeedback('Gagal menghapus gambar background: ' + err.message, true);
    }
  });

  document.getElementById('btn-bg-reset-default').addEventListener('click', async () => {
    if (!confirm('Kembalikan tampilan publik ke tampilan bawaan (tanpa gambar/warna kustom)?')) return;
    try {
      await SettingsAPI.updateAppSettings({
        backgroundType: 'default',
        backgroundImage: firebase.firestore.FieldValue.delete(),
        backgroundColor: firebase.firestore.FieldValue.delete()
      });
      cachedAppSettings.backgroundType = 'default';
      delete cachedAppSettings.backgroundImage;
      delete cachedAppSettings.backgroundColor;
      renderBackgroundPreview();
      AuditLogAPI.log('update_background', { label: 'Dikembalikan ke tampilan bawaan' });
      showBgFeedback('Background dikembalikan ke tampilan bawaan.');
    } catch (err) {
      showBgFeedback('Gagal mengembalikan ke bawaan: ' + err.message, true);
    }
  });
}

async function handleBackgroundImageChange(e) {
  const file = e.target.files[0];
  e.target.value = ''; // supaya bisa pilih file yang sama lagi kalau perlu
  if (!file) return;

  const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!file.type || !validTypes.includes(file.type)) {
    showBgFeedback('File harus berformat JPG, JPEG, atau PNG.', true);
    return;
  }
  if (file.size > MAX_BG_SOURCE_MB * 1024 * 1024) {
    showBgFeedback(`Ukuran file terlalu besar (maks. ${MAX_BG_SOURCE_MB}MB sebelum dikompres). Pilih gambar lain.`, true);
    return;
  }

  showBgFeedback('Sedang mengunggah & mengompres gambar, mohon tunggu...');
  try {
    const base64 = await compressBackgroundImageToBase64(file, MAX_BG_BASE64_BYTES);
    await SettingsAPI.updateAppSettings({
      backgroundType: 'image',
      backgroundImage: base64,
      backgroundColor: firebase.firestore.FieldValue.delete()
    });
    cachedAppSettings.backgroundType = 'image';
    cachedAppSettings.backgroundImage = base64;
    delete cachedAppSettings.backgroundColor;
    renderBackgroundPreview();
    AuditLogAPI.log('update_background', { label: `Gambar kustom: ${file.name}` });
    showBgFeedback('Gambar background berhasil disimpan & langsung dipakai di tampilan publik.');
  } catch (err) {
    showBgFeedback('Gagal mengunggah gambar background: ' + err.message, true);
  }
}

function renderBackgroundPreview() {
  const box = document.getElementById('bg-current-preview');
  const removeBtn = document.getElementById('btn-bg-remove-image');
  const type = cachedAppSettings.backgroundType || 'default';

  // Tandai swatch palet yang aktif
  document.querySelectorAll('.bg-palette-swatch').forEach((btn, i) => {
    btn.classList.toggle('active', type === 'color' && BackgroundPalettes[i].value === cachedAppSettings.backgroundColor);
  });

  if (type === 'image' && cachedAppSettings.backgroundImage) {
    box.style.backgroundImage = `url(${cachedAppSettings.backgroundImage})`;
    box.innerHTML = '<span>Gambar Kustom Aktif</span>';
    removeBtn.style.display = 'inline-block';
  } else if (type === 'color' && cachedAppSettings.backgroundColor) {
    box.style.backgroundImage = 'none';
    box.style.background = cachedAppSettings.backgroundColor;
    const p = BackgroundPalettes.find(p => p.value === cachedAppSettings.backgroundColor);
    box.innerHTML = `<span>Warna: ${escapeHtml(p ? p.name : 'Kustom')}</span>`;
    removeBtn.style.display = 'none';
  } else {
    box.style.backgroundImage = 'none';
    box.style.background = 'var(--bg)';
    box.innerHTML = '<span>Tampilan Bawaan (Default)</span>';
    removeBtn.style.display = 'none';
  }
}

function showBgFeedback(msg, isError = false) {
  const el = document.getElementById('bg-feedback');
  el.textContent = msg;
  el.className = 'comment-feedback ' + (isError ? 'error' : 'success');
}

// Isi ulang daftar kandidat "Keluarga Utama" di tab Setting supaya selalu
// mengikuti data orang terbaru (dipanggil dari refreshAll() dan sekali dari
// setupSettings() saat pertama dimuat). Aman dipanggil sebelum widget dibuat
// (mis. saat refreshAll() jalan sebelum tab Setting pernah dibuka).
function refreshRootPersonSelectOptions() {
  if (!rootPersonSelectWidget) return;
  const options = [...allPeople]
    .sort((a, b) => a.nama.localeCompare(b.nama))
    .map(p => ({ value: p.id, label: `${p.nama} (${p.jenisKelamin || '-'})` }));
  rootPersonSelectWidget.setOptions(options);
  rootPersonSelectWidget.setValue(cachedAppSettings.rootPersonId || '', true);
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  e.target.value = ''; // supaya bisa pilih file yang sama lagi kalau perlu
  if (!file) return;

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (err) {
    showSettingFeedback('File tidak valid atau bukan format backup JSON yang benar.', true);
    return;
  }

  const people = Array.isArray(parsed.people) ? parsed.people : [];
  const marriages = Array.isArray(parsed.marriages) ? parsed.marriages : [];
  const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
  // v14: file backup lama (sebelum v14) tidak punya field ini sama sekali --
  // tetap aman, cukup dilewati (tidak ada apa pun yang direstore utk settings).
  const settings = (parsed.settings && typeof parsed.settings === 'object') ? parsed.settings : null;

  if (people.length === 0 && marriages.length === 0 && comments.length === 0 && !settings) {
    showSettingFeedback('File backup ini tidak berisi data yang bisa dipulihkan.', true);
    return;
  }

  const genderBermasalah = people.filter(p => !RelationRules.hasValidGender(p)).length;
  const catatanGender = genderBermasalah > 0
    ? `\n\n⚠️ ${genderBermasalah} dari data orang di file ini punya jenis kelamin kosong/tidak baku -- ` +
      `mereka tidak akan terdeteksi sebagai ayah/ibu sampai diperbaiki manual lewat Edit setelah restore.`
    : '';
  const catatanSettings = settings
    ? `\n\nFile ini juga berisi pengaturan aplikasi (judul: "${settings.judulAplikasi || '-'}") yang akan ikut ditimpa.`
    : '';

  const ok = confirm(
    `File ini berisi ${people.length} data orang, ${marriages.length} data pernikahan, dan ${comments.length} komentar.\n\n` +
    `Data dengan ID yang sama di database akan DITIMPA, data baru akan ditambahkan. Ini tidak bisa dibatalkan.` +
    catatanGender + catatanSettings +
    `\n\nLanjutkan restore sekarang?`
  );
  if (!ok) return;

  showSettingFeedback('Sedang memulihkan data, mohon tunggu...');
  try {
    if (people.length) await PeopleAPI.importAll(people);
    if (marriages.length) await MarriageAPI.importAll(marriages);
    if (comments.length) await CommentAPI.importAll(comments);
    if (settings) await SettingsAPI.updateAppSettings(settings);
    AuditLogAPI.log('import_json', {
      label: file.name,
      detail: `${people.length} orang, ${marriages.length} pernikahan, ${comments.length} komentar${settings ? ', pengaturan aplikasi' : ''}`
    });
    await refreshAll();
    await refreshCommentBadge();
    if (settings) {
      cachedAppSettings = { ...cachedAppSettings, ...settings };
      document.getElementById('setting-title').value = cachedAppSettings.judulAplikasi || 'Silsilah Keluarga';
      refreshRootPersonSelectOptions();
    }
    showSettingFeedback(`Berhasil memulihkan ${people.length} data orang, ${marriages.length} pernikahan, ${comments.length} komentar${settings ? ', dan pengaturan aplikasi' : ''}.`);
  } catch (err) {
    showSettingFeedback('Gagal memulihkan data: ' + err.message, true);
  }
}

function showSettingFeedback(msg, isError = false) {
  const el = document.getElementById('setting-feedback');
  el.textContent = msg;
  el.className = 'comment-feedback ' + (isError ? 'error' : 'success');
}

// ======================================================================
// DOWNLOAD JPG / PDF
// ======================================================================

// v14: pencarian nama khusus tab Pohon Keluarga (admin) -- meniru perilaku
// pencarian yang sudah ada di tampilan publik (lihat setupSearch() di app.js):
// menyorot kotak yang cocok & auto-scroll ke kecocokan pertama. Sebelumnya
// admin harus scroll manual utk menemukan 1 orang di pohon yang sudah berisi
// ratusan kotak.
function setupAdminTreeSearch() {
  const input = document.getElementById('admin-tree-search');
  const navBox = document.getElementById('admin-tree-search-nav');
  const navCount = document.getElementById('admin-tree-search-count');
  const navPrev = document.getElementById('admin-tree-search-prev');
  const navNext = document.getElementById('admin-tree-search-next');
  if (!input) return;

  // v15: sama seperti setupSearch() di app.js -- nama yang sama/kembar
  // disorot semua, tapi kita simpan SELURUH daftar kecocokan supaya admin
  // bisa lompat antar hasil lewat ‹ › / Enter, dibantu penghitung
  // "X dari Y hasil".
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
    document.querySelectorAll('#admin-tree-container .tree-node.search-focus').forEach(n => n.classList.remove('search-focus'));
    const el = document.querySelector(`#admin-tree-container .tree-node[data-id="${person.id}"]`);
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

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('#admin-tree-container .tree-node').forEach(node => {
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
  });

  // Enter (atau Shift+Enter utk mundur) melompat ke hasil berikutnya.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && currentMatches.length) {
      e.preventDefault();
      focusMatch(currentMatchIndex + (e.shiftKey ? -1 : 1));
    }
  });

  if (navPrev) navPrev.addEventListener('click', () => focusMatch(currentMatchIndex - 1));
  if (navNext) navNext.addEventListener('click', () => focusMatch(currentMatchIndex + 1));
}

function setupDownload() {
  document.getElementById('btn-tree-expand-all').addEventListener('click', () => {
    TreeControls.expandAll(document.getElementById('admin-tree-container'));
  });
  document.getElementById('btn-tree-collapse-all').addEventListener('click', () => {
    TreeControls.collapseAll(document.getElementById('admin-tree-container'));
  });

  const adminTreeEl = document.getElementById('admin-tree-container');
  const getTitle = () => cachedAppSettings.judulAplikasi;
  TreeExportAPI.attachButton('btn-download-jpg', adminTreeEl, getTitle, 'downloadJPG');
  TreeExportAPI.attachButton('btn-download-pdf-cetak', adminTreeEl, getTitle, 'downloadPDFCetak');
  TreeExportAPI.attachButton('btn-download-pdf-poster', adminTreeEl, getTitle, 'downloadPDFPoster');
}

setInterval(() => {
  if (auth.currentUser) refreshCommentBadge();
}, 30000);

// ======================================================================
// TAB: JELAJAH KELUARGA (mode kartu, drill-down per keturunan)
// Port persis dari fitur Jelajah tampilan publik (lihat app.js) supaya admin
// juga punya cara telusuri silsilah satu keluarga per layar, bukan cuma
// lewat grafik pohon penuh di tab "Pohon Keluarga". Bedanya dengan versi
// publik: tombol "Biodata" di sini membuka FORM EDIT orang tsb
// (openEditPerson, sama seperti klik kotak di tab Pohon Keluarga), bukan
// modal detail baca-saja (krn admin memang tidak punya modal itu) -- dan
// tidak difilter oleh "Keluarga Utama" (admin selalu melihat SEMUA
// keluarga, sama seperti tab Pohon Keluarga).
let jelajahPath = [];
let jelajahCurrentChildEntries = [];
let jelajahCurrentPickerEntries = [];
let jelajahShowChildren = false;
let jelajahHasFixedRoot = false;

function jelajahGetPersonMarriageNodes(personId) {
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

function jelajahMakeEntry(personId) {
  return { personId, nodes: jelajahGetPersonMarriageNodes(personId) };
}

function jelajahGetChildEntriesOf(node) {
  return (node.childIds || []).map(cid => jelajahMakeEntry(cid));
}

function jelajahGetRootPickerEntries() {
  const leluhurList = allPeople.filter(p => {
    const { ayah, ibu } = RelationRules.getParents(p.id, allPeople, allMarriages);
    return !ayah && !ibu;
  });
  const seenMarriageIds = new Set();
  const result = [];
  leluhurList.forEach(p => {
    const nodes = jelajahGetPersonMarriageNodes(p.id);
    const belumMenikah = nodes.length === 1 && !nodes[0].marriageId;
    if (belumMenikah) { result.push({ personId: p.id, nodes }); return; }

    const nodesBaru = nodes.filter(n => !seenMarriageIds.has(n.marriageId));
    if (nodesBaru.length === 0) return;
    nodesBaru.forEach(n => seenMarriageIds.add(n.marriageId));
    result.push({ personId: p.id, nodes: nodesBaru });
  });
  return result;
}

// Dipanggil setiap kali tab "Jelajah" dibuka -- reset jalur ke titik awal
// (leluhur utama kalau "Keluarga Utama" disetel di Setting, atau daftar
// pilih leluhur kalau belum), sama seperti openJelajahModal() di publik.
function openAdminJelajah() {
  const rootId = cachedAppSettings.rootPersonId;
  const rootValid = rootId && allPeople.some(p => p.id === rootId);
  if (rootValid) {
    const rootNodes = jelajahGetPersonMarriageNodes(rootId);
    jelajahHasFixedRoot = rootNodes.length === 1;
    jelajahPath = jelajahHasFixedRoot ? [rootNodes[0]] : [];
  } else {
    jelajahHasFixedRoot = false;
    jelajahPath = [];
  }
  jelajahShowChildren = false;
  renderAdminJelajah();
}

function jelajahMasukChild(entryIdx, nodeIdx) {
  const source = jelajahPath.length === 0 ? jelajahCurrentPickerEntries : jelajahCurrentChildEntries;
  const entry = source[entryIdx];
  if (!entry) return;
  const node = entry.nodes[nodeIdx || 0];
  if (!node) return;
  jelajahPath.push(node);
  jelajahShowChildren = false;
  renderAdminJelajah();
}

function jelajahBukaAnak() {
  jelajahShowChildren = true;
  renderAdminJelajah();
}

function jelajahMinPathLen() {
  return jelajahHasFixedRoot ? 1 : 0;
}

function jelajahKembali() {
  if (jelajahPath.length <= jelajahMinPathLen()) return;
  jelajahPath.pop();
  jelajahShowChildren = true;
  renderAdminJelajah();
}

function jelajahKeBreadcrumb(index) {
  jelajahPath = jelajahPath.slice(0, index + 1);
  jelajahShowChildren = true;
  renderAdminJelajah();
}

function jelajahNodeLabel(node) {
  const a = allPeople.find(p => p.id === node.personAId);
  const b = node.personBId ? allPeople.find(p => p.id === node.personBId) : null;
  const namaA = a ? a.nama : '?';
  return escapeHtml(b ? `${namaA} & ${b.nama}` : namaA);
}

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
      <button class="btn-link jelajah-biodata-link" onclick="event.stopPropagation();openEditPerson('${node.personAId}')">Biodata ${escapeHtml(personA.nama)}</button>
      ${personB ? `<button class="btn-link jelajah-biodata-link" onclick="event.stopPropagation();openEditPerson('${node.personBId}')">Biodata ${escapeHtml(personB.nama)}</button>` : ''}
    </div>
  `;
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
        <button class="btn-link jelajah-biodata-link" onclick="event.stopPropagation();openEditPerson('${person.id}')">Biodata ${escapeHtml(person.nama)}</button>
        ${personB ? `<button class="btn-link jelajah-biodata-link" onclick="event.stopPropagation();openEditPerson('${node.personBId}')">Biodata ${escapeHtml(personB.nama)}</button>` : ''}
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
        <button class="btn-link jelajah-biodata-link" onclick="openEditPerson('${person.id}')">Biodata ${escapeHtml(person.nama)}</button>
      </div>
    </div>
  `;
}

function renderAdminJelajah() {
  const breadcrumbEl = document.getElementById('admin-jelajah-breadcrumb');
  const bodyEl = document.getElementById('admin-jelajah-body');
  if (!breadcrumbEl || !bodyEl) return;

  if (jelajahPath.length === 0) {
    jelajahCurrentPickerEntries = jelajahGetRootPickerEntries();
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

  const crumbHtml = jelajahPath.map((node, i) => {
    const isLast = i === jelajahPath.length - 1;
    return `<span class="jelajah-crumb${isLast ? ' jelajah-crumb-active' : ''}" onclick="jelajahKeBreadcrumb(${i})">${jelajahNodeLabel(node)}</span>${isLast ? '' : '<span class="jelajah-crumb-sep">&rsaquo;</span>'}`;
  }).join('');
  breadcrumbEl.innerHTML = crumbHtml;

  const topNode = jelajahPath[jelajahPath.length - 1];
  jelajahCurrentChildEntries = jelajahGetChildEntriesOf(topNode);

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
