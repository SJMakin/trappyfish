import { useMemo, useState } from 'react';
import { ChevronRight, Crosshair, GitBranch, ShieldCheck, Sparkles } from 'lucide-react';
import type { CandidateInfo, MoveDecision, ReplyInfo } from '../engine/trappy';
import { candidateIdea, deriveCandidateLines, formatCp, legalLine, lineTarget, percent, pieceName, type ResearchLine, type VariationLine } from './analysisView';

export function TrapAnalysisPanel({ decision, fen, selectedMove, activeLineId, maxRiskCp, onSelectCandidate, onSelectLine }: {
  decision: MoveDecision; fen: string; selectedMove: string; activeLineId?: string; maxRiskCp: number;
  onSelectCandidate: (candidate: CandidateInfo) => void; onSelectLine: (line: ResearchLine) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const mover = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  const riskLimit = decision.riskLimitCp ?? (decision.rootBestScoreCp >= 500 ? Math.min(maxRiskCp, 40) : maxRiskCp);
  const allowObjective = decision.policySource === 'stockfish';
  const candidates = useMemo(() => [...decision.candidates].sort((a, b) => {
    const aSafe = isEligible(a, riskLimit, allowObjective); const bSafe = isEligible(b, riskLimit, allowObjective);
    return Number(bSafe) - Number(aSafe) || (bSafe && aSafe ? b.adjustedScoreCp - a.adjustedScoreCp : b.rootScoreCp - a.rootScoreCp);
  }), [decision, riskLimit]);
  const selected = candidates.find((candidate) => candidate.move === selectedMove) ?? decision.selected;
  const lines = deriveCandidateLines(fen, selected);
  const traps = lines.filter((line) => line.kind === 'trap');
  const defense = lines.find((line) => line.kind === 'defense' || line.kind === 'objective');
  const recommended = candidates.filter((candidate) => isEligible(candidate, riskLimit, allowObjective));
  const preview = showAll ? candidates : recommended.slice(0, 4);
  const practical = decision.selected;
  const sameRecommendation = practical.move === decision.rootBestMove;
  const showCandidateList = showAll || recommended.length > 1 || !sameRecommendation;

  return <section className="trap-analysis-panel" data-testid="analysis-results" data-analysis-fen={fen} aria-label="Position analysis results">
    <div className="research-section-heading"><h2>Position analysis</h2>
      <span className="research-pill">{mover} to move</span></div>
    <p className="research-perspective">Every score below is from {mover}’s perspective. Positive means good for {mover}.</p>
    {decision.warning ? <p className="import-warning" role="status">{decision.warning.replace('played Stockfish', 'showing Stockfish')}</p> : null}
    <div className={`recommendation-summary${sameRecommendation ? ' is-unified' : ''}`}>
      <button type="button" data-testid={showCandidateList ? undefined : 'analysis-candidate'} data-move={practical.move} aria-pressed={selected.move === practical.move}
        className={`recommendation practical${sameRecommendation ? ' unified' : ''}${selected.move === practical.move ? ' is-selected' : ''}`} onClick={() => onSelectCandidate(practical)}>
        <span><Sparkles size={15} /> {decision.policySource === 'maia' ? sameRecommendation ? 'Best practical · also soundest' : 'Best practical move' : 'Best Stockfish move'}</span>
        <strong>{practical.san}</strong><small>{decision.policySource === 'maia' && hasModel(practical) ? `${percent(practical.expectedScore)} modeled score` : `${formatCp(practical.rootScoreCp)} objective baseline`}</small>
        {sameRecommendation && decision.policySource === 'maia' ? <small className="recommendation-baseline"><ShieldCheck size={13} /> {formatCp(decision.rootBestScoreCp)} objective baseline</small> : null}
      </button>
      {!sameRecommendation ? <button type="button" className={selected.move === decision.rootBestMove ? 'recommendation sound is-selected' : 'recommendation sound'}
        onClick={() => { const best = candidates.find((candidate) => candidate.move === decision.rootBestMove); if (best) onSelectCandidate(best); }}>
        <span><ShieldCheck size={15} /> Soundest move</span><strong>{decision.rootBestSan}</strong><small>{formatCp(decision.rootBestScoreCp)} objective baseline</small>
      </button> : null}
    </div>

    <div className="research-section-heading compact candidate-options-heading"><h3>{candidates.length} candidate moves</h3>
      {candidates.length > 4 || candidates.some((candidate) => !isEligible(candidate, riskLimit, allowObjective)) ? <button type="button" className="research-text-button" onClick={() => setShowAll(!showAll)}>
        {showAll ? 'Show recommended moves' : `Compare all ${candidates.length} moves`}</button> : null}</div>
    {showCandidateList ? <div className="research-candidate-list">
      {preview.map((candidate, index) => {
        const modeled = hasModel(candidate); const eligible = isEligible(candidate, riskLimit, allowObjective);
        const status = (candidate as CandidateInfo & { status?: string }).status;
        return <button type="button" key={candidate.move} data-testid="analysis-candidate" data-move={candidate.move}
          aria-pressed={selected.move === candidate.move} onClick={() => onSelectCandidate(candidate)}
          className={`research-candidate ${selected.move === candidate.move ? 'is-selected' : ''} ${eligible ? '' : 'is-caution'}`}>
          <span className="candidate-number">{index + 1}</span><span className="candidate-content">
            <span className="candidate-top"><strong>{candidate.san}</strong><span className="candidate-tags">
              {candidate.move === practical.move ? <span className="mini-tag practical">Recommended</span> : null}
              {candidate.move === decision.rootBestMove ? <span className="mini-tag sound">Soundest</span> : null}
              {allowObjective && !modeled ? <span className="mini-tag caution">Human replies unavailable</span> : null}
              {!eligible ? <span className="mini-tag caution">{candidate.riskCp > riskLimit || status === 'outside-risk' ? 'Outside risk limit' : 'Human replies unsearched'}</span> : null}
            </span></span>
            <span className="candidate-metrics"><span><b>{formatCp(candidate.rootScoreCp)}</b> eval</span>
              {!eligible ? <span>Risk <b>{riskText(candidate, decision)}</b></span> : null}</span>
          </span><ChevronRight size={16} />
        </button>;
      })}
    </div> : null}

    <section className="candidate-investigation" aria-label={`Explore ${selected.san}`}>
      <div className="research-section-heading"><h2>Plans for {selected.san}</h2><Crosshair size={16} /></div>
      {!isEligible(selected, riskLimit, allowObjective) ? <p className="import-warning">This move is {selected.riskCp > riskLimit ? 'outside the safety limit' : 'not evaluated with human replies'}. It is an alternative to investigate, not a recommendation.</p> : null}
      <div className="research-metrics" aria-label="Selected move scores">
        <div><span>Conservative eval</span><strong>{formatCp(selected.rootScoreCp)}</strong></div>
        <div><span>Model score</span><strong>{hasModel(selected) ? percent(selected.expectedScore) : '—'}</strong></div>
        <div><span>Mistake chance</span><strong>{hasModel(selected) && selected.mistakeProbability !== undefined ? percent(selected.mistakeProbability) : '—'}</strong></div>
      </div>

      <div className="branch-comparison">
        <div className="branch-column trap-column"><h3><Crosshair size={16} /> Mistakes to punish</h3>
          {traps.length ? <><BranchCard fen={fen} line={traps[0]} active={activeLineId === traps[0].id} onSelect={onSelectLine} />
            {traps.length > 1 ? <details className="more-trap-lines"><summary>{traps.length - 1} more trap {traps.length === 2 ? 'line' : 'lines'}</summary>
              {traps.slice(1).map((line) => <BranchCard key={line.id} fen={fen} line={line} active={activeLineId === line.id} onSelect={onSelectLine} />)}</details> : null}</>
            : <div className="no-trap"><strong>{hasModel(selected) ? 'No clear trap found in these replies' : 'Human replies have not been evaluated'}</strong>
              <p>{hasModel(selected) ? 'Use the sound line, try another candidate, or deepen the search.' : 'Compare the objective continuation; no mistake probabilities are assumed.'}</p></div>}
        </div>
        <div className="branch-column defense-column"><h3><ShieldCheck size={16} /> If they defend correctly</h3>
          {defense ? <BranchCard fen={fen} line={defense} active={activeLineId === defense.id} onSelect={onSelectLine} /> : <p className="muted">No legal continuation returned.</p>}
        </div>
      </div>

      {selected.replies.length ? <details className="human-reply-tree"><summary><GitBranch size={16} /> All opponent replies <span>{selected.replies.length} first replies</span></summary>
        <div className="reply-tree-heading"><span>Opponent reply</span><span>Maia chance</span><span>Outcome</span></div>
        {[...selected.replies].sort((a, b) => b.probability - a.probability).map((reply) => {
          const isDefense = (reply as ReplyInfo & { bestDefense?: boolean }).bestDefense || defense?.reply?.move === reply.move;
          const direct: ResearchLine = { id: isDefense ? `${selected.move}/defense` : `${selected.move}/${reply.move}`, kind: isDefense ? 'defense' : reply.lossCp >= 80 ? 'trap' : 'reply',
            label: isDefense ? `Best defense: ${reply.san}` : `After ${reply.san}`, moves: [selected.move, reply.move, ...reply.punishment],
            probability: reply.probability, scoreCp: reply.scoreCp, reply };
          return <div className="reply-tree-branch" key={reply.move}>
            <button type="button" className="reply-tree-row" data-testid="analysis-reply" data-move={reply.move} onClick={() => onSelectLine(direct)}>
              <span><b>{reply.san}</b>{isDefense ? <small className="defense-label">Best defense</small> : reply.lossCp >= 100 ? <small className="mistake-label">Punishable</small> : null}</span>
              <span>{percent(reply.probability)}</span><span>{formatCp(reply.scoreCp)}</span>
            </button>
            {reply.continuation?.replies.length ? <details className="second-replies"><summary>After our {reply.continuation.san}: {reply.continuation.replies.length} next replies</summary>
              <p className="research-footnote">These chances are conditional on {reply.san} {reply.continuation.san}.</p>
              {[...reply.continuation.replies].sort((a, b) => b.probability - a.probability).map((next) => <button type="button" className="reply-tree-row" key={next.move}
                onClick={() => onSelectLine({ id: `${selected.move}/${reply.move}/${next.move}`, kind: next.bestDefense ? 'defense' : next.lossCp >= 80 ? 'trap' : 'reply', label: `After ${reply.san}, then ${next.san}`,
                  moves: [selected.move, reply.move, reply.continuation!.move, next.move, ...next.punishment], probability: reply.probability * next.probability,
                  conditionalProbability: next.probability, scoreCp: next.scoreCp, reply })}>
                <span><b>{next.san}</b>{(next as ReplyInfo & { bestDefense?: boolean }).bestDefense ? <small className="defense-label">Best defense</small> : null}</span>
                <span>{percent(next.probability)}</span><span>{formatCp(next.scoreCp)}</span>
              </button>)}
            </details> : null}
          </div>;
        })}
      </details> : null}
      <details className="analysis-score-details"><summary>Risk, coverage &amp; how scores work</summary>
        <p className="candidate-description">{candidateIdea(fen, selected)}</p>
        <p className="research-footnote">Risk: {riskText(selected, decision)}{Math.abs(selected.riskCp) < 90_000 ? ' pawns compared with the soundest move.' : ' compared with the soundest move.'} {hasModel(selected) ? `Human reply coverage: ${percent(selected.policyCoverage)}.` : 'Human reply probabilities unavailable for this move.'}</p>
        <p className="research-footnote">Conservative eval is the minimum of root and reply searches. Continuation outcomes use their own search depth and can differ. Mistake chance counts losses of at least one pawn.</p>
        <p className="research-footnote">Maia predicts move choices for the selected rating; Stockfish scores the outcomes. Model score is an evaluation based game score, not a measured win rate. Unsearched probability is assigned the best defense outcome. Deeper searches can change the ranking.</p>
      </details>
    </section>
  </section>;
}

function BranchCard({ fen, line, active, onSelect }: { fen: string; line: ResearchLine; active: boolean; onSelect: (line: ResearchLine) => void }) {
  const verified = legalLine(fen, line.moves);
  const targets = (line as Partial<VariationLine>).targets?.filter((target) => target.type !== 'capture' || target.square !== verified.moves[0]?.slice(2, 4))
    .sort((a, b) => ({ bait: 0, mate: 1, promotion: 2, capture: 3 }[a.type] - { bait: 0, mate: 1, promotion: 2, capture: 3 }[b.type]));
  return <button type="button" className={`research-branch-card ${active ? 'is-selected' : ''}`} aria-pressed={active} onClick={() => onSelect(line)}>
    <span className="branch-title">{line.label}<ChevronRight size={15} /></span>
    <span className="branch-preview">{verified.labels.slice(0, 6).join(' ')}{verified.moves.length > 6 ? ' …' : ''}</span>
    <span className="branch-target">{line.kind === 'trap' ? lineTarget(fen, line.moves).text : 'Keep this defense in mind when you choose your move.'}</span>
    {line.kind === 'trap' && targets?.length ? <span className="line-target-tags">{targets.slice(0, 4).map((target) => <span key={`${target.type}-${target.piece}-${target.square}`}>
      {target.type === 'bait' ? 'Bait' : target.type === 'mate' ? 'Mate target' : target.type === 'promotion' ? 'Promote' : 'Capture'}: {pieceName(target.piece)} {target.square}
    </span>)}</span> : null}
    <span className="branch-outcome"><b>{formatCp(line.scoreCp)}</b>{line.probability !== undefined ? <span>{percent(line.probability)} {line.conditionalProbability !== undefined ? 'joint chance' : 'Maia chance'}</span> : null}</span>
    {line.conditionalProbability !== undefined ? <small>{percent(line.conditionalProbability)} chance for the second reply, given the setup</small> : null}
    {!verified.complete ? <small className="import-warning">Continuation truncated at the last legal move.</small> : null}
  </button>;
}
function hasModel(candidate: CandidateInfo): boolean { return candidate.policyCoverage > 0 && ((candidate as CandidateInfo & { analyzed?: boolean }).analyzed ?? true); }
function isEligible(candidate: CandidateInfo, risk: number, allowObjective = false): boolean {
  const status = (candidate as CandidateInfo & { status?: string }).status;
  return candidate.riskCp <= risk && status !== 'outside-risk' && (allowObjective || status !== 'objective-only' || candidate.rootScoreCp >= 90_000);
}
function riskText(candidate: CandidateInfo, decision: MoveDecision): string {
  if (decision.rootBestScoreCp >= 90_000 && candidate.rootScoreCp < 90_000) return 'Gives up forced mate';
  if (candidate.rootScoreCp <= -90_000 && decision.rootBestScoreCp > -90_000) return 'Allows forced mate';
  return (candidate.riskCp / 100).toFixed(2);
}
