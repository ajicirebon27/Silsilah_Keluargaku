// =====================================================================
// SEARCHABLE-SELECT.JS
// Widget dropdown dengan kotak pencarian, dipakai untuk menggantikan
// <select> biasa yang isinya bisa jadi sangat panjang (mis. daftar
// pasangan / ayah / ibu di modal Relasi Keluarga) supaya admin tidak
// perlu scroll manual -- tinggal ketik sebagian nama untuk menyaring.
//
// Pemakaian:
//   const s = new SearchableSelect(containerEl, {
//     placeholder: 'Cari nama...',
//     emptyOptionLabel: 'Tidak diketahui', // null = tanpa opsi kosong
//     onChange: (value) => { ... }
//   });
//   s.setOptions([{ value: 'id1', label: 'Nama 1', sublabel: 'lahir 12 Mei 1980 ...' }, ...]);
//   s.setValue('id1');       // set terpilih tanpa memicu onChange
//   s.getValue();            // 'id1'
//
// `sublabel` (opsional per-item) -- baris keterangan kecil yang tampil di
// bawah nama pada tiap baris hasil pencarian (mis. tanggal lahir, orang tua
// yang sudah tercatat, status pasangan). Tujuannya supaya kalau ada beberapa
// orang dengan nama yang sama/mirip (mis. 2 "Dewi" berbeda), admin punya
// info pembeda langsung di tempat tanpa harus buka data masing-masing dulu.
// Saat query yang diketik cocok dengan lebih dari 1 orang, panel juga
// menampilkan notif kecil di atas daftar supaya admin sadar perlu mengecek
// keterangan tsb sebelum memilih.
//
// Panel daftar hasil pencarian SENGAJA di-"portal"-kan ke <body> (posisi
// fixed, dihitung ulang tiap dibuka/discroll) alih-alih anak langsung dari
// container -- supaya tidak terpotong oleh modal-card yang punya
// overflow-y:auto/scroll.
// =====================================================================

function ssEscapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

class SearchableSelect {
  constructor(container, opts = {}) {
    this.container = container;
    this.placeholder = opts.placeholder || 'Cari & pilih...';
    // null = tidak ada opsi "kosong" sama sekali (harus pilih salah satu).
    // string = label opsi kosong, misal 'Tidak diketahui' atau 'Pilih orang...'
    this.emptyOptionLabel = ('emptyOptionLabel' in opts) ? opts.emptyOptionLabel : 'Tidak diketahui';
    this.onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    this.items = [];       // [{value, label}]
    this.value = '';
    this.disabled = false;
    this._entries = [];
    this._activeIndex = -1;
    this._isOpen = false;

    this._build();
  }

  _build() {
    this.container.classList.add('ss-root');
    this.container.innerHTML = `
      <div class="ss-control">
        <input type="text" class="ss-search-input" placeholder="${ssEscapeHtml(this.placeholder)}" autocomplete="off">
        <span class="ss-arrow" aria-hidden="true">&#9662;</span>
      </div>
    `;
    this.inputEl = this.container.querySelector('.ss-search-input');

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'ss-panel';
    this.panelEl.style.display = 'none';
    document.body.appendChild(this.panelEl);

    this.inputEl.addEventListener('focus', () => this._open());
    this.inputEl.addEventListener('click', () => this._open());
    this.inputEl.addEventListener('input', () => { this._activeIndex = -1; this._renderList(this.inputEl.value); });
    this.inputEl.addEventListener('keydown', (e) => this._onKeydown(e));

    this._outsideHandler = (e) => {
      if (this.container.contains(e.target) || this.panelEl.contains(e.target)) return;
      this._close();
    };
    this._repositionHandler = () => { if (this._isOpen) this._positionPanel(); };
    document.addEventListener('mousedown', this._outsideHandler, true);
    window.addEventListener('scroll', this._repositionHandler, true);
    window.addEventListener('resize', this._repositionHandler);
  }

  // items: [{ value, label }]
  setOptions(items) {
    this.items = items || [];
    if (this.value && !this.items.some(i => i.value === this.value)) {
      // Value lama sudah tidak ada di daftar kandidat yang baru -> reset diam-diam.
      this.value = '';
      this.inputEl.value = '';
    } else {
      this.inputEl.value = this._labelFor(this.value);
    }
    if (this._isOpen) this._renderList(this.inputEl.value);
  }

  _labelFor(value) {
    if (!value) return '';
    const found = this.items.find(i => i.value === value);
    return found ? found.label : '';
  }

  // silent=true -> tidak memicu callback onChange (dipakai saat load data awal)
  setValue(value, silent) {
    this.value = value || '';
    this.inputEl.value = this._labelFor(this.value);
    if (!silent && this.onChange) this.onChange(this.value);
  }

  getValue() { return this.value; }

  setDisabled(disabled) {
    this.disabled = disabled;
    this.inputEl.disabled = disabled;
    this.container.classList.toggle('ss-disabled', disabled);
    if (disabled) this._close();
  }

  _matchEntries(query) {
    const q = (query || '').trim().toLowerCase();
    const entries = [];
    if (this.emptyOptionLabel !== null) entries.push({ value: '', label: this.emptyOptionLabel });
    entries.push(...this.items);
    if (!q) return entries;
    return entries.filter(e => e.label.toLowerCase().includes(q));
  }

  _renderList(query) {
    const entries = this._matchEntries(query);
    this._entries = entries;

    // Notif ambiguitas nama: kalau yang diketik cocok dengan >1 orang (di
    // luar opsi "kosong"), ingatkan admin supaya mengecek keterangan pembeda
    // tiap baris (tanggal lahir/ortu/pasangan) sebelum memilih -- supaya
    // tidak salah pilih di antara nama yang sama/mirip.
    const q = (query || '').trim();
    const realMatches = entries.filter(e => e.value !== '');
    const notice = (q && realMatches.length > 1)
      ? `<div class="ss-notice">Ditemukan ${realMatches.length} orang dengan nama mengandung "${ssEscapeHtml(q)}" -- cek keterangan di bawah tiap nama supaya tidak salah pilih.</div>`
      : '';

    const list = entries.length
      ? entries.map((e, i) => `<div class="ss-item ${e.value === this.value ? 'ss-item-selected' : ''}" data-idx="${i}">
          <div class="ss-item-label">${ssEscapeHtml(e.label)}</div>
          ${e.sublabel ? `<div class="ss-item-sublabel">${ssEscapeHtml(e.sublabel)}</div>` : ''}
        </div>`).join('')
      : `<div class="ss-empty">Tidak ditemukan.</div>`;

    this.panelEl.innerHTML = notice + list;
    this.panelEl.querySelectorAll('.ss-item').forEach(el => {
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); // cegah blur duluan sebelum klik diproses
        const idx = Number(el.dataset.idx);
        this._select(entries[idx]);
      });
    });
    this._highlight();
  }

  _select(entry) {
    if (!entry) return;
    this.value = entry.value;
    this.inputEl.value = entry.label === this.emptyOptionLabel ? '' : entry.label;
    this._close();
    if (this.onChange) this.onChange(this.value);
  }

  _onKeydown(e) {
    if (!this._isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { this._open(); return; }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._activeIndex = Math.min(this._activeIndex + 1, this._entries.length - 1);
      this._highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._activeIndex = Math.max(this._activeIndex - 1, 0);
      this._highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._entries[this._activeIndex]) this._select(this._entries[this._activeIndex]);
    } else if (e.key === 'Escape') {
      this._close();
    }
  }

  _highlight() {
    const items = this.panelEl.querySelectorAll('.ss-item');
    items.forEach((el, i) => el.classList.toggle('ss-item-active', i === this._activeIndex));
    const activeEl = this.panelEl.querySelector('.ss-item-active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  _positionPanel() {
    const rect = this.container.getBoundingClientRect();
    this.panelEl.style.left = `${rect.left}px`;
    this.panelEl.style.top = `${rect.bottom + 4}px`;
    this.panelEl.style.width = `${rect.width}px`;
  }

  _open() {
    if (this.disabled) return;
    this._isOpen = true;
    this.container.classList.add('ss-open');
    this._positionPanel();
    this.panelEl.style.display = 'block';
    // Saat baru dibuka & inputnya masih menampilkan label yang sudah terpilih,
    // tampilkan semua opsi dulu (bukan hasil filter dari label itu sendiri).
    const showingSelectedLabel = this.inputEl.value === this._labelFor(this.value) && this.value;
    this._renderList(showingSelectedLabel ? '' : this.inputEl.value);
  }

  _close() {
    this._isOpen = false;
    this.container.classList.remove('ss-open');
    this.panelEl.style.display = 'none';
    this.inputEl.value = this._labelFor(this.value);
  }

  destroy() {
    document.removeEventListener('mousedown', this._outsideHandler, true);
    window.removeEventListener('scroll', this._repositionHandler, true);
    window.removeEventListener('resize', this._repositionHandler);
    if (this.panelEl && this.panelEl.parentNode) this.panelEl.parentNode.removeChild(this.panelEl);
  }
}
