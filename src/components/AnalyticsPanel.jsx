// Form for entering YouTube Studio numbers after upload (Discovery, Retention, Audience & Trends) for one episode.
// Shows pattern insights across all saved episodes and copies a ready-made diagnosis prompt.

import { useMemo, useState } from 'react';
import { TRAFFIC_SOURCES } from '../core/schema.js';
import { buildDiagnosisPrompt, findPatterns } from '../core/aiCoachEngine.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (n) => Math.round(n * 10) / 10;

// Compares one metric with the channel average. Needs 2+ uploaded episodes with data to have a baseline.
// Within 10% of the average counts as on par; the badge always says it in words, not only in color.
const compare = (value, avg, sampleSize, unit) => {
  if (!isNum(value)) return { cls: 'stat-none', text: 'No data yet', delta: '' };
  if (!isNum(avg) || sampleSize < 2) return { cls: 'stat-none', text: 'No baseline yet', delta: '' };
  const diff = value - avg;
  const rel = avg > 0 ? diff / avg : 0;
  const delta = `${diff >= 0 ? '+' : ''}${r1(diff)}${unit} vs channel average`;
  if (rel >= 0.1) return { cls: 'stat-good', text: 'Strong', delta };
  if (rel <= -0.1) return { cls: 'stat-low', text: 'Below average', delta };
  return { cls: 'stat-mid', text: 'On par', delta };
};

const mmss = (sec) => (isNum(sec) ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '—');

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

// Empty box = null (not entered), so "0" and "unknown" stay different.
function NumberField({ label, hint, value, onChange, max, step = 1 }) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min="0"
        max={max}
        step={step}
        className="input num"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </Field>
  );
}

function TextAreaField({ label, hint, value, onChange, placeholder }) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        rows={3}
        className="input"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// Keeps its own text while typing; commits the parsed array on blur so commas aren't eaten mid-typing.
function TagsField({ label, value, onCommit }) {
  const [text, setText] = useState((value ?? []).join(', '));
  const commit = () => {
    const tags = text.split(',').map((t) => t.trim()).filter(Boolean);
    setText(tags.join(', '));
    onCommit(tags);
  };
  return (
    <Field label={label} hint="(comma-separated)">
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    </Field>
  );
}

// Headline number for a bucket, with an optional status badge and small secondary readouts.
function Kpi({ label, value, unit, badge, stats = [] }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {badge && <span className={`stat-badge ${badge.cls}`}>{badge.text}</span>}
      </div>
      <p className="kpi-value num">
        {isNum(value) ? value : '—'}
        {isNum(value) && unit && <small>{unit}</small>}
      </p>
      {badge?.delta && <p className="kpi-delta num">{badge.delta}</p>}
      {stats.length > 0 && (
        <dl className="kpi-stats">
          {stats.map(([name, v]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Bucket({ title, subtitle, kpi, children }) {
  return (
    <section className="panel bucket">
      <div className="bucket-head">
        <h3 className="panel-title">{title}</h3>
        <p className="bucket-sub">{subtitle}</p>
      </div>
      {kpi}
      <div className="form-stack">{children}</div>
    </section>
  );
}

export default function AnalyticsPanel({ episode, episodes, onChange }) {
  const a = episode.analytics ?? {};
  const d = a.discovery ?? {};
  const rt = a.retention ?? {};
  const au = a.audience ?? {};

  const patterns = useMemo(() => findPatterns(episodes), [episodes]);
  const [copyMsg, setCopyMsg] = useState('');

  const setBucket = (bucket, field, value) =>
    onChange({ ...episode, analytics: { ...a, [bucket]: { ...a[bucket], [field]: value } } });

  // Existing values feed the suggestion lists so spelling stays consistent (pattern groups match on text).
  const known = (key) => [...new Set(episodes.map((e) => e[key]?.trim()).filter(Boolean))];

  const copyDiagnosis = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosisPrompt(episode, episodes));
      setCopyMsg('Copied!');
    } catch {
      setCopyMsg('Copy failed: the browser blocked clipboard access.');
    }
    setTimeout(() => setCopyMsg(''), 3000);
  };

  const ctrBadge = compare(d.ctr, patterns.overall.ctr, patterns.sampleSize, '%');
  const ret30Badge = compare(rt.retention30s, patterns.overall.retention30s, patterns.sampleSize, '%');

  return (
    <div className="col" style={{ gap: '1.5rem' }}>
      <section className="panel insights">
        <div className="insights-head">
          <div>
            <h3 className="panel-title">AI Pattern Insights</h3>
            <p className="panel-note">
              Built from <span className="num">{patterns.sampleSize}</span> uploaded episode{patterns.sampleSize === 1 ? '' : 's'} with
              analytics.
            </p>
          </div>
          <div className="row">
            {copyMsg && (
              <span role="status" className="msg">
                {copyMsg}
              </span>
            )}
            <button onClick={copyDiagnosis} className="btn btn-primary">
              Copy Diagnosis Prompt
            </button>
          </div>
        </div>

        {patterns.sampleSize >= 2 && patterns.lowConfidence && (
          <p className="notice-amber">
            Small sample (<span className="num">{patterns.sampleSize}</span> episodes): treat these as hints, not proof.
          </p>
        )}
        <ul className="tips">
          {patterns.insights.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        {patterns.topRequests.length > 0 && (
          <div className="chip-group">
            <span className="chip-group-label">Most requested by viewers</span>
            <div className="chips">
              {patterns.topRequests.map((q) => (
                <span key={q.text} className="chip chip-miss">
                  {q.text} <span className="num">x{q.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h3 className="panel-title">Episode tags for pattern analysis</h3>
        <div className="form-grid-2">
          <Field label="Mood" hint="(e.g. Yandere, Stern, Soft Comfort)">
            <input
              list="mood-options"
              className="input"
              value={episode.mood ?? ''}
              onChange={(e) => onChange({ ...episode, mood: e.target.value })}
            />
            <datalist id="mood-options">
              {known('mood').map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Hook style" hint="(e.g. Accusation / open loop)">
            <input
              list="hook-options"
              className="input"
              value={episode.hookStyle ?? ''}
              onChange={(e) => onChange({ ...episode, hookStyle: e.target.value })}
            />
            <datalist id="hook-options">
              {known('hookStyle').map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!episode.uploaded}
            onChange={(e) => onChange({ ...episode, uploaded: e.target.checked })}
          />
          Uploaded to YouTube (only uploaded episodes count toward pattern insights)
        </label>
      </section>

      <div className="bento">
        <Bucket
          title="Discovery"
          subtitle="Did people click?"
          kpi={
            <Kpi
              label="CTR"
              value={d.ctr}
              unit="%"
              badge={ctrBadge}
              stats={[
                ['Impressions', isNum(d.impressions) ? d.impressions.toLocaleString() : '—'],
                ['Top source', d.trafficSource || '—'],
              ]}
            />
          }
        >
          <NumberField label="Impressions" value={d.impressions} onChange={(v) => setBucket('discovery', 'impressions', v)} />
          <NumberField label="CTR" hint="(%)" max={100} step={0.1} value={d.ctr} onChange={(v) => setBucket('discovery', 'ctr', v)} />
          <Field label="Primary traffic source">
            <select
              className="input"
              value={d.trafficSource ?? ''}
              onChange={(e) => setBucket('discovery', 'trafficSource', e.target.value)}
            >
              <option value="">Not set</option>
              {TRAFFIC_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </Bucket>

        <Bucket
          title="Retention"
          subtitle="Did they stay?"
          kpi={
            <Kpi
              label="30-sec retention"
              value={rt.retention30s}
              unit="%"
              badge={ret30Badge}
              stats={[
                ['Avg view duration', mmss(rt.avdSeconds)],
                ['Avg % viewed', isNum(rt.avgPercentViewed) ? `${rt.avgPercentViewed}%` : '—'],
              ]}
            />
          }
        >
          <NumberField label="30-sec retention" hint="(%)" max={100} step={0.1} value={rt.retention30s} onChange={(v) => setBucket('retention', 'retention30s', v)} />
          <NumberField label="Average view duration" hint="(seconds)" value={rt.avdSeconds} onChange={(v) => setBucket('retention', 'avdSeconds', v)} />
          <NumberField label="Average percentage viewed" hint="(%)" max={100} step={0.1} value={rt.avgPercentViewed} onChange={(v) => setBucket('retention', 'avgPercentViewed', v)} />
          <NumberField label="Returning viewers" hint="(%)" max={100} step={0.1} value={rt.returningViewers} onChange={(v) => setBucket('retention', 'returningViewers', v)} />
          <TextAreaField
            label="Dip / spike timestamps"
            hint="(m:ss, one per line)"
            placeholder={'2:10 dip\n5:40 spike'}
            value={rt.dipSpikeTimestamps}
            onChange={(v) => setBucket('retention', 'dipSpikeTimestamps', v)}
          />
        </Bucket>

        <Bucket
          title="Audience & Trends"
          subtitle="What did they say?"
          kpi={
            <Kpi
              label="Likes"
              value={au.likes}
              stats={[
                ['Comments', isNum(au.comments) ? au.comments.toLocaleString() : '—'],
                ['Returning viewers', isNum(rt.returningViewers) ? `${rt.returningViewers}%` : '—'],
              ]}
            />
          }
        >
          <div className="form-grid-2">
            <NumberField label="Likes" value={au.likes} onChange={(v) => setBucket('audience', 'likes', v)} />
            <NumberField label="Comments" value={au.comments} onChange={(v) => setBucket('audience', 'comments', v)} />
          </div>
          <TextAreaField
            label="Top viewer requests"
            hint="(comma or line separated)"
            placeholder="more rain, softer voice"
            value={au.topRequests}
            onChange={(v) => setBucket('audience', 'topRequests', v)}
          />
          <TextAreaField label="Mood sentiment notes" value={au.moodNotes} onChange={(v) => setBucket('audience', 'moodNotes', v)} />
          <TagsField key={episode.id} label="Trend tags" value={au.trendTags} onCommit={(tags) => setBucket('audience', 'trendTags', tags)} />
        </Bucket>
      </div>
    </div>
  );
}
