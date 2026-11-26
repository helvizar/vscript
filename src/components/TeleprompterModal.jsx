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

const FONT_MIN = 18;
const FONT_MAX = 40;
const FONT_STEP = 2;

// Same register colors as the main screen: the three defaults are fixed, custom ones cycle by position.
const TONES = ['sky', 'rose', 'violet'];
const KNOWN_TONE = { bright: 'sky', deep: 'rose', calm: 'violet' };
const toneOf = (registers, id) => {
  if (KNOWN_TONE[id]) return KNOWN_TONE[id];
  const i = registers.findIndex((r) => r.id === id);
  return i < 0 ? 'none' : TONES[i % TONES.length];
};

const CUE_CLASS = { SFX: 'tp-cue-sfx', PROXIMITY: 'tp-cue-prox', 'RE-HOOK': 'tp-cue-rehook', PAUSE: 'tp-cue-pause' };

const clock = (sec) => formatTime(sec).padStart(5, '0');

// Display only: timing lives in core. This just styles [tags] inside the text.
const renderText = (text) =>
  text.split(/(\[[^\]]*\])/).map((part, i) => {
    if (i % 2 === 0) return part;
    const kind = part.match(/^\[(SFX|PROXIMITY|RE-HOOK|PAUSE)\b/i)?.[1].toUpperCase();
    return (
      <span key={i} className={`tp-cue ${CUE_CLASS[kind] ?? 'tp-cue-other'}`}>
        {part}
      </span>
    );
  });

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 12l4 4 10-10" />
    </svg>
  );
}

export default function TeleprompterModal({ episode, onChange, onClose }) {
  const rootRef = useRef(null);
  const blockRefs = useRef({});
  const actions = useRef({});
  const loggedTimer = useRef(null);

  // Timer: store the Date.now() the run started and the time banked before it.
  // Elapsed is always recomputed from Date.now(), so a throttled background tab never drifts.
  const [baseMs, setBaseMs] = useState(0);
  const [startedAt, setStartedAt] = useState(null); // null = paused
  const [, setTick] = useState(0);
  const [fontSize, setFontSize] = useState(24);
  const [logged, setLogged] = useState(null); // seconds of the last logged clip, shown for 2s as confirmation

  const duration = useMemo(() => calcDuration(episode), [episode]);
  const blocks = useMemo(() => orderedBlocks(episode).filter((b) => b.text.trim()), [episode]);
  const timeOf = useMemo(() => Object.fromEntries(duration.timeline.map((t) => [t.blockId, t])), [duration]);

  const nowSec = () => (baseMs + (startedAt === null ? 0 : Date.now() - startedAt)) / 1000;
  const elapsed = nowSec();
  const currentId = blocks.filter((b) => elapsed >= timeOf[b.id].start).at(-1)?.id;
  const nextMilestone = MILESTONES.find((m) => elapsed < m.sec);
  const clips = episode.clips ?? [];
  const zoneCls = elapsed >= MILESTONES[1].sec ? 'zone-sweet' : elapsed >= MILESTONES[0].sec ? 'zone-compact' : 'zone-under';

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
  // Click a block or a milestone to jump the clock there (resync when you drift from the estimate).
  const jumpTo = (sec) => {
    setBaseMs(sec * 1000);
    if (startedAt !== null) setStartedAt(Date.now());
  };
  const logClip = () => {
    const seconds = Math.round(nowSec());
    onChange({ ...episode, clips: [...clips, { id: uid(), seconds, note: '' }] });
    setLogged(seconds);
    clearTimeout(loggedTimer.current);
    loggedTimer.current = setTimeout(() => setLogged(null), 2000);
  };
  const bump = (delta) => setFontSize((s) => Math.min(FONT_MAX, Math.max(FONT_MIN, s + delta)));
  const goFullscreen = () => rootRef.current?.requestFullscreen?.()?.catch(() => {});

  actions.current = { toggle, logClip, onClose, bump }; // always the latest closures for the key handler

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => () => clearTimeout(loggedTimer.current), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) actions.current.toggle();
      } else if (e.code === 'KeyC' && !e.repeat) actions.current.logClip();
      else if (e.code === 'Escape') actions.current.onClose();
      else if (!e.ctrlKey && !e.metaKey && (e.key === '+' || e.key === '=')) actions.current.bump(FONT_STEP);
      else if (!e.ctrlKey && !e.metaKey && (e.key === '-' || e.key === '_')) actions.current.bump(-FONT_STEP);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    blockRefs.current[currentId]?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  }, [currentId]);

  const rows = [];
  let prevAct = null;
  let prevRegister = null;
  for (const b of blocks) {
    const reg = episode.registers.find((r) => r.id === b.registerId);
    const tone = toneOf(episode.registers, b.registerId);
    const switched = prevRegister !== null && prevRegister !== b.registerId;
    const newAct = prevAct !== b.actId;
    prevAct = b.actId;
    prevRegister = b.registerId;
    const isCurrent = b.id === currentId;

    rows.push(
      <Fragment key={b.id}>
        {newAct && <h2 className="tp-act">{ACTS.find((a) => a.id === b.actId)?.title ?? b.actId}</h2>}
        <div
          ref={(el) => {
            blockRefs.current[b.id] = el;
          }}
          role="button"
          tabIndex={0}
          aria-current={isCurrent}
          onClick={() => jumpTo(timeOf[b.id].start)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') jumpTo(timeOf[b.id].start);
          }}
          className={`tp-block tone-${tone}${isCurrent ? ' is-current' : ''}`}
        >
          <div className="tp-banner">
            <span className="tp-reg">{reg ? reg.name : 'Unknown register'}</span>
            {reg && <span className="tp-wpm num">{reg.wpm} WPM</span>}
            {switched && <span className="tp-tag tp-tag-switch">Voice switch</span>}
            {b.zone === ZONES.EXPANSION && <span className="tp-tag">Expansion</span>}
            {b.label && <span className="tp-label">{b.label}</span>}
            {isCurrent && <span className="tp-now">Now</span>}
            <span className="tp-est num">est. {clock(timeOf[b.id].start)}</span>
          </div>
          <p className="tp-script" style={{ fontSize: `${fontSize}px` }}>
            {renderText(b.text)}
          </p>
        </div>
      </Fragment>,
    );
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Studio Teleprompter"
      onMouseDown={(e) => e.preventDefault()} // keep focus on the page so Space always toggles the timer
      className="tp"
    >
      <header className="tp-hud">
        <div className="tp-hud-row">
          <div className={`tp-clockbox ${zoneCls}`}>
            <div className="tp-timer num" aria-live="off">
              {clock(elapsed)}
            </div>
            <span role="status" className="tp-state">
              {startedAt === null ? 'Paused' : 'Running'}
            </span>
          </div>

          <div className="tp-transport">
            <button onClick={toggle} className={`tp-btn ${startedAt === null ? 'tp-btn-go' : 'tp-btn-pause'}`}>
              {startedAt === null ? (elapsed > 0 ? 'Resume' : 'Start') : 'Pause'}
              <kbd className="tp-kbd">Space</kbd>
            </button>
            <button onClick={reset} className="tp-btn">
              Reset
            </button>
          </div>

          <div className="tp-clipwrap">
            <button onClick={logClip} className="tp-clip">
              Log Clip / Good Take
              <kbd className="tp-key">C</kbd>
            </button>
            <span role="status" className="tp-logged num">
              {logged !== null ? `Logged at ${clock(logged)}` : ''}
            </span>
          </div>
        </div>

        <div className="tp-hud-row">
          <div className="tp-pills" role="group" aria-label="Pacing milestones">
            {MILESTONES.map((m, i) => {
              const reached = elapsed >= m.sec;
              const isNext = m === nextMilestone;
              const from = i === 0 ? 0 : MILESTONES[i - 1].sec;
              const fill = reached ? 100 : Math.max(0, Math.min(1, (elapsed - from) / (m.sec - from))) * 100;
              return (
                <button
                  key={m.sec}
                  onClick={() => jumpTo(m.sec)}
                  aria-label={`Jump to ${clock(m.sec)} ${m.name}`}
                  className={`tp-pill${reached ? ' is-reached' : isNext ? ' is-next' : ''}`}
                >
                  <span className="tp-pill-fill" style={{ width: `${fill}%` }} />
                  <span className="tp-pill-text num">
                    {clock(m.sec)} <strong>{m.name}</strong>
                    {reached && <Check />}
                    {isNext && <span className="tp-pill-in">in {clock(m.sec - elapsed)}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="tp-tools">
            <span className="tp-est-total num">Script est. {clock(duration.totalSeconds)}</span>
            <div className="tp-size" role="group" aria-label="Script text size">
              <button onClick={() => bump(-FONT_STEP)} disabled={fontSize <= FONT_MIN} aria-label="Smaller text" className="tp-btn tp-btn-sq">
                A−
              </button>
              <span className="tp-size-val num">{fontSize}px</span>
              <button onClick={() => bump(FONT_STEP)} disabled={fontSize >= FONT_MAX} aria-label="Larger text" className="tp-btn tp-btn-sq">
                A+
              </button>
            </div>
            <button onClick={goFullscreen} className="tp-btn">
              Fullscreen
            </button>
            <button onClick={onClose} className="tp-btn">
              Close
              <kbd className="tp-kbd">Esc</kbd>
            </button>
          </div>
        </div>
      </header>

      <main className="tp-main">
        {rows.length ? (
          <div className="tp-reader">{rows}</div>
        ) : (
          <p className="tp-empty">No script text yet. Write it in the 5-Act Script tab, then reopen the teleprompter.</p>
        )}
      </main>

      <footer className="tp-foot">
        <span className="tp-brand">VScript</span>
        <div className="tp-clips">
          <span className="tp-clips-count num">{clips.length} logged</span>
          {clips.slice(-6).map((c) => (
            <span key={c.id} className="tp-clip-chip num">
              {clock(c.seconds)}
            </span>
          ))}
        </div>
        <span className="tp-hint">
          <kbd className="tp-kbd">Space</kbd> start/pause <kbd className="tp-kbd">C</kbd> log clip <kbd className="tp-kbd">+</kbd>
          <kbd className="tp-kbd">−</kbd> text size. Click a block or milestone to jump the clock.
        </span>
      </footer>
    </div>
  );
}
