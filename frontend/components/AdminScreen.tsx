import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentType, Condition } from '../types';

declare global {
  interface Window { google?: any }
}

interface TranscriptLine { sender: 'user' | 'agent' | 'system'; text: string; t: number | null }

interface SessionRow {
  id: string;
  run?: string;
  condition: string;
  agentType: string;
  model?: string;
  giveaways?: boolean;
  debug?: boolean;
  status: 'started' | 'completed' | 'no_partner';
  endReason?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  rating?: number;
  turnsUser?: number;
  turnsAgent?: number;
  wordsUser?: number;
  wordsAgent?: number;
  durationSeconds?: number;
  transcript?: TranscriptLine[];
}

interface Settings { giveaways: boolean; run: string; runs: string[] }

// Per condition: the two agents (first = series 1, second = series 2) and the
// rating-scale anchors shown to students on the evaluation screen.
const CONDITION_SPECS: { condition: Condition; agents: [AgentType, AgentType]; anchors: [string, string] }[] = [
  { condition: Condition.ELIZA_VS_GEMINI, agents: [AgentType.ELIZA_CLASSIC, AgentType.GEMINI_ELIZA], anchors: ['Definitely Classic Eliza', 'Definitely Modern AI'] },
  { condition: Condition.GEMINI_VS_STANFORD, agents: [AgentType.REAL_STUDENT, AgentType.GEMINI_STUDENT], anchors: ['Definitely AI', 'Definitely Human'] },
  { condition: Condition.BASE_VS_POSTTRAINED, agents: [AgentType.LLAMA_BASE, AgentType.LLAMA_POSTTRAINED], anchors: ['Definitely Base', 'Definitely Post-trained'] },
];

const AGENT_LABELS: Record<string, string> = {
  ELIZA_CLASSIC: 'Classic Eliza',
  GEMINI_ELIZA: 'Gemini as Eliza',
  GEMINI_STUDENT: 'Gemini as student',
  REAL_STUDENT: 'Real student',
  LLAMA_BASE: 'Llama base',
  LLAMA_POSTTRAINED: 'Llama post-trained',
};

const SERIES_COLORS = ['#3987e5', '#d95926']; // validated on the #1f2937 surface (dark mode)
const RATINGS = [1, 2, 3, 4, 5, 6, 7];
const TOKEN_KEY = 'turing-admin-token';

type RangeKey = '2h' | 'today' | '7d' | 'all' | 'custom';
const RANGE_LABELS: Record<RangeKey, string> = {
  '2h': 'Last 2 hours', today: 'Today', '7d': 'Last 7 days', all: 'All time', custom: 'Custom…',
};

// [from, to] in ms for a time-range preset; null bounds are open.
const rangeBounds = (key: RangeKey, customFrom: string, customTo: string): [number | null, number | null] => {
  const now = Date.now();
  if (key === '2h') return [now - 2 * 3600 * 1000, null];
  if (key === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return [d.getTime(), null]; }
  if (key === '7d') return [now - 7 * 24 * 3600 * 1000, null];
  if (key === 'custom') return [customFrom ? new Date(customFrom).getTime() : null, customTo ? new Date(customTo).getTime() : null];
  return [null, null];
};

const storage = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v: string) => { try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* ignore */ } },
  clear: () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

const summarize = (ratings: number[]) => {
  const n = ratings.length;
  const mean = n ? ratings.reduce((a, b) => a + b, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(ratings.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  const half = n > 1 ? 1.96 * sd / Math.sqrt(n) : NaN;
  const counts = RATINGS.map((r) => ratings.filter((x) => x === r).length);
  return { n, mean, lo: mean - half, hi: mean + half, counts };
};

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');

// Column with a 4px rounded top and a square base.
const columnPath = (x: number, y: number, w: number, h: number) => {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

interface Tip { x: number; y: number; value: string; label: string }

const ConditionChart: React.FC<{ spec: typeof CONDITION_SPECS[number]; sessions: SessionRow[] }> = ({ spec, sessions }) => {
  const [tip, setTip] = useState<Tip | null>(null);
  const stats = spec.agents.map((a) => summarize(
    sessions.filter((s) => s.agentType === a && typeof s.rating === 'number').map((s) => s.rating as number)));

  const W = 560, H = 286, left = 44, right = 16, top = 12, histH = 170, stripTop = 240;
  const plotW = W - left - right;
  const band = plotW / 7;
  const barW = Math.min(24, (band - 10) / 2);
  const xCenter = (r: number) => left + band * (r - 0.5);
  const xScale = (v: number) => left + ((v - 0.5) / 7) * plotW; // continuous, for means
  const props = stats.map((s) => s.counts.map((c) => (s.n ? c / s.n : 0)));
  const maxP = Math.max(0.25, ...props.flat());
  const yMax = Math.ceil(maxP * 10) / 10;
  const yScale = (p: number) => top + histH - (p / yMax) * histH;
  const yTicks = Array.from({ length: Math.round(yMax / 0.1) + 1 }, (_, i) => i * 0.1)
    .filter((_, i, arr) => arr.length <= 6 || i % 2 === 0);

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 relative">
      <h3 className="text-lg font-semibold text-gray-100">{spec.condition}</h3>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 mb-1 text-sm text-gray-300">
        {spec.agents.map((a, i) => (
          <span key={a} className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: SERIES_COLORS[i] }} />
            {AGENT_LABELS[a]}
            <span className="text-gray-400">n = {stats[i].n}, mean {fmt(stats[i].mean)}</span>
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`${spec.condition}: rating distributions and means`}
        onPointerLeave={() => setTip(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={yScale(t)} y2={yScale(t)} stroke="#374151" strokeWidth={1} />
            <text x={left - 8} y={yScale(t) + 4} textAnchor="end" fontSize={11} fill="#9ca3af">{Math.round(t * 100)}%</text>
          </g>
        ))}
        {RATINGS.map((r) => (
          <text key={r} x={xCenter(r)} y={top + histH + 18} textAnchor="middle" fontSize={12} fill="#d1d5db">{r}</text>
        ))}
        <text x={left} y={top + histH + 36} fontSize={11} fill="#9ca3af">{spec.anchors[0]}</text>
        <text x={W - right} y={top + histH + 36} textAnchor="end" fontSize={11} fill="#9ca3af">{spec.anchors[1]}</text>

        {spec.agents.map((a, i) => RATINGS.map((r, ri) => {
          const p = props[i][ri];
          const x = xCenter(r) + (i === 0 ? -barW - 1 : 1);
          const y = yScale(p);
          const label = `${AGENT_LABELS[a]} · rating ${r}`;
          const value = `${Math.round(p * 100)}% (${stats[i].counts[ri]} of ${stats[i].n})`;
          return (
            <g key={`${a}-${r}`}>
              <path d={columnPath(x, y, barW, top + histH - y)} fill={SERIES_COLORS[i]}
                opacity={tip && tip.label !== label ? 0.55 : 1} />
              <rect x={x - 1} y={top} width={barW + 2} height={histH} fill="transparent"
                onPointerMove={() => setTip({ x: x + barW / 2, y, value, label })} />
            </g>
          );
        }))}

        {/* Means with 95% CIs on the same 1–7 axis */}
        <text x={left - 8} y={stripTop + 18} textAnchor="end" fontSize={11} fill="#9ca3af">means</text>
        {spec.agents.map((a, i) => {
          const s = stats[i];
          if (!s.n) return null;
          const cy = stripTop + 6 + i * 18;
          const label = `${AGENT_LABELS[a]} · mean`;
          const value = `${fmt(s.mean)} [95% CI ${fmt(s.lo)}, ${fmt(s.hi)}]`;
          return (
            <g key={a} onPointerMove={() => setTip({ x: xScale(s.mean), y: cy - 6, value, label })}>
              {Number.isFinite(s.lo) && (
                <line x1={xScale(Math.max(1, s.lo))} x2={xScale(Math.min(7, s.hi))} y1={cy} y2={cy}
                  stroke={SERIES_COLORS[i]} strokeWidth={2} strokeLinecap="round" />
              )}
              <circle cx={xScale(s.mean)} cy={cy} r={5} fill={SERIES_COLORS[i]} stroke="#1f2937" strokeWidth={2} />
              <rect x={left} y={cy - 8} width={plotW} height={16} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="pointer-events-none absolute bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-xs shadow-lg"
          style={{ left: `calc(${(tip.x / W) * 100}% + 20px)`, top: `calc(${(tip.y / H) * 100}% + 40px)`, transform: 'translate(-50%, -100%)' }}>
          <div className="text-gray-100 font-semibold text-sm">{tip.value}</div>
          <div className="text-gray-400">{tip.label}</div>
        </div>
      )}
    </div>
  );
};

export const AdminScreen: React.FC = () => {
  const [clientId, setClientId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(storage.get());
  const [authError, setAuthError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);
  const [range, setRange] = useState<RangeKey>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | 'on' | 'off'>('all');
  const [includeDebug, setIncludeDebug] = useState(false);
  const [hideIdentity, setHideIdentity] = useState(true);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [newRun, setNewRun] = useState('');

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((d) => setClientId(d?.oauthClientId || '')).catch(() => setClientId(''));
  }, []);

  // Google Identity Services sign-in button
  useEffect(() => {
    if (token || !clientId) return;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp: { credential: string }) => { storage.set(resp.credential); setToken(resp.credential); setAuthError(null); },
      });
      const el = document.getElementById('gsi-button');
      if (el) window.google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large' });
    };
    if (window.google?.accounts?.id) { init(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = init;
    document.head.appendChild(script);
  }, [token, clientId]);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    if (res.status === 401 || res.status === 403) {
      const body = await res.json().catch(() => ({}));
      storage.clear();
      setToken(null);
      setAuthError(res.status === 403 ? `${body.email || 'This account'} is not on the admin list.` : 'Sign-in expired. Please sign in again.');
      throw new Error('auth');
    }
    return res;
  }, [token]);

  const loadSettings = useCallback(async () => {
    const s: Settings = await (await api('/api/admin/settings')).json();
    setSettings(s);
    setSelectedRun((prev) => prev ?? s.run);
  }, [api]);

  const loadSessions = useCallback(async () => {
    if (selectedRun === null) return;
    setLoading(true);
    try {
      const rows: SessionRow[] = await (await api(`/api/admin/sessions?run=${encodeURIComponent(selectedRun)}`)).json();
      setSessions(rows);
    } finally {
      setLoading(false);
    }
  }, [api, selectedRun]);

  useEffect(() => { if (token) loadSettings().catch(() => {}); }, [token, loadSettings]);
  useEffect(() => {
    if (!token || selectedRun === null) return;
    loadSessions().catch(() => {});
    if (!live) return;
    const id = window.setInterval(() => loadSessions().catch(() => {}), 5000);
    return () => window.clearInterval(id);
  }, [token, selectedRun, live, loadSessions]);

  const updateSettings = async (update: Partial<Settings>) => {
    const s: Settings = await (await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(update) })).json();
    setSettings(s);
    if (update.run) setSelectedRun(update.run);
  };

  const filtered = useMemo(() => {
    const [from, to] = rangeBounds(range, customFrom, customTo);
    return sessions.filter((s) => {
      const t = s.startedAt ? Date.parse(s.startedAt) : NaN;
      return (includeDebug || !s.debug) &&
        (modeFilter === 'all' || (modeFilter === 'on') === Boolean(s.giveaways)) &&
        (from === null || t >= from) && (to === null || t <= to);
    });
  }, [sessions, includeDebug, modeFilter, range, customFrom, customTo]);
  const completed = useMemo(() => filtered.filter((s) => s.status === 'completed')
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')), [filtered]);

  // Exports exactly what the filters above select.
  const downloadCsv = () => {
    const cols: (keyof SessionRow)[] = ['id', 'run', 'condition', 'agentType', 'model', 'giveaways', 'debug', 'status', 'endReason',
      'startedAt', 'completedAt', 'rating', 'turnsUser', 'turnsAgent', 'wordsUser', 'wordsAgent', 'durationSeconds'];
    const esc = (v: unknown) => {
      if (v === undefined || v === null) return '';
      const str = String(v);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = [cols.join(',')].concat(filtered.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `turing-${selectedRun || 'all-runs'}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-6 text-center">
        <h1 className="text-3xl font-bold text-gray-100 mb-4">Turing Test Admin</h1>
        {clientId === '' && <p className="text-red-300">Admin sign-in is not configured (GOOGLE_OAUTH_CLIENT_ID is unset).</p>}
        {authError && <p className="text-red-300 mb-4">{authError}</p>}
        <div id="gsi-button" />
      </div>
    );
  }

  const agentRows = CONDITION_SPECS.flatMap((spec) => spec.agents.map((a) => {
    const rows = filtered.filter((s) => s.agentType === a);
    const done = rows.filter((s) => s.status === 'completed');
    const ratings = done.filter((s) => typeof s.rating === 'number').map((s) => s.rating as number);
    return {
      condition: spec.condition, agent: a, started: rows.length, completed: done.length,
      noPartner: rows.filter((s) => s.status === 'no_partner').length,
      abandoned: rows.filter((s) => s.status === 'started').length,
      stats: summarize(ratings),
      wordsPerTurn: done.reduce((t, s) => t + (s.wordsAgent || 0), 0) / Math.max(1, done.reduce((t, s) => t + (s.turnsAgent || 0), 0)),
    };
  }));

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h1 className="text-2xl md:text-3xl font-bold">Turing Test Results</h1>
          <button className="text-sm text-gray-400 hover:text-gray-200" onClick={() => { storage.clear(); setToken(null); }}>Sign out</button>
        </div>

        {/* Filters and settings, one row */}
        <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-gray-400">Time</span>
            <select className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1"
              value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
              {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABELS[k]}</option>)}
            </select>
          </label>
          {range === 'custom' && (
            <span className="flex items-center gap-2">
              <input type="datetime-local" className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1"
                value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span className="text-gray-400">to</span>
              <input type="datetime-local" className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1"
                value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </span>
          )}
          <label className="flex items-center gap-2">
            <span className="text-gray-400">Run</span>
            <select className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1"
              value={selectedRun ?? ''} onChange={(e) => setSelectedRun(e.target.value)}>
              <option value="">All runs</option>
              {(settings?.runs || []).map((r) => <option key={r} value={r}>{r}{r === settings?.run ? ' (current)' : ''}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-gray-400">Interface</span>
            <select className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1"
              value={modeFilter} onChange={(e) => setModeFilter(e.target.value as 'all' | 'on' | 'off')}>
              <option value="all">All sessions</option>
              <option value="off">Giveaways off</option>
              <option value="on">Giveaways on</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-gray-300">
            <input type="checkbox" checked={includeDebug} onChange={(e) => setIncludeDebug(e.target.checked)} /> Include debug
          </label>
          <label className="flex items-center gap-1 text-gray-300">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live (5s)
          </label>
          <button className="bg-gray-700 hover:bg-gray-600 rounded-md px-3 py-1" onClick={downloadCsv}>Download CSV</button>
          <span className={`text-gray-500 ${loading ? 'opacity-100' : 'opacity-0'}`}>refreshing…</span>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-6 flex flex-wrap items-center gap-4 text-sm">
          <span className="text-gray-400">New sessions go to run</span>
          <span className="font-mono text-gray-100">{settings?.run}</span>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newRun.trim()) { updateSettings({ run: newRun.trim() }); setNewRun(''); } }}>
            <input className="bg-gray-900 border border-gray-600 rounded-md px-2 py-1 w-56" placeholder="e.g. 2027-winter-lecture"
              value={newRun} onChange={(e) => setNewRun(e.target.value)} />
            <button className="bg-gray-700 hover:bg-gray-600 rounded-md px-3 py-1" type="submit">Start new run</button>
          </form>
          <span className="flex-1" />
          <span className="text-gray-400">Interface giveaways</span>
          <button
            className={`rounded-full px-4 py-1 font-semibold border ${settings?.giveaways ? 'bg-red-900/60 border-red-500 text-red-100' : 'bg-gray-700 border-gray-500 text-gray-100'}`}
            onClick={() => settings && updateSettings({ giveaways: !settings.giveaways })}>
            {settings?.giveaways ? 'ON (bots greet first, input locks, instant typing)' : 'OFF (bots and humans look alike)'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          {CONDITION_SPECS.map((spec) => (
            <ConditionChart key={spec.condition} spec={spec} sessions={completed.filter((s) => s.condition === spec.condition)} />
          ))}
        </div>

        <h2 className="text-xl font-semibold mb-2">Sessions by partner</h2>
        <p className="text-sm text-gray-400 mb-3">
          Uneven "started" counts within a condition, or many abandoned sessions for one partner, mean the completed ratings may not be representative.
        </p>
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left">
              <tr className="border-b border-gray-700">
                <th className="py-2 pr-3">Condition</th><th className="pr-3">Partner</th>
                <th className="pr-3 text-right">Started</th><th className="pr-3 text-right">Completed</th>
                <th className="pr-3 text-right">No partner</th><th className="pr-3 text-right">Abandoned</th>
                <th className="pr-3 text-right">Mean [95% CI]</th>
                <th className="pr-3 text-right">Ratings 1–7</th>
                <th className="pr-3 text-right">Partner words/turn</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {agentRows.map((r) => (
                <tr key={r.agent} className="border-b border-gray-800">
                  <td className="py-2 pr-3 text-gray-400">{r.condition}</td>
                  <td className="pr-3">{AGENT_LABELS[r.agent]}</td>
                  <td className="pr-3 text-right">{r.started}</td>
                  <td className="pr-3 text-right">{r.completed}</td>
                  <td className="pr-3 text-right">{r.agent === AgentType.REAL_STUDENT ? r.noPartner : '–'}</td>
                  <td className="pr-3 text-right">{r.abandoned}</td>
                  <td className="pr-3 text-right">{fmt(r.stats.mean)} [{fmt(r.stats.lo)}, {fmt(r.stats.hi)}]</td>
                  <td className="pr-3 text-right font-mono text-gray-300">{r.stats.counts.join(' ')}</td>
                  <td className="pr-3 text-right">{r.completed ? fmt(r.wordsPerTurn, 1) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-xl font-semibold">Transcripts ({completed.length})</h2>
          <label className="flex items-center gap-1 text-sm text-gray-300">
            <input type="checkbox" checked={hideIdentity} onChange={(e) => { setHideIdentity(e.target.checked); setRevealed(new Set()); }} />
            Hide partner identity (click to reveal; for guessing in class)
          </label>
        </div>
        <div className="space-y-2 mb-16">
          {completed.map((s) => {
            const hidden = hideIdentity && !revealed.has(s.id);
            const spec = CONDITION_SPECS.find((c) => c.condition === s.condition);
            return (
              <div key={s.id} className="bg-gray-800 border border-gray-700 rounded-lg">
                <button className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-left text-sm"
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                  <span className="text-gray-400 tabular-nums">{s.completedAt ? new Date(s.completedAt).toLocaleTimeString() : ''}</span>
                  <span className="text-gray-300">{s.condition}</span>
                  <span className="text-gray-400">{s.transcript?.length || 0} messages</span>
                  <span className="flex-1" />
                  <span className="text-gray-300">rated <b className="text-gray-100">{s.rating}</b>{spec ? ` (1 = ${spec.anchors[0]})` : ''}</span>
                  <span
                    className={`rounded px-2 py-0.5 ${hidden ? 'bg-gray-700 text-gray-400' : 'bg-gray-900 text-gray-100'}`}
                    onClick={(e) => { if (hidden) { e.stopPropagation(); setRevealed(new Set(revealed).add(s.id)); } }}>
                    {hidden ? 'reveal partner' : AGENT_LABELS[s.agentType] || s.agentType}
                  </span>
                </button>
                {openId === s.id && (
                  <div className="px-4 pb-4 space-y-2">
                    {(s.transcript || []).map((m, i) => (
                      <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] px-3 py-1.5 rounded-2xl text-sm ${m.sender === 'user' ? 'bg-blue-600 text-white' : m.sender === 'system' ? 'bg-red-900/60 text-red-200' : 'bg-gray-700 text-gray-100'}`}>
                          {m.text}
                        </div>
                      </div>
                    ))}
                    {!s.transcript?.length && <p className="text-gray-500 text-sm italic">No messages.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
