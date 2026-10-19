import { useId, useMemo, useState } from 'react';
import { Activity, Download, GitBranch, ShieldCheck } from 'lucide-react';
import type { AnalysisProgress, CandidateInfo, MoveDecision, TrappySettings } from '../engine/trappy';
import { candidateIdea, formatCp, percent, type ResearchLine } from './analysisView';
import { AnalysisTree } from './AnalysisTree';
import { AnalysisHud } from './AnalysisHud';
import './analysisConsole.css';

export function TrapAnalysisPanel({ decision, fen, selectedMove, activeLineId, activeMoves, maxRiskCp, settings,
  busy, progress, onSelectCandidate, onSelectLine }: {
  decision: MoveDecision; fen: string; selectedMove: string; activeLineId?: string; activeMoves?: string[];
  maxRiskCp: number; settings?: TrappySettings; busy?: boolean; progress?: AnalysisProgress | null;
  onSelectCandidate: (candidate: CandidateInfo) => void; onSelectLine: (line: ResearchLine, ply?: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const id = useId();
  const mover = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  const riskLimit = decision.riskLimitCp ?? maxRiskCp;
  const allowObjective = decision.policySource === 'stockfish';
  const candidates = useMemo(() => [...decision.candidates].sort((a, b) =>
    Number(isEligible(b, riskLimit, allowObjective)) - Number(isEligible(a, riskLimit, allowObjective))
    || b.adjustedScoreCp - a.adjustedScoreCp || b.rootScoreCp - a.rootScoreCp), [decision, riskLimit, allowObjective]);
  const selected = candidates.find((candidate) => candidate.move === selectedMove) ?? decision.selected;
  const recommended = candidates.filter((candidate) => isEligible(candidate, riskLimit, allowObjective));
  const preview = showAll ? candidates : recommended.slice(0, 6);
  const practical = decision.selected;
  const sameRecommendation = practical.move === decision.rootBestMove;
  const exportDiagnostics = () => {
    const payload = { format: 'trappyfish-analysis-v1', fen, settings, selectedMove: selected.move, decision };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'trappyfish-analysis-diagnostics.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className="trap-analysis-panel analysis-console" data-testid="analysis-results" data-analysis-fen={fen} aria-label="Position analysis results">
    <header className="console-heading"><div><span className="console-kicker"><Activity size={13} /> ENGINE LAB</span>
      <h2>Position analysis</h2></div><div className="console-heading-actions"><span className="console-source">{decision.policySource === 'maia' ? 'Stockfish + Maia' : 'Stockfish'}{decision.styleApplied ? ' + style' : ''}</span>
      <button type="button" onClick={exportDiagnostics} title="Export the full evaluated candidate and reply data"><Download size={13} /> JSON</button></div></header>
    <p className="research-perspective">Every score uses {mover}’s perspective, including later positions in the tree. Positive favours {mover}.</p>
    {decision.warning ? <p className="import-warning" role="status">{decision.warning.replace('played Stockfish', 'showing Stockfish')}</p> : null}
    <div className={`recommendation-summary${sameRecommendation ? ' is-unified' : ''}`}>
      <button type="button" data-move={practical.move} aria-pressed={selected.move === practical.move}
        className={`recommendation practical${sameRecommendation ? ' unified' : ''}${selected.move === practical.move ? ' is-selected' : ''}`} onClick={() => onSelectCandidate(practical)}>
        <span><GitBranch size={14} /> {decision.styleApplied ? 'Style recommendation' : decision.policySource === 'maia' ? 'Best practical move' : 'Best Stockfish move'}{sameRecommendation ? ' · also soundest' : ''}</span>
        <strong>{practical.san}</strong><small>{hasModel(practical) ? `${percent(practical.expectedScore)} bounded model utility` : `${formatCp(practical.rootScoreCp)} conservative evaluation`}</small>
      </button>
      {!sameRecommendation ? <button type="button" className={selected.move === decision.rootBestMove ? 'recommendation sound is-selected' : 'recommendation sound'}
        onClick={() => { const best = candidates.find((candidate) => candidate.move === decision.rootBestMove); if (best) onSelectCandidate(best); }}>
        <span><ShieldCheck size={14} /> Soundest move</span><strong>{decision.rootBestSan}</strong><small>{formatCp(decision.rootBestScoreCp)} conservative evaluation</small>
      </button> : null}
    </div>

    <div className="console-search-summary"><span>{decision.diagnostics
      ? `${decision.diagnostics.stockfishCalls} Stockfish calls · ${decision.diagnostics.policyCalls} policy requests · ${decision.diagnostics.nodes === undefined ? 'nodes unreported' : `${Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(decision.diagnostics.nodes)} nodes`} · ${(decision.diagnostics.elapsedMs / 1000).toFixed(1)}s`
      : 'Search telemetry unavailable for this result'}</span><nav aria-label="Analysis detail shortcuts"><a href={`#${id}-tree`}>Move tree</a><a href={`#${id}-internals`}>Engine internals</a></nav></div>

    <section className="candidate-matrix" aria-label="Candidate ranking matrix">
      <div className="console-section-heading"><h3>Candidate matrix <span>{candidates.length} moves</span></h3>
        {candidates.length > 6 || candidates.some((candidate) => !isEligible(candidate, riskLimit, allowObjective)) ? <button type="button" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show eligible moves' : `Compare all ${candidates.length} moves`}</button> : null}</div>
      <div className="candidate-matrix-scroll" tabIndex={0} aria-label="Scrollable candidate metrics">
        <table><thead><tr><th scope="col">Move</th><th scope="col" title="Original root search before defense verification">Root cp</th>
          <th scope="col" title="Minimum verified evaluation, fixed root mover perspective">Defense cp</th><th scope="col" title="Centipawn transform of expected bounded utility, before style">Model cp</th>
          <th scope="col">Risk cp</th><th scope="col" title="Probability of losing at least one pawn in the modeled replies">Mistake %</th><th scope="col" title="Final practical ranking including style preferences">Rank pts</th><th scope="col">Status</th></tr></thead>
          <tbody>{preview.map((candidate) => {
            const eligible = isEligible(candidate, riskLimit, allowObjective);
            return <tr key={candidate.move} className={`${selected.move === candidate.move ? 'is-selected' : ''} ${eligible ? '' : 'is-caution'}`}>
              <th scope="row"><button type="button" data-testid="analysis-candidate" data-move={candidate.move} aria-pressed={selected.move === candidate.move} onClick={() => onSelectCandidate(candidate)}>
                {candidate.san}{candidate.move === practical.move ? <span aria-label="Recommended">◆</span> : null}{candidate.move === decision.rootBestMove ? <ShieldCheck size={12} aria-label="Soundest" /> : null}
              </button></th><td>{candidate.initialScoreCp === undefined ? '—' : cp(candidate.initialScoreCp)}</td>
              <td>{cp(candidate.rootScoreCp)}</td><td>{hasModel(candidate) ? cp(candidate.expectedScoreCp) : '—'}</td>
              <td title={riskText(candidate, decision)}>{Math.abs(candidate.riskCp) >= 90_000 ? 'mate' : candidate.riskCp.toFixed(0)}</td>
              <td>{hasModel(candidate) && candidate.mistakeProbability !== undefined ? (candidate.mistakeProbability * 100).toFixed(1) : '—'}</td>
              <td>{cp(candidate.adjustedScoreCp)}</td><td><span className={`matrix-status ${eligible ? 'eligible' : 'rejected'}`}>{eligible ? candidate.analyzed === false ? 'objective' : 'eligible' : candidate.riskCp > riskLimit ? 'outside risk' : 'unsearched'}</span></td>
            </tr>;
          })}</tbody></table>
      </div>
      <p className="console-table-note">cp = centipawns. Rank points include playing preferences; they are not an objective evaluation. ◆ recommendation · shield = soundest.</p>
    </section>

    <div className="console-exploration">
    <section id={`${id}-tree`} className="candidate-investigation" aria-label={`Explore ${selected.san}`}>
      <div className="console-section-heading"><h3><GitBranch size={15} /> Branching search <strong>{selected.san}</strong></h3><span className="console-uci">{selected.move}</span></div>
      {!isEligible(selected, riskLimit, allowObjective) ? <p className="import-warning">{selected.riskCp > riskLimit ? 'Outside the risk limit' : 'Human replies unsearched'}: investigate this alternative separately from the recommendation.</p> : null}
      <p className="console-tree-intro">Click a move to inspect its exact position. Branches are evaluated human replies and Stockfish principal variations; the wider Stockfish search is summarized in the telemetry.</p>
      <AnalysisTree fen={fen} candidate={selected} activeLineId={activeLineId} activeMoves={activeMoves} onSelectLine={onSelectLine} />
    </section>
    <div id={`${id}-internals`} className="console-internals"><AnalysisHud decision={decision} selected={selected} settings={settings} busy={busy} progress={progress ?? undefined} /></div>
    </div>
    <details className="analysis-score-details"><summary>Scoring semantics &amp; selected idea</summary>
      <p className="candidate-description">{candidateIdea(fen, selected)}</p>
      <p className="research-footnote">Risk: {riskText(selected, decision)}. {hasModel(selected) ? `Human reply coverage: ${percent(selected.policyCoverage)}.` : 'Human reply probabilities unavailable for this move.'}</p>
      <p className="research-footnote">Conservative eval is the minimum of root and reply searches. Continuation outcomes use their own search depth and can differ. Mistake chance counts losses of at least one pawn. Model utility is bounded by sigmoid(cp / 200), with exact terminal outcomes; it is not a calibrated win rate.</p>
      <p className="research-footnote">Unsearched probability receives the strongest known defense outcome. Tree scores describe the evaluated branch outcome, rather than a fresh evaluation of every displayed position.</p>
    </details>
  </section>;
}

function cp(value: number): string { return Math.abs(value) >= 90_000 ? formatCp(value) : `${value >= 0 ? '+' : ''}${value.toFixed(0)}`; }
function hasModel(candidate: CandidateInfo): boolean { return candidate.policyCoverage > 0 && (candidate.analyzed ?? true); }
function isEligible(candidate: CandidateInfo, risk: number, allowObjective = false): boolean {
  return candidate.riskCp <= risk && candidate.status !== 'outside-risk'
    && (allowObjective || candidate.status !== 'objective-only' || candidate.rootScoreCp >= 90_000);
}
function riskText(candidate: CandidateInfo, decision: MoveDecision): string {
  if (decision.rootBestScoreCp >= 90_000 && candidate.rootScoreCp < 90_000) return 'Gives up forced mate';
  if (candidate.rootScoreCp <= -90_000 && decision.rootBestScoreCp > -90_000) return 'Allows forced mate';
  return `${candidate.riskCp.toFixed(0)}cp compared with the soundest move`;
}
