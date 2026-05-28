/**
 * storage.js — Persistent data layer using localStorage
 * All watch data lives here. Call save() after any mutation.
 */

const DB_KEY = 'horlogerie_v2';

let watches = [];

function loadData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    watches = raw ? JSON.parse(raw) : [];
  } catch (e) {
    watches = [];
  }
}

function save() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(watches));
  } catch (e) {
    // storage full — photos take space, warn user
    showToast('⚠️ Almacenamiento lleno. Elimina algún reloj.');
  }
}

function getWatches() { return watches; }

function getWatch(id) { return watches.find(w => w.id === id) || null; }

function addWatch(data) {
  const w = {
    id: 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    brand: data.brand,
    model: data.model,
    ref: data.ref || '',
    type: data.type || 'automatic',
    notes: data.notes || '',
    photo: data.photo || null,
    specs: {},
    price: null,
    history: [],
    wearStart: null,
    created: Date.now()
  };
  watches.push(w);
  save();
  return w;
}

function updateWatch(id, changes) {
  const w = getWatch(id);
  if (!w) return null;
  Object.assign(w, changes);
  save();
  return w;
}

function deleteWatch(id) {
  watches = watches.filter(w => w.id !== id);
  save();
}

function getActiveWatch() {
  return watches.find(w => w.wearStart) || null;
}

function startWearing(id) {
  const active = getActiveWatch();
  if (active && active.id !== id) return false; // already have one
  const w = getWatch(id);
  if (!w || w.wearStart) return false;
  w.wearStart = Date.now();
  save();
  return true;
}

function stopWearing(id) {
  const w = getWatch(id);
  if (!w || !w.wearStart) return false;
  if (!w.history) w.history = [];
  w.history.push({ start: w.wearStart, end: Date.now() });
  w.wearStart = null;
  save();
  return true;
}

// Init on load
loadData();
