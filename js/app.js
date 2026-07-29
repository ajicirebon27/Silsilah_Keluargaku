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
  renderTreeSVG(treeContainer, allPeople, allMarriages, openDetail);

  // Halaman publik: sembunyikan SEMUA keturunan secara default saat pertama
  // dibuka, jadi yang tamu lihat pertama kali cuma leluhur paling atas
  // (mis. Bapak Darsa & Ibu Kesi) -- bukan seluruh pohon sekaligus yang
  // bisa terasa penuh/membingungkan. Tamu lalu klik lencana "+" pada kotak
  // seseorang utk membuka (unhide) keturunannya satu per satu, lengkap
  // dgn animasi fade singkat yang sudah ditangani oleh toggleTreeNode()
  // di tree.js. Ini TIDAK memengaruhi tampilan admin (admin punya
  // container SVG sendiri, statusnya disimpan terpisah per container).
  TreeControls.collapseAll(treeContainer);
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
// Alternatif dari tampilan pohon bergaris: 1 keluarga (1 orang + pasangan +
// anak-anaknya) ditampilkan per layar, supaya tidak penuh sesak walau data
// sudah banyak. `jelajahPath` menyimpan jalur dari leluhur sampai posisi
// sekarang (dipakai untuk breadcrumb & tombol kembali).
let jelajahPath = [];

function setupJelajahModal() {
  document.getElementById('btn-jelajah').addEventListener('click', openJelajahModal);
  document.getElementById('jelajah-modal-close').addEventListener('click', closeJelajahModal);
  document.getElementById('jelajah-modal').addEventListener('click', e => {
    if (e.target.id === 'jelajah-modal') closeJelajahModal();
  });
}

function openJelajahModal() {
  const rootId = appSettings.rootPersonId;
  const rootValid = rootId && allPeople.some(p => p.id === rootId);
  if (rootValid) {
    jelajahPath = [rootId];
    renderJelajah();
  } else {
    jelajahPath = [];
    renderJelajahPilihLeluhur();
  }
  document.getElementById('jelajah-modal').style.display = 'flex';
}

function closeJelajahModal() {
  document.getElementById('jelajah-modal').style.display = 'none';
}

// Dipakai kalau admin belum menyetel "Keluarga Utama" -- tamu memilih dulu
// mau mulai jelajah dari leluhur mana (orang yang belum tercatat orang tuanya).
function renderJelajahPilihLeluhur() {
  const leluhurList = allPeople.filter(p => {
    const { ayah, ibu } = RelationRules.getParents(p.id, allPeople, allMarriages);
    return !ayah && !ibu;
  });
  document.getElementById('jelajah-breadcrumb').innerHTML = '';
  document.getElementById('jelajah-body').innerHTML = `
    <p class="jelajah-muted">Pilih leluhur untuk mulai menjelajah:</p>
    <div class="jelajah-list">
      ${leluhurList.map(p => `
        <button class="jelajah-item" onclick="jelajahMasuk('${p.id}')">
          <span class="jelajah-item-name">${escapeHtml(p.nama)}</span>
          <span class="jelajah-item-arrow">&rsaquo;</span>
        </button>
      `).join('') || '<p class="jelajah-muted">Belum ada data orang.</p>'}
    </div>
  `;
}

function jelajahMasuk(personId) {
  jelajahPath.push(personId);
  renderJelajah();
}

function jelajahKembali() {
  jelajahPath.pop();
  if (jelajahPath.length === 0) {
    renderJelajahPilihLeluhur();
  } else {
    renderJelajah();
  }
}

function jelajahKeBreadcrumb(index) {
  jelajahPath = jelajahPath.slice(0, index + 1);
  renderJelajah();
}

function renderJelajah() {
  const personId = jelajahPath[jelajahPath.length - 1];
  const person = allPeople.find(p => p.id === personId);
  if (!person) { renderJelajahPilihLeluhur(); return; }

  const crumbHtml = jelajahPath.map((id, i) => {
    const p = allPeople.find(x => x.id === id);
    const nama = p ? p.nama : '?';
    const isLast = i === jelajahPath.length - 1;
    return `<span class="jelajah-crumb${isLast ? ' jelajah-crumb-active' : ''}" onclick="jelajahKeBreadcrumb(${i})">${escapeHtml(nama)}</span>${isLast ? '' : '<span class="jelajah-crumb-sep">&rsaquo;</span>'}`;
  }).join('');
  document.getElementById('jelajah-breadcrumb').innerHTML = crumbHtml;

  const marriagesOf = allMarriages
    .filter(m => m.orangId1 === personId || m.orangId2 === personId)
    .sort((a, b) => (a.urutanPasangan || 1) - (b.urutanPasangan || 1));

  const isMale = person.jenisKelamin === 'Laki-laki';
  const isFemale = person.jenisKelamin === 'Perempuan';
  const partnerWord = isMale ? 'Istri' : (isFemale ? 'Suami' : 'Pasangan');
  const isPoly = marriagesOf.length > 1;

  let groupsHtml;
  if (marriagesOf.length === 0) {
    groupsHtml = '<p class="jelajah-muted">Belum ada data pasangan/anak untuk orang ini.</p>';
  } else {
    groupsHtml = marriagesOf.map((m, idx) => {
      const partnerId = m.orangId1 === personId ? m.orangId2 : m.orangId1;
      const partner = partnerId ? allPeople.find(p => p.id === partnerId) : null;
      const label = partner
        ? `${partnerWord}${isPoly ? ' ke-' + (idx + 1) : ''}: ${escapeHtml(partner.nama)}`
        : `${partnerWord}${isPoly ? ' ke-' + (idx + 1) : ''}: <span class="jelajah-muted">belum tercatat</span>`;

      const anakIds = m.childIds || [];
      const anakHtml = anakIds.length
        ? `<div class="jelajah-list">${anakIds.map(cid => {
            const c = allPeople.find(p => p.id === cid);
            if (!c) return '';
            const jumlahAnak = RelationRules.getChildren(cid, allMarriages).length;
            return `
              <button class="jelajah-item" onclick="jelajahMasuk('${cid}')">
                <span class="jelajah-item-name">${escapeHtml(c.nama)}</span>
                <span class="jelajah-item-sub">${jumlahAnak ? jumlahAnak + ' anak' : 'belum ada anak tercatat'}</span>
                <span class="jelajah-item-arrow">&rsaquo;</span>
              </button>
            `;
          }).join('')}</div>`
        : '<p class="jelajah-muted jelajah-noanak">Belum ada anak tercatat.</p>';

      return `<div class="jelajah-group"><p class="jelajah-group-label">${label}</p>${anakHtml}</div>`;
    }).join('');
  }

  const backBtn = jelajahPath.length > 1 || (jelajahPath.length === 1 && !appSettings.rootPersonId)
    ? `<div class="jelajah-back-row"><button class="btn-link" onclick="jelajahKembali()">&larr; Kembali</button></div>`
    : '';

  document.getElementById('jelajah-body').innerHTML = `
    <div class="jelajah-card ${isFemale ? 'jelajah-card-female' : ''}">
      <div class="jelajah-card-name">${escapeHtml(person.nama)}</div>
      <div class="jelajah-card-sub">${escapeHtml(person.jenisKelamin || '-')}</div>
      <button class="btn-link jelajah-biodata-link" onclick="openDetail('${personId}')">Lihat biodata lengkap</button>
    </div>
    ${groupsHtml}
    ${backBtn}
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
