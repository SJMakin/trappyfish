import { useEffect, useState } from 'react';
import type { AnalysisProgress } from '../engine/trappy';

export function SearchActivity({ progress }: { progress: AnalysisProgress | null }) {
  const diagnostics = progress?.diagnostics;
  const [now, setNow] = useState(Date.now());
  const [updatedAt, setUpdatedAt] = useState(Date.now());
  useEffect(() => { const time = Date.now(); setUpdatedAt(time); setNow(time); }, [diagnostics]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  if (!diagnostics) return null;
  const compact = (value?: number) => value === undefined ? '—' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return <dl className="search-live-metrics" aria-label="Live search telemetry" data-testid="live-search-telemetry">
    <div><dt>Wall time</dt><dd>{((diagnostics.elapsedMs + Math.max(0, now - updatedAt)) / 1000).toFixed(1)}s</dd></div>
    <div><dt>SF searches</dt><dd>{diagnostics.stockfishCalls}</dd></div>
    <div><dt>Maia requests</dt><dd>{diagnostics.policyCalls}</dd></div>
    <div><dt>Reported nodes</dt><dd>{compact(diagnostics.nodes)}</dd></div>
    <div><dt>Last NPS</dt><dd>{compact(diagnostics.latestNps)}</dd></div>
    <div><dt>Depth / seldepth</dt><dd>{diagnostics.maxDepth ?? '—'} / {diagnostics.maxSelDepth ?? '—'}</dd></div>
  </dl>;
}
