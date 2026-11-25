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

const inputCls =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500';
const btnCls =
  'rounded-md px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40';
const ZONE_BAR = { under: 'bg-rose-500', compact: 'bg-amber-400', sweet: 'bg-emerald-500' };
const STATUS = {
  saved: ['Auto-Saved', 'text-emerald-400'],
  saving: ['Saving…', 'text-amber-300'],
  error: ['Save failed: storage full or blocked', 'text-rose-400'],
};
const TABS = [
  ['packaging', 'Packaging & SEO'],
  ['script', '5-Act Script & Pacing'],
  ['analytics', 'Analytics'],
];

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

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-300">
        {label}
        {hint && <span className="font-normal text-slate-500"> {hint}</span>}
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
      <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    </Field>
  );
}

// ---------- library sidebar ----------

function LibrarySidebar({ episodes, selectedId, status, notice, onSelect, onNew, onDuplicate, onDelete, onExport, onImportFile }) {
  const fileRef = useRef(null);
  const [label, color] = STATUS[status];
  return (
    <aside className="flex w-full flex-col gap-4 border-b border-slate-800 bg-slate-900 p-4 md:w-72 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">VScript</h1>
        <span role="status" className={`text-xs font-semibold ${color}`}>
          {label}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={onNew} className={`${btnCls} bg-violet-500 text-white hover:bg-violet-400`}>
          New episode
        </button>
        <button onClick={onDuplicate} disabled={!selectedId} className={`${btnCls} bg-slate-800 text-slate-200`}>
          Duplicate
        </button>
        <button onClick={onDelete} disabled={!selectedId} className={`${btnCls} bg-slate-800 text-rose-300`}>
          Delete
        </button>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto" aria-label="Episodes">
        {[...episodes].sort(byNewest).map((e) => {
          const total = calcDuration(e).totalSeconds;
          return (
            <li key={e.id}>
              <button
                onClick={() => onSelect(e.id)}
                aria-current={e.id === selectedId}
                className={`w-full rounded-md p-2 text-left text-sm ${
                  e.id === selectedId ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="line-clamp-2">{e.title || 'Untitled'}</span>
                <span className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                  <span className={`h-2 w-2 rounded-full ${ZONE_BAR[evaluateZone(total).id]}`} />
                  {formatTime(total)}
                  {e.uploaded && <span className="rounded bg-slate-950 px-1.5">Uploaded</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <div className="flex gap-2">
          <button onClick={onExport} className={`${btnCls} flex-1 bg-slate-800 text-slate-200`}>
            Export .json
          </button>
          <button onClick={() => fileRef.current?.click()} className={`${btnCls} flex-1 bg-slate-800 text-slate-200`}>
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
          <p role="status" className="text-xs text-slate-300">
            {notice}
          </p>
        )}
      </div>
    </aside>
  );
}

// ---------- tab 1: packaging & SEO ----------

function PackagingTab({ episode, episodes, onChange }) {
  const { seoScore, tips, alignment } = useMemo(() => coachEpisode(episode), [episode]);
  const [msg, copy] = useCopy();
  const set = (patch) => onChange({ ...episode, ...patch });

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
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label="Title" hint="(start with [M4F])">
          <input className={inputCls} value={episode.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="AI thumbnail text" hint="(1-4 words)">
          <input className={inputCls} value={episode.thumbnailText} onChange={(e) => set({ thumbnailText: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea rows={6} className={inputCls} value={episode.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <TagsField key={episode.id} value={episode.tags} onCommit={(tags) => set({ tags })} />
        <Field label="Chapters" hint="(first at 0:00, at least 3)">
          <textarea rows={5} className={inputCls} value={episode.chapters} onChange={(e) => set({ chapters: e.target.value })} />
        </Field>
        <button onClick={fillChapters} className={`${btnCls} bg-slate-800 text-slate-200`}>
          Auto-fill chapters from script
        </button>
      </div>

      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-lg font-semibold text-slate-100">Packaging Alignment</h3>
          <p className="text-3xl font-bold text-slate-100">{alignment.score}/100</p>
          <p className="text-sm text-slate-400">
            Title and thumbnail keywords the first 20 seconds of Act 1 also say (thumbnail words count double).
          </p>
          <p className="rounded bg-slate-950 p-3 text-sm italic text-slate-300">
            {alignment.hook ? `“${alignment.hook}”` : 'Act 1 has no script text yet.'}
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            {alignment.matched.map((w) => (
              <span key={w} className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-200">
                {w}
              </span>
            ))}
            {alignment.missing.map((w) => (
              <span key={w} className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-200">
                {w}
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-lg font-semibold text-slate-100">AI Coach</h3>
          <div className="h-3 rounded bg-slate-800">
            <div
              className={`h-full rounded ${seoScore >= 80 ? 'bg-emerald-500' : seoScore >= 50 ? 'bg-amber-400' : 'bg-rose-500'}`}
              style={{ width: `${seoScore}%` }}
            />
          </div>
          <p className="text-sm text-slate-300">SEO completeness: {seoScore}/100</p>
          {tips.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-300">All checks passed.</p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => copy(buildTitleSeoPrompt(episode, episodes))}
              className={`${btnCls} bg-violet-500 text-white hover:bg-violet-400`}
            >
              Copy Title &amp; SEO Prompt
            </button>
            {msg && (
              <span role="status" className="text-sm text-slate-300">
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
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-100">
            {formatTime(duration.totalSeconds)} <span className="text-sm font-normal text-slate-400">estimated</span>
          </h3>
          <span className="text-sm text-slate-300">
            Core {formatTime(duration.coreSeconds)} · Expansion {formatTime(duration.expansionSeconds)}
          </span>
        </div>
        <div className="relative h-4 rounded bg-slate-800" role="img" aria-label={`Duration gauge: ${zone.label}`}>
          <div className={`h-full rounded ${ZONE_BAR[zone.id]}`} style={{ width: `${gaugePct(duration.totalSeconds)}%` }} />
          {[480, 600].map((m) => (
            <div key={m} className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${gaugePct(m)}%` }} />
          ))}
        </div>
        <div className="relative h-4 text-xs text-slate-500">
          <span className="absolute left-0">0:00</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${gaugePct(480)}%` }}>8:00</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${gaugePct(600)}%` }}>10:00</span>
          <span className="absolute right-0">15:00</span>
        </div>
        <p className="text-sm font-semibold text-slate-200">{zone.label}</p>

        {monotony.length ? (
          <ul className="space-y-1 rounded border border-amber-600 bg-amber-500/10 p-3 text-sm text-amber-200" aria-label="Static-visual warnings">
            {monotony.map((w) => (
              <li key={w.startBlockId + w.endBlockId}>
                Static stretch of {formatTime(w.seconds)} from {nameOf(w.startBlockId)} to {nameOf(w.endBlockId)}. Add a
                register switch, [RE-HOOK], [SFX] or [PROXIMITY] cue.
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-emerald-300">No static-visual stretches over 2:30.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => copy(buildScriptCoachPrompt(episode, episodes))} className={`${btnCls} bg-violet-500 text-white hover:bg-violet-400`}>
            Copy Script Coach Prompt
          </button>
          <button
            onClick={() => download(`${slug(episode.title)}-recording-script.txt`, formatRecordingScript(episode), 'text/plain')}
            className={`${btnCls} bg-slate-800 text-slate-200`}
          >
            Export Clean Recording Script
          </button>
          <button onClick={onTeleprompter} className={`${btnCls} bg-fuchsia-500 text-black hover:bg-fuchsia-400`}>
            Start Studio Teleprompter
          </button>
          {msg && (
            <span role="status" className="text-sm text-slate-300">
              {msg}
            </span>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-lg font-semibold text-slate-100">Vocal Registers</h3>
        <ul className="space-y-2">
          {episode.registers.map((r) => {
            const used = episode.blocks.some((b) => b.registerId === r.id);
            const locked = used || episode.registers.length === 1;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <input aria-label="Register name" className={`${inputCls} max-w-xs`} value={r.name} onChange={(e) => setRegister(r.id, { name: e.target.value })} />
                <input
                  aria-label="Words per minute"
                  type="number"
                  min="1"
                  max="300"
                  className={`${inputCls} w-24`}
                  value={r.wpm || ''}
                  onChange={(e) => setRegister(r.id, { wpm: Number(e.target.value) || 0 })}
                />
                <span className="text-sm text-slate-400">WPM</span>
                <button
                  onClick={() => removeRegister(r.id)}
                  disabled={locked}
                  title={locked ? 'In use by a block, or the only register left' : 'Delete register'}
                  className={`${btnCls} bg-slate-800 text-rose-300`}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
        <button onClick={addRegister} className={`${btnCls} bg-slate-800 text-slate-200`}>
          Add register
        </button>
      </section>

      <p className="text-sm text-slate-400">
        Inline tags: [PAUSE 3s], [SFX: rain], [PROXIMITY], [RE-HOOK]. They add time to the estimate and break up static stretches.
      </p>

      {ACTS.map((act) => (
        <section key={act.id} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-100">
              {act.title}
              {act.timeHint && <span className="ml-2 text-sm font-normal text-slate-500">{act.timeHint}</span>}
            </h3>
            <span className="font-mono text-sm text-slate-400">{formatTime(duration.perAct[act.id] ?? 0)}</span>
          </div>

          {episode.blocks
            .filter((b) => b.actId === act.id)
            .map((b) => (
              <div
                key={b.id}
                className={`space-y-2 rounded-md border bg-slate-900 p-3 ${flagged.has(b.id) ? 'border-amber-500' : 'border-slate-800'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Block label"
                    placeholder="Block label"
                    className={`${inputCls} max-w-[12rem]`}
                    value={b.label}
                    onChange={(e) => setBlock(b.id, { label: e.target.value })}
                  />
                  <select
                    aria-label="Vocal register"
                    className={`${inputCls} max-w-[14rem]`}
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
                  <div role="group" aria-label="Zone" className="flex overflow-hidden rounded border border-slate-700 text-sm">
                    {[
                      [ZONES.CORE, 'Core'],
                      [ZONES.EXPANSION, 'Expansion'],
                    ].map(([z, label]) => (
                      <button
                        key={z}
                        aria-pressed={b.zone === z}
                        onClick={() => setBlock(b.id, { zone: z })}
                        className={`px-3 py-2 ${b.zone === z ? 'bg-violet-500 text-white' : 'bg-slate-950 text-slate-400'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="font-mono text-sm text-slate-400">{formatTime(duration.perBlock[b.id] ?? 0)}</span>
                  <button onClick={() => removeBlock(b)} className={`${btnCls} ml-auto bg-slate-800 text-rose-300`}>
                    Delete block
                  </button>
                </div>
                <textarea
                  aria-label="Script text"
                  rows={5}
                  className={inputCls}
                  value={b.text}
                  onChange={(e) => setBlock(b.id, { text: e.target.value })}
                />
              </div>
            ))}

          <div className="flex gap-2">
            <button onClick={() => addBlock(act.id, ZONES.CORE)} className={`${btnCls} bg-slate-800 text-slate-200`}>
              Add core block
            </button>
            <button onClick={() => addBlock(act.id, ZONES.EXPANSION)} className={`${btnCls} bg-slate-800 text-slate-200`}>
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

  if (!episodes) return <p className="p-8 text-slate-400">Loading…</p>;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 md:flex-row">
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

      <main className="flex-1 space-y-6 p-6">
        {episode ? (
          <>
            <div role="tablist" aria-label="Episode sections" className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`${btnCls} ${tab === id ? 'bg-violet-500 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'packaging' && <PackagingTab episode={episode} episodes={episodes} onChange={commit} />}
            {tab === 'script' && (
              <ScriptTab episode={episode} episodes={episodes} onChange={commit} onTeleprompter={() => setTeleOpen(true)} />
            )}
            {tab === 'analytics' && <AnalyticsPanel episode={episode} episodes={episodes} onChange={commit} />}

            {teleOpen && <TeleprompterModal episode={episode} onChange={commit} onClose={() => setTeleOpen(false)} />}
          </>
        ) : (
          <div className="mt-20 text-center text-slate-400">
            <p className="mb-4">No episodes yet.</p>
            <button onClick={() => add(createEpisode())} className={`${btnCls} bg-violet-500 text-white hover:bg-violet-400`}>
              New episode
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
