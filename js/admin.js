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

const authScreen = document.getElementById('auth-screen');
const adminApp = document.getElementById('admin-app');

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

  if (isRegistered) {
    title.textContent = 'Masuk Admin';
    subtitle.textContent = 'Masuk untuk mengelola data silsilah keluarga.';
    submitBtn.textContent = 'Masuk';
  } else {
    title.textContent = 'Daftar sebagai Admin';
    subtitle.textContent = 'Belum ada admin terdaftar. Daftar sekali di sini — setelah ini, tidak bisa ada admin lain.';
    submitBtn.textContent = 'Daftar & Masuk';
  }

  const form = document.getElementById('auth-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = '';

    try {
      if (isRegistered) {
        await auth.signInWithEmailAndPassword(email, password);
      } else {
        const stillNotRegistered = !(await SettingsAPI.isAdminRegistered());
        if (!stillNotRegistered) {
          errorEl.textContent = 'Admin sudah terdaftar. Silakan masuk.';
          return;
        }
        await auth.createUserWithEmailAndPassword(email, password);
        try {
          await SettingsAPI.markAdminRegistered(auth.currentUser.uid);
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
    'auth/invalid-credential': 'Email atau kata sandi salah.'
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
  await refreshAll();
  await refreshCommentBadge();
  await refreshTrashBadge();
  await renderAdminDashboard();
}

async function refreshAll() {
  [allPeople, allMarriages] = await Promise.all([PeopleAPI.getAll(), MarriageAPI.getAll()]);
  renderPeopleTable();
  renderTreeSVG(document.getElementById('admin-tree-container'), allPeople, allMarriages, openEditPerson);
  if (laporanSelectedId) renderLaporanDetail();
  refreshRootPersonSelectOptions();
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

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
    });
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

  tbody.innerHTML = rows.map(p => {
    const sudahRelasi = hasRelasiSet(p.id);
    const badge = sudahRelasi
      ? `<span class="relasi-check relasi-check-sudah" title="Sudah disetting relasi (pasangan/orang tua/anak)">${checkIconSVG()}</span>`
      : `<span class="relasi-check relasi-check-belum" title="Belum disetting relasi apapun">${belumIconSVG()}</span>`;
    const genderValid = RelationRules.hasValidGender(p);
    const genderCell = genderValid
      ? escapeHtml(p.jenisKelamin)
      : `<span class="gender-invalid" title="Jenis kelamin kosong/tidak baku -- orang ini TIDAK akan pernah terdeteksi sebagai ayah/ibu di manapun sampai ini diperbaiki lewat tombol Edit">${escapeHtml(p.jenisKelamin || '(kosong)')} ⚠️</span>`;
    return `
    <tr>
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
  }).join('') || `<tr><td colspan="5" class="empty-row">${
    currentRelasiFilter === 'all' ? 'Belum ada data.' :
    currentRelasiFilter === 'sudah' ? 'Belum ada data yang sudah terelasi.' :
    'Semua data sudah terelasi. 🎉'
  }</td></tr>`;

  renderGenderInvalidWarning();
  renderPeoplePagination(totalCount, totalPages);
  renderRelasiFilterSummary(searched.length, sudahCount, belumCount);
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
    } else {
      personId = await PeopleAPI.add(data);
    }

    if (pendingFotoFile) {
      const base64 = await compressImageToBase64(pendingFotoFile);
      await PeopleAPI.update(personId, { fotoUrl: base64 });
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
  const myMarriages = allMarriages.filter(m => m.orangId1 === person.id || m.orangId2 === person.id);
  const listEl = document.getElementById('relasi-pasangan-list');
  listEl.innerHTML = myMarriages.map(m => {
    const partnerId = m.orangId1 === person.id ? m.orangId2 : m.orangId1;
    const partner = partnerId ? allPeople.find(p => p.id === partnerId) : null;
    return `<div class="relation-chip">${escapeHtml(partner ? partner.nama : '(tidak diketahui)')}
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

  pasanganSelectWidget.setOptions(candidates.map(p => ({ value: p.id, label: p.nama })));
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

  await refreshRelasiData();
}

async function removePasangan(marriageId) {
  if (!confirm('Hapus relasi pasangan ini? Anak-anak dari pernikahan ini juga akan kehilangan relasi orang tua tersebut.')) return;
  await MarriageAPI.delete(marriageId);
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

function renderOrtuSection(person) {
  const { ayah, ibu } = RelationRules.getParents(person.id, allPeople, allMarriages);
  const { ayahCandidates, ibuCandidates } = getOrtuCandidates(person);

  ayahSelectWidget.setOptions(ayahCandidates.map(p => ({ value: p.id, label: p.nama })));
  ibuSelectWidget.setOptions(ibuCandidates.map(p => ({ value: p.id, label: p.nama })));
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
    ibuSelectWidget.setOptions(options.map(p => ({ value: p.id, label: p.nama })));
  } else {
    const ibuId = ibuSelectWidget.getValue();
    let options = ayahCandidates;
    if (ibuId) {
      const husbandsIds = new Set(getRecordedSpouseIds(ibuId));
      const husbandsOnly = ayahCandidates.filter(p => husbandsIds.has(p.id));
      if (husbandsOnly.length > 0) options = husbandsOnly;
    }
    ayahSelectWidget.setOptions(options.map(p => ({ value: p.id, label: p.nama })));
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
  await refreshRelasiData();
  const noteEl2 = document.getElementById('relasi-ortu-note');
  noteEl2.textContent = 'Berhasil disimpan.';
  noteEl2.className = 'relasi-note relasi-note-success';
}

// ---------- Bagian Anak (read-only) ----------
function renderAnakSection(person) {
  const childIds = RelationRules.getChildren(person.id, allMarriages);
  const listEl = document.getElementById('relasi-anak-list');
  if (childIds.length === 0) {
    listEl.textContent = 'Belum ada anak tercatat.';
    return;
  }
  const names = childIds.map(cid => {
    const c = allPeople.find(p => p.id === cid);
    return c ? c.nama : '(tidak ditemukan)';
  });
  listEl.innerHTML = names.map(n => `<span class="relation-chip">${escapeHtml(n)}</span>`).join(' ');
}

async function refreshRelasiData() {
  [allPeople, allMarriages] = await Promise.all([PeopleAPI.getAll(), MarriageAPI.getAll()]);
  renderPeopleTable();
  renderTreeSVG(document.getElementById('admin-tree-container'), allPeople, allMarriages, openEditPerson);
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
  await PeopleAPI.restore(id);
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
  await refreshAll();
  await renderTrash();
  await refreshTrashBadge();
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
    { label: 'Total Orang', value: stats.totalOrang, icon: '👥', tone: 'blue' },
    { label: 'Total Keluarga / Pasangan', value: stats.totalKeluarga, icon: '💍', tone: 'green' },
    { label: 'Laki-laki', value: stats.laki, icon: '👨', tone: 'blue' },
    { label: 'Perempuan', value: stats.perempuan, icon: '👩', tone: 'pink' },
    { label: 'Anak Tercatat', value: stats.totalAnakTercatat, icon: '🧒', tone: 'green' },
    { label: 'Jumlah Generasi', value: stats.maxGenerasi, icon: '🌳', tone: 'blue' },
    { label: 'Keluarga Poligami', value: stats.totalPoligami, icon: '🔀', tone: 'green' },
    { label: 'Komentar Belum Dibaca', value: unreadComments, icon: '💬', tone: unreadComments > 0 ? 'amber' : 'blue' },
    { label: 'Belum Ada Relasi', value: stats.belumTerelasi, icon: '⚠️', tone: stats.belumTerelasi > 0 ? 'amber' : 'blue' },
    { label: 'Jenis Kelamin Bermasalah', value: stats.genderInvalid, icon: '⚠️', tone: stats.genderInvalid > 0 ? 'amber' : 'blue' },
    { label: 'Belum Ada Foto', value: stats.tanpaFoto, icon: '🖼️', tone: 'blue' },
    { label: 'Belum Ada Tanggal Lahir', value: stats.tanpaTglLahir, icon: '📅', tone: 'blue' },
    { label: 'Data di Sampah', value: trash.length, icon: '🗑️', tone: trash.length > 0 ? 'amber' : 'blue' }
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
  });

  document.getElementById('btn-save-title').addEventListener('click', async () => {
    const title = document.getElementById('setting-title').value.trim() || 'Silsilah Keluarga';
    await SettingsAPI.updateAppSettings({ judulAplikasi: title });
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
      showSettingFeedback('Kata sandi berhasil diubah.');
    } catch (err) {
      showSettingFeedback('Gagal ubah kata sandi: ' + err.message, true);
    }
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const [people, marriages, comments] = await Promise.all([
      PeopleAPI.getAll(), MarriageAPI.getAll(), CommentAPI.getAll()
    ]);
    const blob = new Blob([JSON.stringify({ people, marriages, comments }, null, 2)], { type: 'application/json' });
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

  if (people.length === 0 && marriages.length === 0 && comments.length === 0) {
    showSettingFeedback('File backup ini tidak berisi data yang bisa dipulihkan.', true);
    return;
  }

  const genderBermasalah = people.filter(p => !RelationRules.hasValidGender(p)).length;
  const catatanGender = genderBermasalah > 0
    ? `\n\n⚠️ ${genderBermasalah} dari data orang di file ini punya jenis kelamin kosong/tidak baku -- ` +
      `mereka tidak akan terdeteksi sebagai ayah/ibu sampai diperbaiki manual lewat Edit setelah restore.`
    : '';

  const ok = confirm(
    `File ini berisi ${people.length} data orang, ${marriages.length} data pernikahan, dan ${comments.length} komentar.\n\n` +
    `Data dengan ID yang sama di database akan DITIMPA, data baru akan ditambahkan. Ini tidak bisa dibatalkan.` +
    catatanGender +
    `\n\nLanjutkan restore sekarang?`
  );
  if (!ok) return;

  showSettingFeedback('Sedang memulihkan data, mohon tunggu...');
  try {
    if (people.length) await PeopleAPI.importAll(people);
    if (marriages.length) await MarriageAPI.importAll(marriages);
    if (comments.length) await CommentAPI.importAll(comments);
    await refreshAll();
    await refreshCommentBadge();
    showSettingFeedback(`Berhasil memulihkan ${people.length} data orang, ${marriages.length} pernikahan, dan ${comments.length} komentar.`);
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

function setupDownload() {
  document.getElementById('btn-tree-expand-all').addEventListener('click', () => {
    TreeControls.expandAll(document.getElementById('admin-tree-container'));
  });
  document.getElementById('btn-tree-collapse-all').addEventListener('click', () => {
    TreeControls.collapseAll(document.getElementById('admin-tree-container'));
  });

  document.getElementById('btn-download-jpg').addEventListener('click', async () => {
    const canvas = await html2canvas(document.getElementById('admin-tree-container'), { backgroundColor: '#ffffff', scale: 2 });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = 'pohon-keluarga.jpg';
    a.click();
  });

  document.getElementById('btn-download-pdf').addEventListener('click', async () => {
    const canvas = await html2canvas(document.getElementById('admin-tree-container'), { backgroundColor: '#ffffff', scale: 2 });
    const { jsPDF } = window.jspdf;
    const orientation = canvas.width > canvas.height ? 'l' : 'p';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, canvas.width, canvas.height);
    pdf.save('pohon-keluarga.pdf');
  });
}

setInterval(() => {
  if (auth.currentUser) refreshCommentBadge();
}, 30000);
