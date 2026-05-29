/**
 * sync.js — Cloud sync via Cloudflare KV
 *
 * Strategy: "last-write-wins" with timestamp comparison.
 * Photos (base64) are included — KV limit is 25MB per value, plenty for a watch collection.
 *
 * Usage:
 *   syncPush()  — upload local data to cloud
 *   syncPull()  — download cloud data to local
 *   syncAuto()  — pull on load, push on every save
 */

const SYNC_KEY        = 'horlogerie_sync_meta';   // localStorage key for sync metadata
const SYNC_STATUS_EL  = 'sync-status-indicator';

/* ── Metadata helpers ── */
function getSyncMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch { return {}; }
}
function setSyncMeta(data) {
  localStorage.setItem(SYNC_KEY, JSON.stringify({ ...getSyncMeta(), ...data }));
}

/* ── UI indicator ── */
function setSyncUI(state, msg) {
  // state: 'syncing' | 'ok' | 'error' | 'idle'
  const el = document.getElementById(SYNC_STATUS_EL);
  if (!el) return;
  const icons = { syncing: 'ti-refresh', ok: 'ti-cloud-check', error: 'ti-cloud-x', idle: 'ti-cloud' };
  const colors = { syncing: 'var(--mid)', ok: '#4CAF50', error: 'rgba(220,80,80,0.8)', idle: 'var(--mid)' };
  el.innerHTML = `<i class="ti ${icons[state] || 'ti-cloud'}" style="color:${colors[state]};font-size:18px;${state==='syncing'?'animation:spin 1s linear infinite;':''}"></i>`;
  el.title = msg || '';
}

/* ══════════════════════════════════════
   PUSH — local → cloud
══════════════════════════════════════ */
async function syncPush() {
  setSyncUI('syncing', 'Guardando en la nube…');
  try {
    const ws = getWatches();
    const res = await fetch(`${CONFIG.WORKER_URL}/sync/push`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ watches: ws })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setSyncMeta({ lastPush: data.updatedAt, lastPushCount: data.count });
    setSyncUI('ok', `Sincronizado · ${new Date(data.updatedAt).toLocaleTimeString('es-ES')}`);
    return true;
  } catch(e) {
    setSyncUI('error', 'Error al guardar: ' + e.message);
    console.warn('[sync] push failed:', e.message);
    return false;
  }
}

/* ══════════════════════════════════════
   PULL — cloud → local
══════════════════════════════════════ */
async function syncPull(silent = false) {
  if (!silent) setSyncUI('syncing', 'Sincronizando…');
  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/sync/pull`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();

    if (!data.watches || !data.watches.length) {
      setSyncUI('ok', 'Sin datos en la nube aún');
      return false;
    }

    const localUpdated = getSyncMeta().lastPush || 0;
    const cloudUpdated = data.updatedAt || 0;

    // Cloud is newer — overwrite local
    if (cloudUpdated > localUpdated) {
      // Merge strategy: cloud wins on conflict (same ID), but keep local-only watches
      const cloudIds  = new Set(data.watches.map(w => w.id));
      const localOnly = getWatches().filter(w => !cloudIds.has(w.id));
      const merged    = [...data.watches, ...localOnly];

      // Write directly to the watches array and persist
      watches.length = 0;
      merged.forEach(w => watches.push(w));
      save();

      setSyncMeta({ lastPush: cloudUpdated });
      setSyncUI('ok', `Actualizado · ${new Date(cloudUpdated).toLocaleTimeString('es-ES')}`);
      if (!silent) showToast('Colección sincronizada desde la nube');
      return true;
    } else {
      setSyncUI('ok', 'Ya estás al día');
      return false;
    }
  } catch(e) {
    if (!silent) setSyncUI('error', 'Error al sincronizar: ' + e.message);
    console.warn('[sync] pull failed:', e.message);
    return false;
  }
}

/* ══════════════════════════════════════
   AUTO SYNC — call on app init
══════════════════════════════════════ */
async function syncAuto() {
  // Pull on startup (silently)
  const pulled = await syncPull(true);
  if (pulled) renderHome();
  setSyncUI('idle', 'Toca para sincronizar');

  // Patch save() to auto-push after every local write
  const _origSave = window._origSave || save;
  window._origSave = _origSave;

  // Debounced push — don't push on every keystroke, wait 2s after last save
  let _pushTimer = null;
  window._debouncedPush = function() {
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => syncPush(), 2000);
  };
}

/* ══════════════════════════════════════
   MANUAL SYNC TRIGGER (settings button)
══════════════════════════════════════ */
async function syncManual() {
  setSyncUI('syncing', 'Sincronizando…');
  const pulled = await syncPull(false);
  if (pulled) { renderHome(); renderSettings(); }
  await syncPush();
  showToast('Sincronización completada');
}
window.syncManual = syncManual;

window.syncPush = syncPush;
window.syncPull = syncPull;
window.syncAuto = syncAuto;
