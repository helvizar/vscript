// Fullscreen dark reading view for a second monitor: runs a timer, colors each vocal register, and highlights cues.
// Shows 08:00 / 10:00 / 15:00 pacing milestones and logs "good take" timestamps onto the episode.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ACTS, ZONES, uid } from '../core/schema.js';
import { calcDuration, formatTime, orderedBlocks } from '../core/retentionEngine.js';

const MILESTONES = [
  { sec: 480, name: 'Compact' },
  { sec: 600, name: 'Sweet Spot' },
  { sec: 900, name: '15m mark' },
];

// Tailwind needs full class names in source, so these are spelled out.
const PALETTE = [
  { text: 'text-sky-200', border: 'border-sky-400', chip: 'bg-sky-400/25 text-sky-100' },
  { text: 'text-emerald-200', border: 'border-emerald-400', chip: 'bg-emerald-400/25 text-emerald-100' },
  { text: 'text-violet-200', border: 'border-violet-400', chip: 'bg-violet-400/25 text-violet-100' },
  { text: 'text-lime-200', border: 'border-lime-400', chip: 'bg-lime-400/25 text-lime-100' },
  { text: 'text-indigo-200', border: 'border-indigo-400', chip: 'bg-indigo-400/25 text-indigo-100' },
  { text: 'text-teal-200', border: 'border-teal-400', chip: 'bg-teal-400/25 text-teal-100' },
];

const CUE_STYLE = {
  SFX: 'bg-yellow-400 text-black',
  PROXIMITY: 'bg-pink-400 text-black',
  'RE-HOOK': 'bg-orange-500 text-black',
  PAUSE: 'bg-slate-600 text-white',
};

const clock = (sec) => formatTime(sec).padStart(5, '0');

// Display only: timing lives in core. This just styles [tags] inside the text.
const renderText = (text) =>
  text.split(/(\[[^\]]*\])/).map((part, i) => {
    if (i % 2 === 0) return part;
    const kind = part.match(/^\[(SFX|PROXIMITY|RE-HOOK|PAUSE)\b/i)?.[1].toUpperCase();
    return (
      <span
        key={i}
        className={`mx-1 rounded px-2 py-0.5 align-middle text-xl font-bold ${CUE_STYLE[kind] ?? 'bg-slate-700 text-slate-200'}`}
      >
        {part}
      </span>
    );
  });

export default function TeleprompterModal({ episode, onChange, onClose }) {
  const rootRef = useRef(null);
  const blockRefs = useRef({});
  const actions = useRef({});

  // Timer: store the Date.now() the run started and the time banked before it.
  // Elapsed is always recomputed from Date.now(), so a throttled background tab never drifts.
  const [baseMs, setBaseMs] = useState(0);
  const [startedAt, setStartedAt] = useState(null); // null = paused
  const [, setTick] = useState(0);

  const duration = useMemo(() => calcDuration(episode), [episode]);
  const blocks = useMemo(() => orderedBlocks(episode).filter((b) => b.text.trim()), [episode]);
  const timeOf = useMemo(() => Object.fromEntries(duration.timeline.map((t) => [t.blockId, t])), [duration]);

  const nowSec = () => (baseMs + (startedAt === null ? 0 : Date.now() - startedAt)) / 1000;
  const elapsed = nowSec();
  const currentId = blocks.filter((b) => elapsed >= timeOf[b.id].start).at(-1)?.id;
  const nextMilestone = MILESTONES.find((m) => elapsed < m.sec);
  const clips = episode.clips ?? [];

  const toggle = () => {
    if (startedAt === null) setStartedAt(Date.now());
    else {
      setBaseMs(baseMs + Date.now() - startedAt);
      setStartedAt(null);
    }
  };
  const reset = () => {
    setBaseMs(0);
    setStartedAt(null);
  };
  // Click a block to jump the clock to its estimated start (resync when you drift from the estimate).
  const jumpTo = (sec) => {
    setBaseMs(sec * 1000);
    if (startedAt !== null) setStartedAt(Date.now());
  };
  const logClip = () =>
    onChange({ ...episode, clips: [...clips, { id: uid(), seconds: Math.round(nowSec()), note: '' }] });
  const goFullscreen = () => rootRef.current?.requestFullscreen?.()?.catch(() => {});

  actions.current = { toggle, logClip, onClose }; // always the latest closures for the key handler

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) actions.current.toggle();
      } else if (e.code === 'KeyC' && !e.repeat) actions.current.logClip();
      else if (e.code === 'Escape') actions.current.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    blockRefs.current[currentId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentId]);

  const rows = [];
  let prevAct = null;
  let prevRegister = null;
  for (const b of blocks) {
    const regIndex = episode.registers.findIndex((r) => r.id === b.registerId);
    const reg = episode.registers[regIndex];
    const color = PALETTE[Math.max(regIndex, 0) % PALETTE.length];
    const switched = prevRegister !== null && prevRegister !== b.registerId;
    const newAct = prevAct !== b.actId;
    prevAct = b.actId;
    prevRegister = b.registerId;
    const isCurrent = b.id === currentId;

    rows.push(
      <Fragment key={b.id}>
        {newAct && (
          <h2 className="mb-2 mt-10 text-sm font-semibold uppercase tracking-widest text-slate-400">
            {ACTS.find((a) => a.id === b.actId)?.title ?? b.actId}
          </h2>
        )}
        <div
          ref={(el) => {
            blockRefs.current[b.id] = el;
          }}
          onClick={() => jumpTo(timeOf[b.id].start)}
          className={`my-3 cursor-pointer rounded-r-lg border-l-8 py-4 pl-5 pr-4 transition ${color.border} ${
            isCurrent ? 'bg-white/10 opacity-100' : 'opacity-60'
          }`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            {switched && (
              <span className="rounded bg-white px-2 py-0.5 font-bold uppercase text-black">Voice switch</span>
            )}
            <span className={`rounded px-2 py-0.5 font-semibold ${color.chip}`}>
              {reg ? `${reg.name} · ${reg.wpm} WPM` : 'Unknown register'}
            </span>
            {b.zone === ZONES.EXPANSION && (
              <span className="rounded border border-slate-500 px-2 py-0.5 text-slate-300">Expansion</span>
            )}
            {b.label && <span className="text-slate-400">{b.label}</span>}
            <span className="ml-auto font-mono text-slate-500">est. {clock(timeOf[b.id].start)}</span>
          </div>
          <p className={`whitespace-pre-wrap text-3xl leading-relaxed md:text-4xl ${color.text}`}>
            {renderText(b.text)}
          </p>
        </div>
      </Fragment>,
    );
  }

  const btn = 'rounded-md px-4 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-white';

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Studio Teleprompter"
      onMouseDown={(e) => e.preventDefault()} // keep focus on the page so Space always toggles the timer
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
    >
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-800 px-6 py-3">
        <div className="font-mono text-6xl font-bold tabular-nums" aria-live="off">
          {clock(elapsed)}
        </div>
        <button onClick={toggle} className={`${btn} ${startedAt === null ? 'bg-emerald-500 text-black' : 'bg-amber-400 text-black'}`}>
          {startedAt === null ? (elapsed > 0 ? 'Resume' : 'Start') : 'Pause'} (Space)
        </button>
        <button onClick={reset} className={`${btn} bg-slate-800 text-slate-200`}>
          Reset
        </button>

        <div className="flex flex-wrap gap-2">
          {MILESTONES.map((m) => {
            const reached = elapsed >= m.sec;
            const isNext = m === nextMilestone;
            const style = reached
              ? 'bg-emerald-500 text-black'
              : isNext
                ? 'bg-amber-400 text-black'
                : 'bg-slate-800 text-slate-400';
            return (
              <span key={m.sec} className={`rounded px-3 py-1 text-sm font-semibold ${style}`}>
                {clock(m.sec)} {m.name}
                {reached ? ' ✓' : isNext ? ` · in ${clock(m.sec - elapsed)}` : ''}
              </span>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3 text-sm text-slate-400">
          <span>Script est. {clock(duration.totalSeconds)}</span>
          <button onClick={goFullscreen} className={`${btn} bg-slate-800 text-slate-200`}>
            Fullscreen
          </button>
          <button onClick={onClose} className={`${btn} bg-slate-800 text-slate-200`}>
            Close (Esc)
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {rows.length ? (
          <div className="mx-auto max-w-5xl pb-[50vh]">{rows}</div>
        ) : (
          <p className="mt-20 text-center text-2xl text-slate-400">
            No script text yet. Write it in the 5-Act Script tab, then reopen the teleprompter.
          </p>
        )}
      </main>

      <footer className="flex flex-wrap items-center gap-4 border-t border-slate-800 px-6 py-3">
        <button onClick={logClip} className={`${btn} bg-fuchsia-500 text-black`}>
          Log Clip / Good Take (C)
        </button>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
          <span className="text-slate-500">{clips.length} logged</span>
          {clips.slice(-6).map((c) => (
            <span key={c.id} className="rounded bg-fuchsia-500/20 px-2 py-0.5 font-mono text-fuchsia-200">
              {clock(c.seconds)}
            </span>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-500">Click a block to jump the clock to it</span>
      </footer>
    </div>
  );
}
