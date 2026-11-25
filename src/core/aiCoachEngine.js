// Scores title/SEO completeness and finds patterns across uploaded episodes (mood, hook style, length vs CTR, retention, view duration).
// Also builds ready-to-paste AI prompts for title/SEO, script expansion, and post-upload diagnosis.

import { ACTS, ZONES } from './schema.js';
import {
  analyzeEpisode,
  calcDuration,
  evaluateZone,
  formatTime,
  orderedBlocks,
  scoreAlignment,
} from './retentionEngine.js';

const SWEET_SPOT_SECONDS = 600;
const r1 = (n) => Math.round(n * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const val = (v, unit = '') => (v == null || v === '' ? 'n/a' : `${v}${unit}`);
const line = (label, v, unit) => `- ${label}: ${val(v, unit)}`;
const actTitle = (id) => ACTS.find((a) => a.id === id)?.title ?? id;
const words = (s) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

// ---------- local coach: SEO completeness + packaging alignment ----------

export const coachEpisode = (ep) => {
  const alignment = scoreAlignment(ep);
  const title = ep.title ?? '';
  const thumbWords = words(ep.thumbnailText);
  const chapterLines = (ep.chapters ?? '').split('\n').map((l) => l.trim()).filter((l) => /^\d{1,2}:\d{2}/.test(l));
  const missing = alignment.missing.slice(0, 5).join(', ');

  const checks = [
    { id: 'm4f', points: 15, pass: /^\s*\[M4F\]/i.test(title), tip: 'Start the title with [M4F] so the right audience finds it.' },
    { id: 'titleLength', points: 15, pass: title.length >= 30 && title.length <= 100, tip: 'Keep the title between 30 and 100 characters; long titles get cut off in search.' },
    { id: 'thumbnailText', points: 15, pass: thumbWords >= 1 && thumbWords <= 4, tip: 'Thumbnail text needs 1-4 words so it reads at phone size.' },
    { id: 'description', points: 15, pass: (ep.description ?? '').length >= 150, tip: 'Write a description of at least 150 characters; the first two lines act as the search snippet.' },
    { id: 'tags', points: 15, pass: (ep.tags ?? []).length >= 5, tip: 'Add at least 5 tags.' },
    { id: 'chapters', points: 15, pass: chapterLines.length >= 3 && /^0{1,2}:00/.test(chapterLines[0]), tip: 'Add at least 3 chapters, the first at 0:00, so YouTube shows chapter markers.' },
    {
      id: 'alignment',
      points: 10,
      pass: alignment.score >= 50,
      tip: alignment.missing.length
        ? `The first 20 seconds of Act 1 never mention: ${missing}. Say the title/thumbnail promise early, or change the packaging.`
        : 'Add keywords to the title and thumbnail text, then make sure Act 1 answers them in the first 20 seconds.',
    },
  ];

  return {
    seoScore: checks.reduce((sum, c) => sum + (c.pass ? c.points : 0), 0),
    checks,
    tips: checks.filter((c) => !c.pass).map((c) => c.tip),
    alignment,
  };
};

// ---------- local pattern engine: uploaded episodes ----------

const METRICS = [
  { key: 'ctr', label: 'CTR', unit: '%', get: (e) => e.analytics?.discovery?.ctr },
  { key: 'retention30s', label: '30s retention', unit: '%', get: (e) => e.analytics?.retention?.retention30s },
  { key: 'avdSeconds', label: 'average view duration', unit: 's', get: (e) => e.analytics?.retention?.avdSeconds },
];

const ZONE_SHORT = { under: 'under 8 min', compact: '8-10 min', sweet: '10+ min' };

const DIMENSIONS = [
  { name: 'mood', label: 'Mood', key: (e) => e.mood?.trim() },
  { name: 'hookStyle', label: 'Hook style', key: (e) => e.hookStyle?.trim() },
  { name: 'length', label: 'Script length', key: (e) => ZONE_SHORT[evaluateZone(calcDuration(e).totalSeconds).id] },
];

const avg = (values) => {
  const nums = values.filter(isNum);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

const hasData = (e) => e.uploaded && METRICS.some((m) => isNum(m.get(e)));

const groupBy = (eps, keyFn) => {
  const map = new Map();
  for (const e of eps) {
    const k = keyFn(e);
    if (!k) continue;
    const id = k.toLowerCase();
    if (!map.has(id)) map.set(id, { label: k, items: [] });
    map.get(id).items.push(e);
  }
  return [...map.values()].map(({ label, items }) => ({
    label,
    n: items.length,
    ...Object.fromEntries(METRICS.map((m) => [m.key, avg(items.map(m.get))])),
  }));
};

const topRequests = (eps) => {
  const counts = new Map();
  for (const e of eps) {
    for (const raw of (e.analytics?.audience?.topRequests ?? '').split(/[\n,;]+/)) {
      const t = raw.trim().toLowerCase();
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 5);
};

// Needs 2+ uploaded episodes with at least one metric filled in. lowConfidence = under 5 episodes.
export const findPatterns = (episodes) => {
  const eps = episodes.filter(hasData);
  const overall = Object.fromEntries(METRICS.map((m) => [m.key, avg(eps.map(m.get))]));
  const groups = {};
  const insights = [];

  if (eps.length < 2) {
    insights.push('Need at least 2 uploaded episodes with analytics to find patterns.');
  } else {
    for (const d of DIMENSIONS) {
      const g = groupBy(eps, d.key);
      groups[d.name] = g;
      if (g.length < 2) continue;
      for (const m of METRICS) {
        const ranked = g.filter((x) => isNum(x[m.key])).sort((a, b) => b[m.key] - a[m.key]);
        if (ranked.length < 2) continue;
        const best = ranked[0];
        insights.push(
          `${d.label} "${best.label}" leads on ${m.label}: ${r1(best[m.key])}${m.unit} vs ${r1(overall[m.key])}${m.unit} overall (${best.n} episode${best.n > 1 ? 's' : ''}).`,
        );
      }
    }
  }
  return { sampleSize: eps.length, lowConfidence: eps.length < 5, overall, groups, insights, topRequests: topRequests(eps) };
};

// ---------- prompt bridge ----------

const patternsBlock = (episodes, currentId) => {
  const p = findPatterns(episodes.filter((e) => e.id !== currentId));
  const requests = p.topRequests.map((q) => `${q.text} (x${q.count})`).join(', ');
  return [
    `HISTORICAL PATTERNS (${p.sampleSize} uploaded episodes with data${p.lowConfidence ? ', small sample, treat as hints only' : ''})`,
    ...p.insights.map((i) => `- ${i}`),
    requests && `- Most requested by viewers: ${requests}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const actStarts = (ep) => {
  const { timeline } = calcDuration(ep);
  return ACTS.flatMap((a) => {
    const t = timeline.find((x) => x.actId === a.id);
    return t ? [`${a.title}: ${formatTime(t.start)}`] : [];
  });
};

export const buildTitleSeoPrompt = (ep, episodes = []) => {
  const { alignment, seoScore, tips } = coachEpisode(ep);
  return [
    'You are a YouTube packaging and SEO strategist for [M4F] ASMR roleplay and voice acting channels. The video uses one static AI-generated image (no face cam). Write all output in English.',
    '',
    'CURRENT DRAFT',
    line('Title', ep.title),
    line('Thumbnail text', ep.thumbnailText),
    line('Mood', ep.mood),
    line('Hook style', ep.hookStyle),
    line('Tags', (ep.tags ?? []).join(', ')),
    line('Description', ep.description),
    `- First 20 seconds of script: "${alignment.hook}"`,
    `- Packaging-to-hook alignment: ${alignment.score}/100${alignment.missing.length ? ` (not said in the hook: ${alignment.missing.join(', ')})` : ''}`,
    `- SEO completeness: ${seoScore}/100`,
    ...tips.map((t) => `  * ${t}`),
    '',
    'SCRIPT ACT START TIMES (estimated, use for chapters)',
    ...actStarts(ep).map((s) => `- ${s}`),
    '',
    patternsBlock(episodes, ep.id),
    '',
    'TASK',
    '1. Give 5 title options. Each starts with [M4F], stays under 100 characters, and promises something the first 20 seconds deliver.',
    '2. Give 5 thumbnail text options of 1-4 words.',
    '3. Write a description (the first two lines work as the search snippet), 10 tags, and chapter timestamps starting at 0:00.',
    '4. Recommend one title + thumbnail pair and say why, using the historical patterns where they apply.',
  ].join('\n');
};

export const buildScriptCoachPrompt = (ep, episodes = []) => {
  const { duration, zone, monotony } = analyzeEpisode(ep);
  const ordered = orderedBlocks(ep);
  const index = (id) => ordered.findIndex((b) => b.id === id) + 1;
  const regName = (id) => ep.registers.find((x) => x.id === id)?.name ?? 'Unknown register';
  const gap = Math.max(0, SWEET_SPOT_SECONDS - duration.totalSeconds);
  const timeOf = Object.fromEntries(duration.timeline.map((t) => [t.blockId, t]));

  return [
    'You are a script coach for [M4F] ASMR roleplay and voice acting. The video uses one static AI-generated image, so the script itself must keep the listener engaged. Write all output in English.',
    '',
    'VOCAL REGISTERS',
    ...ep.registers.map((x) => `- ${x.name}: ${x.wpm} WPM`),
    '',
    'CURRENT DURATION',
    `- Total: ${formatTime(duration.totalSeconds)} (core ${formatTime(duration.coreSeconds)}, expansion ${formatTime(duration.expansionSeconds)})`,
    `- Zone: ${zone.label}`,
    `- Missing to reach the 10:00 sweet spot: ${gap ? formatTime(gap) : 'none'}`,
    '',
    'STATIC-VISUAL WARNINGS (over 2:30 with no register switch, [RE-HOOK], [SFX] or [PROXIMITY] cue)',
    ...(monotony.length
      ? monotony.map((w) => `- ${formatTime(w.seconds)} stretch from block ${index(w.startBlockId)} to block ${index(w.endBlockId)}`)
      : ['- none']),
    '',
    'SCRIPT BLOCKS',
    ...ordered.map((b, i) => {
      const t = timeOf[b.id];
      const label = b.label ? ` | ${b.label}` : '';
      return `Block ${i + 1} | ${actTitle(b.actId)} | ${regName(b.registerId)} | ${b.zone === ZONES.EXPANSION ? 'Expansion' : 'Core'} | ${formatTime(t.start)}-${formatTime(t.end)}${label}\n${b.text || '(empty)'}`;
    }),
    '',
    patternsBlock(episodes, ep.id),
    '',
    'TASK',
    `1. Propose Expansion Slots (for example Inner Monologue, Proximity ASMR Trigger, Extended Confrontation) worth about ${gap ? formatTime(gap) : 'any extra time you judge useful'} so the episode lands in the 10-15 minute range. No filler: each slot must add emotion or tension.`,
    '2. Fix every static-visual warning with a register switch or a cue.',
    '3. Check Act 3 and Act 4 each open with a [RE-HOOK] that escalates tension.',
    '4. Keep the tag syntax exactly: [PAUSE 3s], [SFX: rain], [PROXIMITY], [RE-HOOK].',
    '5. Return the new text per block number, marked Core or Expansion. Leave lines that already work unchanged.',
  ].join('\n');
};

// Maps dip/spike timestamps (m:ss) to the script block that was playing, using the script's estimated timeline.
const dipLines = (ep, duration) => {
  const text = ep.analytics?.retention?.dipSpikeTimestamps ?? '';
  return [...text.matchAll(/(\d{1,3}):(\d{2})/g)].map(([raw, m, s]) => {
    const sec = Number(m) * 60 + Number(s);
    const hit = duration.timeline.find((t) => sec >= t.start && sec < t.end);
    const block = hit && ep.blocks.find((b) => b.id === hit.blockId);
    return block
      ? `- ${raw}: "${block.label || actTitle(block.actId)}" in ${actTitle(block.actId)}: "${block.text.slice(0, 120)}..."`
      : `- ${raw}: past the scripted length (recording may differ from the script)`;
  });
};

export const buildDiagnosisPrompt = (ep, episodes = []) => {
  const { duration, zone } = analyzeEpisode(ep);
  const a = ep.analytics ?? {};
  const d = a.discovery ?? {};
  const rt = a.retention ?? {};
  const au = a.audience ?? {};
  const { overall } = findPatterns(episodes.filter((e) => e.id !== ep.id));
  const vs = (key, unit) => (overall[key] == null ? '' : ` (channel average ${r1(overall[key])}${unit})`);

  return [
    'You are a YouTube algorithm analyst for an [M4F] ASMR roleplay channel. The video uses one static AI-generated image (no face cam). Diagnose this uploaded episode from the data below. Write all output in English.',
    '',
    'EPISODE',
    line('Title', ep.title),
    line('Thumbnail text', ep.thumbnailText),
    line('Mood', ep.mood),
    line('Hook style', ep.hookStyle),
    `- Scripted length: ${formatTime(duration.totalSeconds)} (${zone.label})`,
    `- First 20 seconds of script: "${scoreAlignment(ep).hook}"`,
    '',
    'DISCOVERY',
    line('Impressions', d.impressions),
    `- CTR: ${val(d.ctr, '%')}${vs('ctr', '%')}`,
    line('Primary traffic source', d.trafficSource),
    '',
    'RETENTION',
    `- 30s retention: ${val(rt.retention30s, '%')}${vs('retention30s', '%')}`,
    `- Average view duration: ${val(rt.avdSeconds, 's')}${vs('avdSeconds', 's')}`,
    line('Average percentage viewed', rt.avgPercentViewed, '%'),
    line('Returning viewers', rt.returningViewers, '%'),
    line('Dip/spike notes (raw)', rt.dipSpikeTimestamps),
    ...dipLines(ep, duration),
    '',
    'AUDIENCE & TRENDS',
    line('Likes', au.likes),
    line('Comments', au.comments),
    line('Top viewer requests', au.topRequests),
    line('Mood sentiment notes', au.moodNotes),
    line('Trend tags', (au.trendTags ?? []).join(', ')),
    '',
    patternsBlock(episodes, ep.id),
    '',
    'TASK',
    '1. Say whether the main problem is discovery (packaging/CTR) or retention (hook/pacing). Back it with the numbers.',
    '2. Explain each dip or spike using the script block that was playing.',
    '3. Compare with the historical patterns and say which apply here.',
    '4. Give 3 prioritized changes for the next episode and 1 packaging change, each tied to a number above.',
  ].join('\n');
};
