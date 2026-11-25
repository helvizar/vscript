// Saves and loads all episodes in localStorage (debounced 500ms), with JSON backup export/import.
// Also builds the clean recording script text. Swap this one file for a REST API in V2.

import { ACTS, createEpisode, createSampleEpisode } from './schema.js';

const KEY = 'vscript_episodes_v1';
const DEBOUNCE_MS = 500;
const CUE = /\[[^\]]+\]/g;

let cache = null;
let timer = null;
const listeners = new Set();

const emit = (status) => listeners.forEach((fn) => fn(status));

// fn receives 'saving' | 'saved' | 'error'. Returns an unsubscribe function.
export const onSaveStatus = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const flush = () => {
  clearTimeout(timer);
  timer = null;
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
    emit('saved');
  } catch {
    emit('error'); // quota full or storage blocked; data stays in memory
  }
};

const schedule = () => {
  emit('saving');
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
};

const load = () => {
  if (cache) return cache;
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return (cache = list);
    }
  } catch {
    // corrupt data: keep a copy before it gets overwritten
    try {
      localStorage.setItem(`${KEY}_corrupt_backup`, raw);
    } catch {
      /* nothing more we can do */
    }
  }
  cache = [createSampleEpisode()]; // first launch (or unreadable data)
  flush();
  return cache;
};

// Don't lose the last edit if the tab closes inside the debounce window.
if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);

export const getAllEpisodes = async () => structuredClone(load());

export const saveEpisode = async (episode) => {
  const list = load();
  const saved = { ...episode, updatedAt: Date.now() };
  const i = list.findIndex((e) => e.id === saved.id);
  if (i < 0) list.push(saved);
  else list[i] = saved;
  schedule();
  return structuredClone(saved);
};

export const deleteEpisode = async (id) => {
  cache = load().filter((e) => e.id !== id);
  schedule();
};

export const exportAll = async () =>
  JSON.stringify(
    { app: 'vscript', version: 1, exportedAt: new Date().toISOString(), episodes: load() },
    null,
    2,
  );

// Accepts a JSON string, a bare episode array, or an exportAll() object.
// Merges by id (same id = overwrite) so an import never wipes other episodes. Returns count imported.
export const importAll = async (input) => {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  const list = Array.isArray(data) ? data : data?.episodes;
  if (!Array.isArray(list)) throw new Error('Invalid backup: expected an array of episodes.');
  if (list.some((e) => !e || typeof e.id !== 'string' || !Array.isArray(e.blocks))) {
    throw new Error('Invalid backup: every episode needs a string "id" and a "blocks" array.');
  }
  const merged = new Map(load().map((e) => [e.id, e]));
  list.forEach((e) => merged.set(e.id, { ...createEpisode(), ...e })); // fills fields missing in old backups
  cache = [...merged.values()];
  flush();
  return list.length;
};

// Plain-text script for recording: grouped by act, each block headed by its vocal register and cue list.
export const formatRecordingScript = (episode) => {
  const registers = new Map(episode.registers.map((r) => [r.id, r]));
  const out = [episode.title, ''];
  for (const act of ACTS) {
    const blocks = episode.blocks.filter((b) => b.actId === act.id && b.text.trim());
    if (!blocks.length) continue;
    out.push(`=== ${act.title} ===`, '');
    for (const b of blocks) {
      const r = registers.get(b.registerId);
      const cues = b.text.match(CUE) ?? [];
      const tags = [b.zone === 'expansion' && 'EXPANSION', b.label].filter(Boolean);
      out.push(`>> VOICE: ${r ? `${r.name} (${r.wpm} WPM)` : 'Unknown register'}${tags.map((t) => ` | ${t}`).join('')}`);
      if (cues.length) out.push(`   CUES: ${cues.join(' ')}`);
      out.push(b.text.trim(), '');
    }
  }
  return out.join('\n').trimEnd();
};
