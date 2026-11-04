import {parseOfflineSave, slotKey} from './offline-save.js';

export const SLOT_COUNT = 10;
export function deleteSlot(storage, slot) {
  storage.removeItem(slotKey(slot));
}
export function exportSlots(storage) {
  const slots = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    const raw = storage.getItem(slotKey(slot));
    if (parseOfflineSave(raw)) slots.push({slot, save: JSON.parse(raw)});
  }
  return {format:'forest-chopper-slots', version:1, slots};
}
export function parseSlotArchive(text) {
  if (typeof text !== 'string' || text.length > 40_000_000) throw new Error('Файл слишком большой');
  const data = JSON.parse(text);
  if (data?.format !== 'forest-chopper-slots' || data.version !== 1 || !Array.isArray(data.slots) || data.slots.length > SLOT_COUNT) throw new Error('Неверный формат файла');
  const seen = new Set();
  for (const entry of data.slots) {
    if (!entry || !Number.isInteger(entry.slot) || entry.slot < 1 || entry.slot > SLOT_COUNT || seen.has(entry.slot) || !parseOfflineSave(JSON.stringify(entry.save))) throw new Error('Некорректное сохранение');
    seen.add(entry.slot);
  }
  return data.slots;
}
export function importSlots(storage, entries) {
  const previous = entries.map(({slot}) => [slotKey(slot), storage.getItem(slotKey(slot))]);
  try {
    for (const {slot, save} of entries) storage.setItem(slotKey(slot), JSON.stringify(save));
  } catch (error) {
    // Free space occupied by partially imported snapshots before restoring originals.
    for (const [key] of previous) { try { storage.removeItem(key); } catch {} }
    for (const [key, value] of previous) {
      try { if (value !== null) storage.setItem(key, value); } catch { /* report failure below */ }
    }
    throw error;
  }
}
