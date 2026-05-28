/**
 * app.js — UI logic. Depends on storage.js and api.js.
 */

let currentWatchId = null;
let editingPhotoData = null;
let editingWatchId = null;   // null = new watch, string = editing existing
let historySelectedWatch = null;
let historySelectedYear = null;

/* ===== UTILITIES ===== */

function showToast(msg, dur = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function daysSince(ts) {
  return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function watchEmoji(type) {
  return type === 'automatic' ? '⚙️' : type === 'quartz' ? '🔋' : '🕰️';
}

function typeLabel(type) {
  return type === 'automatic' ? 'Auto' : type === 'quartz' ? 'Quartz' : 'Manual';
}

/* ===== NAVIGATION ===== */

function showView(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  const navEl = document.getElementById('nav-' + v);
  if (navEl) navEl.classList.add('active');
  if (v === 'home') renderHome();
  if (v === 'history') renderHistory();
  window.scrollTo(0, 0);
}

/* ===== HOME ===== */

function renderHome() {
  const grid = document.getElementById('watches-grid');
  const empty = document.getElementById('empty-state');
  const ws = getWatches();
  const activeW = getActiveWatch();

  // Status bar
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot ' + (activeW ? 'dot-active' : 'dot-none');
  document.getElementById('status-text').textContent = activeW ? 'Reloj activo' : 'Ningún reloj activo';
  document.getElementById('status-watch-name').textContent = activeW
    ? (activeW.brand + ' ' + activeW.model) : '';

  if (!ws.length) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  grid.style.display = 'grid';
  empty.style.display = 'none';

  grid.innerHTML = ws.map(w => {
    const isActive = !!w.wearStart;
    const locked = activeW && !isActive;
    const days = isActive ? daysSince(w.wearStart) : null;
    const emoji = watchEmoji(w.type);
    return `
      <div class="watch-card${locked ? ' locked' : ''}${isActive ? ' active-card' : ''}"
           onclick="openDetail('${w.id}')">
        <div class="watch-img-wrap">
          ${w.photo
            ? `<img src="${w.photo}" alt="${w.brand} ${w.model}" loading="lazy">`
            : `<div class="watch-img-placeholder">${emoji}</div>`}
          <div class="watch-type-badge">${typeLabel(w.type)}</div>
          ${isActive ? `<div class="active-badge">Puesto</div>` : ''}
        </div>
        <div class="watch-info">
          <div class="watch-brand">${escHtml(w.brand)}</div>
          <div class="watch-model">${escHtml(w.model)}</div>
          ${isActive ? `<div class="days-badge">Día ${days + 1}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ===== DETAIL ===== */

function openDetail(id) {
  currentWatchId = id;
  const w = getWatch(id);
  if (!w) return;

  document.getElementById('d-brand').textContent = w.brand;
  document.getElementById('d-name').textContent = w.model + (w.ref ? ` · ${w.ref}` : '');

  const img = document.getElementById('d-img');
  const placeholder = document.getElementById('d-img-placeholder');
  if (w.photo) {
    img.src = w.photo;
    img.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    img.style.display = 'none';
    placeholder.style.display = 'flex';
    placeholder.textContent = watchEmoji(w.type);
  }

  // Wear info
  const wearBox = document.getElementById('d-wear-info');
  if (w.wearStart) {
    wearBox.style.display = 'block';
    const d = daysSince(w.wearStart);
    document.getElementById('d-days').textContent = `${d + 1} ${d === 0 ? 'día' : 'días'}`;
    document.getElementById('d-since').textContent = `Desde el ${formatDate(w.wearStart)}`;
  } else {
    wearBox.style.display = 'none';
  }

  // Actions
  renderDetailActions(w);

  // Specs
  renderSpecs(w);

  // Price
  renderPrice(w);

  // Reset fetch status
  document.getElementById('d-fetch-status').innerHTML = '';

  showView('detail');
}

function renderDetailActions(w) {
  const div = document.getElementById('d-actions');
  const activeW = getActiveWatch();
  if (w.wearStart) {
    div.innerHTML = `
      <button class="action-btn btn-stop" onclick="handleStopWearing('${w.id}')">
        <i class="ti ti-player-stop" aria-hidden="true"></i> Quitarme este reloj
      </button>`;
  } else if (!activeW) {
    div.innerHTML = `
      <button class="action-btn btn-wear" onclick="handleStartWearing('${w.id}')">
        <i class="ti ti-wrist-watch" aria-hidden="true"></i> Ponerme este reloj
      </button>`;
  } else {
    div.innerHTML = `
      <div style="font-size:12px;color:var(--mid);text-align:center;padding:8px 0 14px;">
        Quítate el <strong>${escHtml(activeW.brand)} ${escHtml(activeW.model)}</strong> primero
      </div>`;
  }
}

function renderSpecs(w) {
  const specs = w.specs || {};
  const defs = [
    { k: 'calibre',      l: 'Calibre' },
    { k: 'movimiento',   l: 'Movimiento' },
    { k: 'cristal',      l: 'Cristal' },
    { k: 'brazalete',    l: 'Brazalete' },
    { k: 'esfera',       l: 'Esfera' },
    { k: 'caja',         l: 'Caja' },
    { k: 'resistencia',  l: 'Agua' },
    { k: 'reserva',      l: 'Reserva marcha' },
    { k: 'diametro',     l: 'Diámetro' },
    { k: 'grosor',       l: 'Grosor' },
  ];
  document.getElementById('d-specs').innerHTML = defs.map(s => `
    <div class="spec-card">
      <div class="spec-label">${s.l}</div>
      <div class="spec-value">${escHtml(specs[s.k] || '—')}</div>
    </div>`).join('');
}

function renderPrice(w) {
  const priceBox = document.getElementById('d-price-box');
  if (w.price && w.price.value) {
    priceBox.style.display = 'block';
    document.getElementById('d-price').textContent = w.price.value;
    document.getElementById('d-price-note').textContent = w.price.note || '';
  } else {
    priceBox.style.display = 'none';
  }
}

function handleStartWearing(id) {
  const w = getWatch(id);
  if (startWearing(id)) {
    showToast('¡Disfruta del ' + w.brand + ' ' + w.model + '!');
    openDetail(id);
  }
}

function handleStopWearing(id) {
  const w = getWatch(id);
  if (stopWearing(id)) {
    showToast('Intervalo registrado en el historial');
    showView('home');
  }
}

function handleDeleteWatch(id) {
  if (!confirm('¿Eliminar este reloj de la colección?')) return;
  deleteWatch(id);
  showView('home');
  showToast('Reloj eliminado');
}
// expose for inline onclick
window.deleteWatch = handleDeleteWatch;

/* ===== FETCH DETAILS (Worker) ===== */

async function fetchWatchDetails(id) {
  const w = getWatch(id);
  if (!w) return;

  const btn = document.getElementById('d-fetch-btn');
  const statusEl = document.getElementById('d-fetch-status');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Buscando información...';
  statusEl.innerHTML = '';

  try {
    const data = await apiFetchDetails(w.brand, w.model, w.ref || '', w.type);
    if (data.specs) updateWatch(id, { specs: data.specs });
    if (data.price) updateWatch(id, { price: data.price });
    const updated = getWatch(id);
    renderSpecs(updated);
    renderPrice(updated);
    statusEl.innerHTML = `<div class="fetch-status-ok"><i class="ti ti-check"></i> Información actualizada</div>`;
    showToast('Detalles encontrados');
  } catch (e) {
    statusEl.innerHTML = `<div class="fetch-status-err">Error: ${escHtml(e.message)}. Comprueba la URL del Worker en api.js.</div>`;
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-wand" aria-hidden="true"></i> Buscar información completa';
}
window.fetchWatchDetails = fetchWatchDetails;

/* ===== ADD / EDIT MODAL ===== */

function openAddModal() {
  editingWatchId = null;
  editingPhotoData = null;
  document.getElementById('modal-title-text').textContent = 'Añadir Reloj';
  document.getElementById('modal-save-btn').textContent = 'Guardar';
  document.getElementById('f-brand').value = '';
  document.getElementById('f-model').value = '';
  document.getElementById('f-ref').value = '';
  document.getElementById('f-type').value = 'automatic';
  document.getElementById('f-notes').value = '';
  document.getElementById('photo-preview').style.display = 'none';
  document.getElementById('identify-btn').style.display = 'none';
  document.getElementById('identify-status').innerHTML = '';
  document.getElementById('add-modal').style.display = 'flex';
}

function openEditModal(id) {
  const w = getWatch(id);
  if (!w) return;
  editingWatchId = id;
  editingPhotoData = w.photo || null;
  document.getElementById('modal-title-text').textContent = 'Editar Reloj';
  document.getElementById('modal-save-btn').textContent = 'Actualizar';
  document.getElementById('f-brand').value = w.brand;
  document.getElementById('f-model').value = w.model;
  document.getElementById('f-ref').value = w.ref || '';
  document.getElementById('f-type').value = w.type;
  document.getElementById('f-notes').value = w.notes || '';
  const prev = document.getElementById('photo-preview');
  if (w.photo) { prev.src = w.photo; prev.style.display = 'block'; }
  else { prev.style.display = 'none'; }
  document.getElementById('identify-btn').style.display = w.photo ? 'flex' : 'none';
  document.getElementById('identify-status').innerHTML = '';
  document.getElementById('add-modal').style.display = 'flex';
}
window.openEditModal = openEditModal;

function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
}

function closeModalIfOutside(e) {
  if (e.target.id === 'add-modal') closeAddModal();
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    // Resize to max 800px to save localStorage space
    resizeImage(ev.target.result, 800).then(resized => {
      editingPhotoData = resized;
      const prev = document.getElementById('photo-preview');
      prev.src = resized;
      prev.style.display = 'block';
      document.getElementById('identify-btn').style.display = 'flex';
    });
  };
  reader.readAsDataURL(file);
}

function resizeImage(dataUrl, maxSize) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = dataUrl;
  });
}

async function identifyWatch() {
  if (!editingPhotoData) return;
  const btn = document.getElementById('identify-btn');
  const status = document.getElementById('identify-status');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Identificando...';
  status.innerHTML = '';
  try {
    const base64 = editingPhotoData.split(',')[1];
    const mediaType = editingPhotoData.split(';')[0].split(':')[1];
    const info = await apiIdentifyWatch(base64, mediaType);
    if (info.brand && info.brand !== 'Desconocido') {
      document.getElementById('f-brand').value = info.brand;
      document.getElementById('f-model').value = info.model || '';
      if (info.ref) document.getElementById('f-ref').value = info.ref;
      if (info.type) document.getElementById('f-type').value = info.type;
      status.innerHTML = `
        <div class="identified-info">
          <i class="ti ti-sparkles" style="color:var(--gold)"></i>
          <strong>${escHtml(info.brand)} ${escHtml(info.model || '')}</strong>
          ${info.ref ? `· Ref. ${escHtml(info.ref)}` : ''}
          — Confianza: ${escHtml(info.confidence || 'media')}
        </div>`;
    } else {
      status.innerHTML = `<div class="identified-info">No pude identificar el reloj con certeza. Introduce los datos manualmente.</div>`;
    }
  } catch (e) {
    status.innerHTML = `<div style="font-size:12px;color:rgba(220,80,80,0.8);padding:8px 0;">
      Error: ${escHtml(e.message)}. Comprueba que el Worker esté desplegado.
    </div>`;
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-sparkles" aria-hidden="true"></i> Identificar reloj con IA';
}

function saveWatch() {
  const brand = document.getElementById('f-brand').value.trim();
  const model = document.getElementById('f-model').value.trim();
  if (!brand || !model) { showToast('Introduce marca y modelo'); return; }

  if (editingWatchId) {
    updateWatch(editingWatchId, {
      brand, model,
      ref: document.getElementById('f-ref').value.trim(),
      type: document.getElementById('f-type').value,
      notes: document.getElementById('f-notes').value.trim(),
      photo: editingPhotoData
    });
    closeAddModal();
    showToast('Reloj actualizado');
    openDetail(editingWatchId);
  } else {
    addWatch({
      brand, model,
      ref: document.getElementById('f-ref').value.trim(),
      type: document.getElementById('f-type').value,
      notes: document.getElementById('f-notes').value.trim(),
      photo: editingPhotoData
    });
    closeAddModal();
    showToast(brand + ' ' + model + ' añadido');
    renderHome();
  }
}

/* ===== HISTORY ===== */

function renderHistory() {
  const sel = document.getElementById('history-selector');
  const ws = getWatches();
  if (!ws.length) {
    document.getElementById('history-body').innerHTML =
      `<div class="history-empty"><i class="ti ti-clock" style="font-size:40px;color:var(--mid);"></i><br><br>No hay relojes en la colección</div>`;
    sel.innerHTML = '';
    return;
  }
  if (!historySelectedWatch || !getWatch(historySelectedWatch)) {
    historySelectedWatch = ws[0].id;
  }
  sel.innerHTML = ws.map(w => `
    <div class="hw-chip${w.id === historySelectedWatch ? ' active' : ''}"
         onclick="selectHistoryWatch('${w.id}')">
      ${escHtml(w.brand)} ${escHtml(w.model)}
    </div>`).join('');
  renderHistoryBody();
}

function selectHistoryWatch(id) {
  historySelectedWatch = id;
  historySelectedYear = null;
  renderHistory();
}
window.selectHistoryWatch = selectHistoryWatch;

function renderHistoryBody() {
  const w = getWatch(historySelectedWatch);
  const body = document.getElementById('history-body');
  if (!w) { body.innerHTML = ''; return; }

  const allIntervals = [...(w.history || [])];
  if (w.wearStart) allIntervals.push({ start: w.wearStart, end: Date.now(), active: true });

  if (!allIntervals.length) {
    body.innerHTML = `<div class="history-empty"><i class="ti ti-calendar-x" style="font-size:36px;color:var(--mid);"></i><br><br>Aún no has usado este reloj</div>`;
    return;
  }

  // Stats summary
  const totalDays = allIntervals.reduce((acc, i) => acc + Math.max(1, daysSince(i.start)), 0);
  const totalSessions = allIntervals.length;

  const years = [...new Set(allIntervals.map(i => new Date(i.start).getFullYear()))].sort((a, b) => b - a);
  if (!historySelectedYear) historySelectedYear = years[0];

  const yearTabs = `<div class="year-tabs">
    ${years.map(y => `<div class="year-tab${y === historySelectedYear ? ' active' : ''}" onclick="selectHistoryYear(${y})">${y}</div>`).join('')}
  </div>`;

  const summary = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
    <div class="spec-card"><div class="spec-label">Total sesiones</div><div class="spec-value">${totalSessions}</div></div>
    <div class="spec-card"><div class="spec-label">Total días</div><div class="spec-value">${totalDays}</div></div>
  </div>`;

  const filtered = allIntervals.filter(i => new Date(i.start).getFullYear() === historySelectedYear);
  const byMonth = {};
  filtered.forEach(i => {
    const m = new Date(i.start).toLocaleDateString('es-ES', { month: 'long' });
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(i);
  });

  const monthsHTML = Object.entries(byMonth).map(([month, intervals]) => `
    <div class="month-group">
      <div class="month-label">${month}</div>
      ${intervals.map(i => {
        const d = Math.max(1, daysSince(i.start));
        return `<div class="interval-row">
          <div class="interval-dates">${formatDate(i.start)} → ${i.active ? 'hoy' : formatDate(i.end)}</div>
          <div class="interval-duration">${d}d${i.active ? ' <span style="color:#4CAF50">●</span>' : ''}</div>
        </div>`;
      }).join('')}
    </div>`).join('');

  body.innerHTML = summary + yearTabs + monthsHTML;
}

function selectHistoryYear(y) {
  historySelectedYear = y;
  renderHistoryBody();
}
window.selectHistoryYear = selectHistoryYear;

/* ===== INIT ===== */

// Splash
setTimeout(() => {
  document.getElementById('intro').classList.add('fade');
  setTimeout(() => document.getElementById('intro').style.display = 'none', 600);
}, 1600);

renderHome();

// Expose globals needed by inline HTML handlers
window.showView = showView;
window.openAddModal = openAddModal;
window.closeAddModal = closeAddModal;
window.closeModalIfOutside = closeModalIfOutside;
window.openDetail = openDetail;
window.handlePhotoUpload = handlePhotoUpload;
window.identifyWatch = identifyWatch;
window.saveWatch = saveWatch;
window.handleStartWearing = handleStartWearing;
window.handleStopWearing = handleStopWearing;
window.fetchWatchDetails = fetchWatchDetails;
window.openEditModal = openEditModal;
