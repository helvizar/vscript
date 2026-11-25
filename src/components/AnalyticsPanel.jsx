// Form for entering YouTube Studio numbers after upload (Discovery, Retention, Audience & Trends) for one episode.
// Shows pattern insights across all saved episodes and copies a ready-made diagnosis prompt.

import { useMemo, useState } from 'react';
import { TRAFFIC_SOURCES } from '../core/schema.js';
import { buildDiagnosisPrompt, findPatterns } from '../core/aiCoachEngine.js';

const inputCls =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500';

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

// Empty box = null (not entered), so "0" and "unknown" stay different.
function NumberField({ label, hint, value, onChange, max, step = 1 }) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min="0"
        max={max}
        step={step}
        className={inputCls}
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
        className={inputCls}
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
      <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    </Field>
  );
}

function Bucket({ title, subtitle, children }) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {children}
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

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-lg font-semibold text-slate-100">Episode tags for pattern analysis</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Mood" hint="(e.g. Yandere, Stern, Soft Comfort)">
            <input
              list="mood-options"
              className={inputCls}
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
              className={inputCls}
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
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={!!episode.uploaded}
            onChange={(e) => onChange({ ...episode, uploaded: e.target.checked })}
          />
          Uploaded to YouTube (only uploaded episodes count toward pattern insights)
        </label>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Bucket title="Discovery" subtitle="Did people click?">
          <NumberField label="Impressions" value={d.impressions} onChange={(v) => setBucket('discovery', 'impressions', v)} />
          <NumberField label="CTR" hint="(%)" max={100} step={0.1} value={d.ctr} onChange={(v) => setBucket('discovery', 'ctr', v)} />
          <Field label="Primary traffic source">
            <select
              className={inputCls}
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

        <Bucket title="Retention" subtitle="Did they stay?">
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

        <Bucket title="Audience & Trends" subtitle="What did they say?">
          <div className="grid grid-cols-2 gap-4">
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

      <section className="space-y-3 rounded-lg border border-violet-900 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-100">AI Pattern Insights</h3>
          <div className="flex items-center gap-3">
            {copyMsg && (
              <span role="status" className="text-sm text-slate-300">
                {copyMsg}
              </span>
            )}
            <button
              onClick={copyDiagnosis}
              className="rounded-md bg-violet-500 px-4 py-2 font-semibold text-white hover:bg-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              Copy Diagnosis Prompt
            </button>
          </div>
        </div>

        {patterns.sampleSize >= 2 && patterns.lowConfidence && (
          <p className="text-sm text-amber-300">
            Small sample ({patterns.sampleSize} episodes): treat these as hints, not proof.
          </p>
        )}
        <ul className="list-disc space-y-1 pl-5 text-slate-300">
          {patterns.insights.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        {patterns.topRequests.length > 0 && (
          <p className="text-sm text-slate-400">
            Most requested by viewers:{' '}
            {patterns.topRequests.map((q) => `${q.text} (x${q.count})`).join(', ')}
          </p>
        )}
      </section>
    </div>
  );
}
