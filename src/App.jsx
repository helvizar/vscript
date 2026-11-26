// Main screen: episode library sidebar plus three tabs (Packaging & SEO, 5-Act Script & Pacing, Analytics) and the teleprompter.
// Every edit goes through saveEpisode, which auto-saves after 500ms of quiet; all math and prompts come from src/core.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTS, ZONES, createBlock, createEpisode, duplicateEpisode, uid } from './core/schema.js';
import {
  deleteEpisode,
  exportAll,
  formatRecordingScript,
  getAllEpisodes,
  importAll,
  onSaveStatus,
  saveEpisode,
} from './core/storageAdapter.js';
import { analyzeEpisode, calcDuration, evaluateZone, formatTime, orderedBlocks } from './core/retentionEngine.js';
import { buildScriptCoachPrompt, buildTitleSeoPrompt, coachEpisode } from './core/aiCoachEngine.js';
import AnalyticsPanel from './components/AnalyticsPanel.jsx';
import TeleprompterModal from './components/TeleprompterModal.jsx';

// Zone ids map to CSS classes (zone-under, zone-compact, zone-sweet) that set the zone color tokens.
const ZONE_BAR = { under: 'zone-under', compact: 'zone-compact', sweet: 'zone-sweet' };
const ZONE_NAME = { under: 'Under target', compact: 'Compact', sweet: 'Sweet spot' };
const STATUS = {
  saved: ['Auto-Saved', 'status-saved'],
  saving: ['Saving…', 'status-saving'],
  error: ['Save failed: storage full or blocked', 'status-error'],
};
const TABS = [
  ['packaging', 'Packaging & SEO'],
  ['script', '5-Act Script & Pacing'],
  ['analytics', 'Analytics'],
];
const FILTERS = [
  ['all', 'All'],
  ['draft', 'Drafts'],
  ['uploaded', 'Uploaded'],
];

// The three default registers get fixed colors; custom ones cycle through the same three by position.
const TONES = ['sky', 'rose', 'violet'];
const KNOWN_TONE = { bright: 'sky', deep: 'rose', calm: 'violet' };
const toneOf = (registers, id) => {
  if (KNOWN_TONE[id]) return KNOWN_TONE[id];
  const i = registers.findIndex((r) => r.id === id);
  return i < 0 ? 'none' : TONES[i % TONES.length];
};

const byNewest = (a, b) => b.createdAt - a.createdAt;
const slug = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'episode';

const download = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

function useCopy() {
  const [msg, setMsg] = useState('');
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('Copied!');
    } catch {
      setMsg('Copy failed: the browser blocked clipboard access.');
    }
    setTimeout(() => setMsg(''), 3000);
  };
  return [msg, copy];
}

// ---------- small shared pieces ----------

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  upload: 'M12 15V4m0 0L8 8m4-4l4 4M5 20h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  panel: 'M4 5h16v14H4zM9 5v14',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.01',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
};

function Icon({ name, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <span className="field-hint"> {hint}</span>}
      </span>
      {children}
    </label>
  );
}

// Keeps its own text while typing; commits the parsed array on blur so commas aren't eaten mid-typing.
function TagsField({ value, onCommit }) {
  const [text, setText] = useState((value ?? []).join(', '));
  const commit = () => {
    const tags = text.split(',').map((t) => t.trim()).filter(Boolean);
    setText(tags.join(', '));
    onCommit(tags);
  };
  return (
    <Field label="Tags" hint="(comma-separated)">
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    </Field>
  );
}

// 20-cell LED meter; the zone class picks the lit color.
function Meter({ value, label, zoneClass }) {
  const lit = Math.round(value / 5);
  return (
    <div
      className={`meter ${zoneClass}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      {Array.from({ length: 20 }, (_, i) => (
        <span key={i} className={i < lit ? 'is-lit' : ''} />
      ))}
    </div>
  );
}

// ---------- library sidebar ----------

function LibrarySidebar({ episodes, selectedId, status, notice, onSelect, onNew, onDuplicate, onDelete, onExport, onImportFile }) {
  const fileRef = useRef(null);
  const [label, statusCls] = STATUS[status];
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...episodes]
      .sort(byNewest)
      .filter((e) => (filter === 'uploaded' ? e.uploaded : filter === 'draft' ? !e.uploaded : true))
      .filter((e) => !q || `${e.title ?? ''} ${e.mood ?? ''}`.toLowerCase().includes(q));
  }, [episodes, query, filter]);

  return (
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Episode library">
      <div className="sb-head">
        <div className="sb-brand">
          <span className="sb-mark" aria-hidden="true">V</span>
          <h1 className="sb-name">VScript</h1>
        </div>
        <span role="status" className={`save-badge ${statusCls}`}>
          <span className="sb-status-text">{label}</span>
        </span>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="library-body"
          aria-label={collapsed ? 'Expand library' : 'Collapse library'}
          title={collapsed ? 'Expand library' : 'Collapse library'}
        >
          <Icon name="panel" />
        </button>
      </div>

      <div className="sb-rail">
        <button className="btn btn-primary btn-icon" onClick={onNew} aria-label="New episode" title="New episode">
          <Icon name="plus" />
        </button>
      </div>

      <div id="library-body" className="sb-body">
        <div className="sb-actions">
          <button onClick={onNew} className="btn btn-primary">
            <Icon name="plus" />
            New episode
          </button>
          <button onClick={onDuplicate} disabled={!selectedId} className="btn btn-icon" aria-label="Duplicate episode" title="Duplicate episode">
            <Icon name="copy" />
          </button>
          <button onClick={onDelete} disabled={!selectedId} className="btn btn-icon" aria-label="Delete episode" title="Delete episode">
            <Icon name="trash" />
          </button>
        </div>

        <div className="sb-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            className="input"
            placeholder="Search episodes"
            aria-label="Search episodes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="sb-filter">
          <div role="group" aria-label="Filter episodes" className="seg">
            {FILTERS.map(([id, name]) => (
              <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {name}
              </button>
            ))}
          </div>
          <span className="sb-count num">
            {visible.length}/{episodes.length}
          </span>
        </div>

        <ul className="ep-list" aria-label="Episodes">
          {visible.map((e) => {
            const total = calcDuration(e).totalSeconds;
            const zone = evaluateZone(total);
            return (
              <li key={e.id}>
                <button onClick={() => onSelect(e.id)} aria-current={e.id === selectedId} className="ep-item">
                  <span className="ep-title clamp-2">{e.title || 'Untitled'}</span>
                  <span className="ep-meta">
                    <span className={`dot ${ZONE_BAR[zone.id]}`} title={zone.label} />
                    <span className="num">{formatTime(total)}</span>
                    {e.uploaded && <span className="tag">Uploaded</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {!visible.length && (
            <li className="ep-empty">{episodes.length ? 'No episodes match. Clear the search or filter.' : 'No episodes yet.'}</li>
          )}
        </ul>

        <div className="sb-foot">
          <p className="sb-foot-title">JSON backup</p>
          <div className="sb-foot-row">
            <button onClick={onExport} className="btn">
              <Icon name="download" />
              Export .json
            </button>
            <button onClick={() => fileRef.current?.click()} className="btn">
              <Icon name="upload" />
              Import .json
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                onImportFile(e.target.files?.[0]);
                e.target.value = ''; // lets the same file be picked again
              }}
            />
          </div>
          {notice && (
            <p role="status" className="sb-notice">
              {notice}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

// ---------- episode header: always-visible running time ----------

function EpisodeHeader({ episode }) {
  const { totalSeconds } = useMemo(() => calcDuration(episode), [episode]);
  const zone = evaluateZone(totalSeconds);
  return (
    <header className={`ep-head ${ZONE_BAR[zone.id]}`}>
      <div className="ep-head-main">
        <p className="ep-head-title">{episode.title || 'Untitled'}</p>
        <p className="ep-head-meta">
          <span>{episode.uploaded ? 'Uploaded' : 'Draft'}</span>
          {episode.mood && <span>{episode.mood}</span>}
        </p>
      </div>
      <div className="ep-head-time">
        <span className="ep-time num">{formatTime(totalSeconds)}</span>
        <span className="zone-badge">{ZONE_NAME[zone.id]}</span>
      </div>
    </header>
  );
}

// ---------- tab 1: packaging & SEO ----------

function PackagingTab({ episode, episodes, onChange }) {
  const { seoScore, tips, alignment } = useMemo(() => coachEpisode(episode), [episode]);
  const [msg, copy] = useCopy();
  const set = (patch) => onChange({ ...episode, ...patch });
  const seoZone = seoScore >= 80 ? 'zone-sweet' : seoScore >= 50 ? 'zone-compact' : 'zone-under';

  const fillChapters = () => {
    if (episode.chapters.trim() && !window.confirm('Replace the current chapters with ones built from the script?')) return;
    const { timeline, perAct } = calcDuration(episode);
    const lines = ACTS.flatMap((a) => {
      const t = timeline.find((x) => x.actId === a.id);
      return t && perAct[a.id] > 0 ? [`${formatTime(t.start)} ${a.title.replace(/^Act \d+:\s*/, '')}`] : [];
    });
    set({ chapters: lines.join('\n') });
  };

  return (
    <div className="grid-2">
      <div className="col">
        <Field label="Title" hint="(start with [M4F])">
          <input className="input" value={episode.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="AI thumbnail text" hint="(1-4 words)">
          <input className="input" value={episode.thumbnailText} onChange={(e) => set({ thumbnailText: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea rows={6} className="input" value={episode.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <TagsField key={episode.id} value={episode.tags} onCommit={(tags) => set({ tags })} />
        <Field label="Chapters" hint="(first at 0:00, at least 3)">
          <textarea rows={5} className="input num" value={episode.chapters} onChange={(e) => set({ chapters: e.target.value })} />
        </Field>
        <div>
          <button onClick={fillChapters} className="btn">
            Auto-fill chapters from script
          </button>
        </div>
      </div>

      <div className="col">
        <section className="panel">
          <h3 className="panel-title">Packaging Alignment</h3>
          <p className="big-score num">
            {alignment.score}
            <small>/100</small>
          </p>
          <p className="panel-note">
            Title and thumbnail keywords the first 20 seconds of Act 1 also say (thumbnail words count double).
          </p>
          <p className="hook-quote">{alignment.hook ? `“${alignment.hook}”` : 'Act 1 has no script text yet.'}</p>
          {alignment.matched.length > 0 && (
            <div className="chip-group">
              <span className="chip-group-label">Said in the hook</span>
              <div className="chips">
                {alignment.matched.map((w) => (
                  <span key={w} className="chip chip-ok">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}
          {alignment.missing.length > 0 && (
            <div className="chip-group">
              <span className="chip-group-label">Not said yet</span>
              <div className="chips">
                {alignment.missing.map((w) => (
                  <span key={w} className="chip chip-miss">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h3 className="panel-title">AI Coach</h3>
          <Meter value={seoScore} label="SEO completeness" zoneClass={seoZone} />
          <p className="panel-note num">SEO completeness: {seoScore}/100</p>
          {tips.length ? (
            <ul className="tips">
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : (
            <p className="ok-text">All checks passed.</p>
          )}
          <div className="row">
            <button onClick={() => copy(buildTitleSeoPrompt(episode, episodes))} className="btn btn-primary">
              <Icon name="copy" />
              Copy Title &amp; SEO Prompt
            </button>
            {msg && (
              <span role="status" className="msg">
                {msg}
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------- tab 2: 5-act script & pacing ----------

const GAUGE_MAX = 900; // gauge ends at 15:00
const gaugePct = (sec) => Math.min(100, (sec / GAUGE_MAX) * 100);

// Three zones drawn to scale: under 8m, 8-10m, 10-15m+.
const SEGMENTS = [
  { id: 'under', name: '< 8m', from: 0, to: 480 },
  { id: 'compact', name: '8–10m', from: 480, to: 600 },
  { id: 'sweet', name: '10–15m+', from: 600, to: GAUGE_MAX },
];

function DurationBar({ total, zone }) {
  return (
    <div className="dbar">
      <div className="dbar-track" role="img" aria-label={`Duration gauge: ${zone.label}`}>
        {SEGMENTS.map((s) => {
          const fill = Math.max(0, Math.min(1, (total - s.from) / (s.to - s.from))) * 100;
          return (
            <div key={s.id} className={`dbar-seg zone-${s.id}`} style={{ flex: `${s.to - s.from} 0 0` }}>
              <div className="dbar-fill" style={{ width: `${fill}%` }} />
            </div>
          );
        })}
      </div>
      <div className="dbar-needle" style={{ left: `${gaugePct(total)}%` }} aria-hidden="true" />
      <div className="dbar-labels" aria-hidden="true">
        {SEGMENTS.map((s) => (
          <span
            key={s.id}
            className={`dbar-label zone-${s.id}${zone.id === s.id ? ' is-active' : ''}`}
            style={{ flex: `${s.to - s.from} 0 0` }}
          >
            <span className="dbar-name">{s.name}</span>
            <span className="num">{formatTime(s.from)}</span>
          </span>
        ))}
        <span className="dbar-end num">{formatTime(GAUGE_MAX)}</span>
      </div>
    </div>
  );
}

function ScriptTab({ episode, episodes, onChange, onTeleprompter }) {
  const { duration, zone, monotony } = useMemo(() => analyzeEpisode(episode), [episode]);
  const ordered = useMemo(() => orderedBlocks(episode), [episode]);
  const [msg, copy] = useCopy();

  const indexOf = (id) => ordered.findIndex((b) => b.id === id);
  const nameOf = (id) => {
    const b = ordered[indexOf(id)];
    return `Block ${indexOf(id) + 1}${b?.label ? ` (${b.label})` : ''}`;
  };
  const flagged = new Set(
    monotony.flatMap((w) => ordered.slice(indexOf(w.startBlockId), indexOf(w.endBlockId) + 1).map((b) => b.id)),
  );

  const setBlock = (id, patch) =>
    onChange({ ...episode, blocks: episode.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const addBlock = (actId, zoneId) => {
    const last = episode.blocks.filter((b) => b.actId === actId).at(-1);
    const registerId = last?.registerId ?? episode.registers[0]?.id;
    onChange({ ...episode, blocks: [...episode.blocks, createBlock({ actId, zone: zoneId, registerId })] });
  };
  const removeBlock = (b) => {
    if (b.text.trim() && !window.confirm('Delete this block and its text?')) return;
    onChange({ ...episode, blocks: episode.blocks.filter((x) => x.id !== b.id) });
  };

  const setRegister = (id, patch) =>
    onChange({ ...episode, registers: episode.registers.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const addRegister = () =>
    onChange({ ...episode, registers: [...episode.registers, { id: uid(), name: 'New Register', wpm: 110 }] });
  const removeRegister = (id) => onChange({ ...episode, registers: episode.registers.filter((r) => r.id !== id) });

  return (
    <div className="col" style={{ gap: '1.5rem' }}>
      <section className={`panel ${ZONE_BAR[zone.id]}`}>
        <div className="console-top">
          <h3 className="panel-title">
            <span className="console-time num">{formatTime(duration.totalSeconds)}</span>
            <span className="console-sub">estimated</span>
          </h3>
          <dl className="console-split">
            <div>
              <dt>Core</dt>
              <dd className="num">{formatTime(duration.coreSeconds)}</dd>
            </div>
            <div>
              <dt>Expansion</dt>
              <dd className="num">{formatTime(duration.expansionSeconds)}</dd>
            </div>
          </dl>
        </div>

        <DurationBar total={duration.totalSeconds} zone={zone} />
        <p className="zone-label">{zone.label}</p>

        <ul className="pill-row" aria-label="Vocal registers in this episode">
          {episode.registers.map((r) => (
            <li key={r.id} className={`pill tone-${toneOf(episode.registers, r.id)}`}>
              {r.name}
              <span className="num">{r.wpm} WPM</span>
            </li>
          ))}
        </ul>

        {monotony.length ? (
          <ul className="alert-warn" aria-label="Static-visual warnings">
            {monotony.map((w) => (
              <li key={w.startBlockId + w.endBlockId}>
                <Icon name="warn" />
                <span>
                  Static stretch of <span className="num">{formatTime(w.seconds)}</span> from {nameOf(w.startBlockId)} to{' '}
                  {nameOf(w.endBlockId)}. Add a register switch, [RE-HOOK], [SFX] or [PROXIMITY] cue.
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ok-text">No static-visual stretches over 2:30.</p>
        )}

        <div className="row">
          <button onClick={onTeleprompter} className="btn btn-primary">
            <Icon name="mic" />
            Start Studio Teleprompter
          </button>
          <button onClick={() => copy(buildScriptCoachPrompt(episode, episodes))} className="btn">
            <Icon name="copy" />
            Copy Script Coach Prompt
          </button>
          <button
            onClick={() => download(`${slug(episode.title)}-recording-script.txt`, formatRecordingScript(episode), 'text/plain')}
            className="btn btn-ghost"
          >
            <Icon name="download" />
            Export Clean Recording Script
          </button>
          {msg && (
            <span role="status" className="msg">
              {msg}
            </span>
          )}
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">Vocal Registers</h3>
        <ul className="reg-list">
          {episode.registers.map((r) => {
            const used = episode.blocks.some((b) => b.registerId === r.id);
            const locked = used || episode.registers.length === 1;
            return (
              <li key={r.id} className={`reg-row tone-${toneOf(episode.registers, r.id)}`}>
                <span className="reg-swatch" aria-hidden="true" />
                <input aria-label="Register name" className="input reg-name" value={r.name} onChange={(e) => setRegister(r.id, { name: e.target.value })} />
                <span className="reg-wpm">
                  <input
                    aria-label="Words per minute"
                    type="number"
                    min="1"
                    max="300"
                    className="input"
                    value={r.wpm || ''}
                    onChange={(e) => setRegister(r.id, { wpm: Number(e.target.value) || 0 })}
                  />
                  WPM
                </span>
                <button
                  onClick={() => removeRegister(r.id)}
                  disabled={locked}
                  title={locked ? 'In use by a block, or the only register left' : 'Delete register'}
                  aria-label={`Delete register ${r.name}`}
                  className="btn"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
        <div>
          <button onClick={addRegister} className="btn">
            <Icon name="plus" />
            Add register
          </button>
        </div>
      </section>

      <p className="panel-note">
        Inline tags: [PAUSE 3s], [SFX: rain], [PROXIMITY], [RE-HOOK]. They add time to the estimate and break up static stretches.
      </p>

      {ACTS.map((act) => (
        <section key={act.id} className="act">
          <div className="act-head">
            <h3 className="act-title">
              {act.title}
              {act.timeHint && <span className="act-hint num">{act.timeHint}</span>}
            </h3>
            <span className="act-time num">{formatTime(duration.perAct[act.id] ?? 0)}</span>
          </div>

          {episode.blocks
            .filter((b) => b.actId === act.id)
            .map((b) => (
              <div
                key={b.id}
                className={`block-card tone-${toneOf(episode.registers, b.registerId)}${flagged.has(b.id) ? ' is-flagged' : ''}`}
              >
                <div className="block-bar">
                  <input
                    aria-label="Block label"
                    placeholder="Block label"
                    className="input block-label"
                    value={b.label}
                    onChange={(e) => setBlock(b.id, { label: e.target.value })}
                  />
                  <select
                    aria-label="Vocal register"
                    className="input block-register"
                    value={b.registerId}
                    onChange={(e) => setBlock(b.id, { registerId: e.target.value })}
                  >
                    {!episode.registers.some((r) => r.id === b.registerId) && <option value={b.registerId}>Unknown register</option>}
                    {episode.registers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.wpm} WPM)
                      </option>
                    ))}
                  </select>
                  <div role="group" aria-label="Zone" className="seg">
                    {[
                      [ZONES.CORE, 'Core'],
                      [ZONES.EXPANSION, 'Expansion'],
                    ].map(([z, label]) => (
                      <button key={z} aria-pressed={b.zone === z} onClick={() => setBlock(b.id, { zone: z })}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="block-time num">{formatTime(duration.perBlock[b.id] ?? 0)}</span>
                  {flagged.has(b.id) && (
                    <span className="flag">
                      <Icon name="warn" size={12} />
                      Static stretch
                    </span>
                  )}
                  <button onClick={() => removeBlock(b)} className="btn spacer">
                    Delete block
                  </button>
                </div>
                <textarea
                  aria-label="Script text"
                  rows={5}
                  className="input"
                  value={b.text}
                  onChange={(e) => setBlock(b.id, { text: e.target.value })}
                />
              </div>
            ))}

          <div className="row">
            <button onClick={() => addBlock(act.id, ZONES.CORE)} className="btn">
              <Icon name="plus" />
              Add core block
            </button>
            <button onClick={() => addBlock(act.id, ZONES.EXPANSION)} className="btn">
              <Icon name="plus" />
              Add expansion slot
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------- app ----------

export default function App() {
  const [episodes, setEpisodes] = useState(null); // null = still loading
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('packaging');
  const [status, setStatus] = useState('saved');
  const [notice, setNotice] = useState('');
  const [teleOpen, setTeleOpen] = useState(false);

  useEffect(() => {
    let live = true;
    getAllEpisodes().then((list) => {
      if (!live) return;
      setEpisodes(list);
      setSelectedId([...list].sort(byNewest)[0]?.id ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => onSaveStatus(setStatus), []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  const persist = (ep) => saveEpisode(ep).catch(() => setStatus('error')); // adapter debounces the write by 500ms

  const commit = (next) => {
    const stamped = { ...next, updatedAt: Date.now() };
    setEpisodes((list) => list.map((e) => (e.id === stamped.id ? stamped : e)));
    persist(stamped);
  };

  const add = (ep) => {
    setEpisodes((list) => [...list, ep]);
    setSelectedId(ep.id);
    persist(ep);
  };

  const episode = episodes?.find((e) => e.id === selectedId) ?? null;

  const onDelete = async () => {
    if (!episode || !window.confirm(`Delete "${episode.title}"? This cannot be undone.`)) return;
    const remaining = episodes.filter((e) => e.id !== episode.id);
    setEpisodes(remaining);
    setSelectedId([...remaining].sort(byNewest)[0]?.id ?? null);
    setTeleOpen(false);
    await deleteEpisode(episode.id);
  };

  const onExport = async () =>
    download(`vscript-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll(), 'application/json');

  const onImportFile = async (file) => {
    if (!file) return;
    try {
      const count = await importAll(await file.text());
      setEpisodes(await getAllEpisodes());
      setNotice(`Imported ${count} episode${count === 1 ? '' : 's'}.`);
    } catch (err) {
      setNotice(`Import failed: ${err.message}`);
    }
  };

  if (!episodes) return <p className="loading">Loading…</p>;

  return (
    <div className="shell">
      <LibrarySidebar
        episodes={episodes}
        selectedId={selectedId}
        status={status}
        notice={notice}
        onSelect={setSelectedId}
        onNew={() => add(createEpisode())}
        onDuplicate={() => episode && add(duplicateEpisode(episode))}
        onDelete={onDelete}
        onExport={onExport}
        onImportFile={onImportFile}
      />

      <main className="main">
        {episode ? (
          <>
            <div className="workbar">
              <EpisodeHeader episode={episode} />
              <div role="tablist" aria-label="Episode sections" className="tabs">
                {TABS.map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="tab">
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div role="tabpanel" className="stage">
              {tab === 'packaging' && <PackagingTab episode={episode} episodes={episodes} onChange={commit} />}
              {tab === 'script' && (
                <ScriptTab episode={episode} episodes={episodes} onChange={commit} onTeleprompter={() => setTeleOpen(true)} />
              )}
              {tab === 'analytics' && <AnalyticsPanel episode={episode} episodes={episodes} onChange={commit} />}
            </div>

            {teleOpen && <TeleprompterModal episode={episode} onChange={commit} onClose={() => setTeleOpen(false)} />}
          </>
        ) : (
          <div className="empty">
            <strong>No episodes yet.</strong>
            <span>Create an episode to start timing a script.</span>
            <button onClick={() => add(createEpisode())} className="btn btn-primary">
              <Icon name="plus" />
              New episode
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
