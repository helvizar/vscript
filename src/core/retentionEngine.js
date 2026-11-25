// Works out how long a script runs (speech by register WPM plus pause/cue buffers), splits core from expansion time, and picks the target zone.
// Also flags long static stretches with no variety, and scores how well the title/thumbnail promise matches the opening hook.

import { ACTS, ZONES } from './schema.js';

export const CUE_BUFFER_SECONDS = { SFX: 3, PROXIMITY: 4, 'RE-HOOK': 2 };
export const MONOTONY_LIMIT_SECONDS = 150; // 2.5 minutes
export const HOOK_WINDOW_SECONDS = 20;
const FALLBACK_WPM = 105; // used when a block points at a deleted register
const COMPACT_SECONDS = 480; // 8 min
const SWEET_SPOT_SECONDS = 600; // 10 min

// ---------- parsing ----------

const PAUSE = /^\[PAUSE\s+(\d+(?:\.\d+)?)\s*s?\]$/i;
const CUE = /^\[(SFX|PROXIMITY|RE-HOOK)\b/i;

const wpmOf = (ep, registerId) => {
  const wpm = ep.registers.find((r) => r.id === registerId)?.wpm;
  return wpm > 0 ? wpm : FALLBACK_WPM;
};

// Splits block text into timed pieces: speech, pause, cue. Unknown [tags] are ignored (zero time, not counted as words).
export const scanBlock = (text = '', wpm = FALLBACK_WPM) =>
  text.split(/(\[[^\]]*\])/).flatMap((part, i) => {
    if (i % 2) {
      const pause = part.match(PAUSE);
      if (pause) return [{ type: 'pause', seconds: Number(pause[1]) }];
      const cue = part.match(CUE);
      if (cue) {
        const name = cue[1].toUpperCase();
        return [{ type: 'cue', cue: name, seconds: CUE_BUFFER_SECONDS[name] }];
      }
      return [];
    }
    const words = part.split(/\s+/).filter(Boolean);
    return words.length ? [{ type: 'speech', words, seconds: (words.length * 60) / wpm }] : [];
  });

const sumSeconds = (pieces) => pieces.reduce((a, p) => a + p.seconds, 0);

// Blocks in act order (array order inside an act).
export const orderedBlocks = (ep) => ACTS.flatMap((a) => ep.blocks.filter((b) => b.actId === a.id));

export const formatTime = (sec) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- duration ----------

export const calcDuration = (ep) => {
  const perBlock = {};
  const perAct = {};
  const timeline = [];
  let t = 0;
  let core = 0;
  let expansion = 0;
  for (const b of orderedBlocks(ep)) {
    const s = sumSeconds(scanBlock(b.text, wpmOf(ep, b.registerId)));
    perBlock[b.id] = s;
    perAct[b.actId] = (perAct[b.actId] ?? 0) + s;
    timeline.push({ blockId: b.id, actId: b.actId, label: b.label, start: t, end: t + s });
    t += s;
    if (b.zone === ZONES.EXPANSION) expansion += s;
    else core += s;
  }
  return { totalSeconds: t, coreSeconds: core, expansionSeconds: expansion, perBlock, perAct, timeline };
};

export const evaluateZone = (totalSeconds) => {
  if (totalSeconds < COMPACT_SECONDS) return { id: 'under', label: 'Under-Target (Needs Core Beats)' };
  if (totalSeconds < SWEET_SPOT_SECONDS) {
    const more = Math.ceil((SWEET_SPOT_SECONDS - totalSeconds) / 60);
    return { id: 'compact', label: `Compact / Ready to Record (+${more}m to hit Sweet Spot)` };
  }
  return { id: 'sweet', label: 'Algorithm Sweet Spot (Optimal Watch Time)' };
};

// ---------- static-visual monotony guard ----------

// A stretch = consecutive speech/pause time in one register with no [SFX], [PROXIMITY] or [RE-HOOK] cue.
// A register change or a cue ends the stretch. Stretches over the limit are flagged once each.
export const findMonotony = (ep, limit = MONOTONY_LIMIT_SECONDS) => {
  const warnings = [];
  let streak = 0;
  let first = null;
  let last = null;
  const close = () => {
    if (streak > limit) {
      warnings.push({ startBlockId: first.id, endBlockId: last.id, seconds: Math.round(streak) });
    }
    streak = 0;
    first = null;
  };
  for (const b of orderedBlocks(ep)) {
    if (last && b.registerId !== last.registerId) close(); // ends at the previous block
    last = b;
    for (const p of scanBlock(b.text, wpmOf(ep, b.registerId))) {
      if (p.type === 'cue') {
        close();
        continue;
      }
      first ??= b;
      streak += p.seconds;
    }
  }
  if (last) close();
  return warnings;
};

// ---------- packaging-to-hook alignment ----------

const STOP = new Set(
  ('the and for with you your youre youd youll youve are was were this that have has had not but from they them their ' +
    'his her she him its our out all can will just into what when who how why where ill dont cant wont ' +
    'asmr roleplay m4f f4m part episode').split(' '),
);

const stem = (w) => (w.length > 4 ? w.slice(0, 4) : w);

const keywords = (s = '') =>
  (
    s
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, ' ') // drop [M4F] style tags
      .replace(/['’]/g, '')
      .match(/[a-z0-9]+/g) ?? []
  ).filter((w) => w.length >= 3 && !STOP.has(w));

// Spoken words of Act 1 that fall inside the first `windowSec` seconds.
export const openingHook = (ep, windowSec = HOOK_WINDOW_SECONDS) => {
  let t = 0;
  const words = [];
  for (const b of ep.blocks.filter((x) => x.actId === ACTS[0].id)) {
    for (const p of scanBlock(b.text, wpmOf(ep, b.registerId))) {
      if (t >= windowSec) return words.join(' ');
      if (p.type === 'speech') {
        const perWord = p.seconds / p.words.length;
        words.push(...p.words.slice(0, Math.ceil((windowSec - t) / perWord)));
      }
      t += p.seconds;
    }
  }
  return words.join(' ');
};

// Score 0-100: share of title + thumbnail keywords (thumbnail counts double) that the first 20s of Act 1 also says.
export const scoreAlignment = (ep) => {
  const weights = new Map();
  for (const w of keywords(ep.title)) weights.set(w, 1);
  for (const w of keywords(ep.thumbnailText)) weights.set(w, 2);
  const hook = openingHook(ep);
  const hookStems = new Set(keywords(hook).map(stem));
  let total = 0;
  let hit = 0;
  const matched = [];
  const missing = [];
  for (const [w, weight] of weights) {
    total += weight;
    if (hookStems.has(stem(w))) {
      hit += weight;
      matched.push(w);
    } else missing.push(w);
  }
  return { score: total ? Math.round((hit / total) * 100) : 0, matched, missing, hook };
};

// ---------- one call for the UI ----------

export const analyzeEpisode = (ep) => {
  const duration = calcDuration(ep);
  return {
    duration,
    zone: evaluateZone(duration.totalSeconds),
    monotony: findMonotony(ep),
    alignment: scoreAlignment(ep),
  };
};
