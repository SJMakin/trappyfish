import { useEffect, useState } from 'react';
import { activityLabel, type PlayActivity } from '../play/activity';

export type FishState = 'idle' | 'search' | 'check' | 'capture' | 'victory' | 'defeat' | 'draw';

export function FishRival({ state, remark, activity, startedAt, searchSummary }: {
  state: FishState; remark: string; activity: PlayActivity | null; startedAt: number; searchSummary: string;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state !== 'search') return;
    const update = () => setElapsed(Math.max(0, (performance.now() - startedAt) / 1000));
    update(); const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [state, startedAt]);
  const searching = state === 'search';
  return <section className="fish-rival" aria-label="Your rival" data-state={state}>
    <div className="rival-intro">
      <div className="fish-portrait" aria-hidden="true">
        <svg viewBox="0 0 180 120" className="rival-fish">
          <defs><linearGradient id="fish-body" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#6fc5d6"/><stop offset="1" stopColor="#24778f"/></linearGradient></defs>
          <g className="fish-tail"><path d="M57 58 18 30 23 62 16 92 60 75Z" fill="#256f86"/><path d="m24 45 25 18-27 15" fill="none" stroke="#75bdcc" strokeWidth="3"/></g>
          <path d="m67 40 18-26 27 26" fill="#2f8397"/><path d="m77 85 23 21 13-22" fill="#2b7f94"/>
          <path d="M46 62C56 26 123 21 151 57 162 72 138 94 105 96 74 97 55 83 46 62Z" fill="url(#fish-body)"/>
          <path d="M68 76q19 19 40 12" fill="none" stroke="#88ccd6" strokeWidth="3" strokeLinecap="round"/>
          <path className="fish-fin" d="m87 58 21 11-20 11q8-13-1-22" fill="#c1e3de"/>
          <path d="M118 43q-10 21-1 39" fill="none" stroke="#1d6077" strokeWidth="2" opacity=".6"/>
          {state === 'defeat' ? <path d="m131 50 9 9m0-9-9 9" stroke="#102e42" strokeWidth="3"/> : <><circle cx="136" cy="54" r="9" fill="#e9f4ed"/><circle cx="139" cy="54" r="4" fill="#152f43"/><circle cx="140" cy="52" r="1.4" fill="white"/></>}
          <path d={state === 'victory' ? 'M145 70q-7 9-15 2' : state === 'check' ? 'M142 72q-4-6-8-1' : 'M145 70q-6 4-12 1'} fill="none" stroke="#163e54" strokeWidth="2.5" strokeLinecap="round"/>
          {state === 'search' ? <g className="fish-bubbles" fill="none" stroke="#6ba5b8" strokeWidth="2"><circle cx="160" cy="37" r="4"/><circle cx="168" cy="21" r="2"/></g> : null}
        </svg>
      </div>
      <div><span className="eyebrow">YOUR RIVAL</span><h2>Trappyfish</h2><p className="rival-remark" role="status">{remark}</p></div>
    </div>
    <div className="rival-activity" data-searching={searching} aria-label="Search activity">
      <div className="activity-heading"><span><i/>{searching ? activityLabel[activity?.stage ?? 'root'] : activity ? 'Last search' : 'At the board'}</span>
        {searching ? <time>{elapsed.toFixed(1)}s</time> : activity?.elapsedMs !== undefined ? <time>{(activity.elapsedMs / 1000).toFixed(1)}s</time> : null}</div>
      {activity ? <dl className="activity-stats">
        <div><dt>Nodes</dt><dd>{activity.nodes === undefined ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(activity.nodes)}</dd></div>
        <div><dt>Depth</dt><dd>{activity.depth ?? '—'}</dd></div>
        <div><dt>Engine searches</dt><dd>{activity.stockfishCalls}</dd></div>
        <div><dt>Human forecasts</dt><dd>{activity.policyCalls}</dd></div>
      </dl> : <p>Make a move. The search comes to life here.</p>}
      {searching && activity && activity.total > 1 ? <p className="activity-count">{activity.completed} / {activity.total} in this phase</p> : null}
      <small>{searchSummary} · Engine counters update as work completes.</small>
    </div>
  </section>;
}
