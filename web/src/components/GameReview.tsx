import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Chess, type Move } from 'chess.js';
import { BookOpen, ChevronRight, GitBranch, History, Search } from 'lucide-react';
import { legalLine } from '../engine/analysisLines';
import { styleBonusCp } from '../engine/playingStyle';
import type { TrappySettings } from '../engine/trappy';
import { getDecisionTraceRevision, readDecisionTraces, subscribeDecisionTraces, type DecisionTrace } from '../history/decisionTraces';
import type { GameResult } from '../history/positionHistory';
import { decisionForReview, rerankStoredCandidates, strongestRecordedDefense, traceBaitLine, verifiedMotif } from '../history/reviewModel';
import { AnalysisHud } from './AnalysisHud';
import { AnalysisTree } from './AnalysisTree';
import './gameReview.css';

export type GameReviewProps = {
  gameId: string; moves: Move[]; result?: GameResult; traces?: DecisionTrace[];
  onSelectPosition?: (fen: string) => void;
};
const cp = (value: number) => Math.abs(value) >= 90_000 ? value > 0 ? 'Forced mate' : 'Losing to mate' : `${value > 0 ? '+' : ''}${Math.round(value)} cp`;
const label = (move: Move) => `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '…'} ${move.san}`;
const bookExit: Record<string, string> = {
  'book-unavailable': 'The imported book was unavailable. You chose to continue with normal search.',
  'no-legal-book-move': 'No compatible book continuation remained.', 'outside-risk': 'The book continuation exceeded the evaluation risk limit.',
  'forced-mate': 'A forced mate took priority over the book.', 'verification-unavailable': 'Book safety verification was unavailable.',
  deviation: 'The played moves left the selected opening lines. The game continued with normal search.',
  'line-complete': 'The selected opening line was complete. The game continued with normal search.',
};

export function GameReview({ gameId, moves, result, traces: suppliedTraces, onSelectPosition }: GameReviewProps) {
  const revision = useSyncExternalStore(subscribeDecisionTraces, getDecisionTraceRevision, getDecisionTraceRevision);
  const [loaded, setLoaded] = useState<DecisionTrace[]>([]); const [warning, setWarning] = useState<string>();
  const [loading, setLoading] = useState(!suppliedTraces); const [selectedPly, setSelectedPly] = useState<number>();
  useEffect(() => {
    if (suppliedTraces) { setLoading(false); return; }
    let active = true; setLoading(true);
    void readDecisionTraces(gameId).then((snapshot) => { if (active) { setLoaded(snapshot.traces); setWarning(snapshot.warning); setLoading(false); } });
    return () => { active = false; };
  }, [gameId, moves.length, revision, suppliedTraces]);
  const traces = suppliedTraces ?? loaded;
  const byPly = useMemo(() => new Map(traces.map((trace) => [trace.ply, trace])), [traces]);
  const moments = useMemo(() => [...traces].sort((a, b) => Number(Boolean(b.decision.selected.trap)) - Number(Boolean(a.decision.selected.trap))
    || Number(Boolean(b.decision.provenance?.bookExitReason)) - Number(Boolean(a.decision.provenance?.bookExitReason))
    || b.decision.selected.riskCp - a.decision.selected.riskCp || a.ply - b.ply).slice(0, 4).sort((a, b) => a.ply - b.ply), [traces]);
  const activePly = selectedPly ?? moments[0]?.ply ?? 1;
  const trace = byPly.get(activePly); const move = moves[activePly - 1];
  const select = (ply: number) => { setSelectedPly(ply); const selected = moves[ply - 1]; if (selected) onSelectPosition?.(selected.before); };
  const resultLabel = result?.reason === 'unfinished' ? 'Game ended unfinished' : result?.reason === 'resigned' ? 'Game ended by resignation'
    : result?.reason === 'checkmate' ? 'Checkmate' : result?.reason === 'draw' ? 'Draw' : 'Game review';
  return <section className="game-review" aria-label="Post-game review" data-testid="game-review">
    <header className="game-review-heading"><div><p className="game-review-eyebrow">The story of the game</p><h2>{resultLabel}</h2></div>
      <span>{moves.length} plies · {traces.length} recorded decisions</span></header>
    <p className="game-review-intro">Revisit the moves, the engine’s considered ideas, and the defenses it searched. These are records of its thinking at the time.</p>
    {warning && <p className="game-review-notice" role="status">{warning}</p>}
    {loading ? <p role="status">Loading recorded decisions…</p> : !traces.length ? <p className="game-review-notice">Detailed engine decisions are unavailable for this game. Older games and evicted traces still keep their complete saved moves.</p> : null}
    {moments.length ? <div className="game-review-moments" aria-label="Key moments">{moments.map((moment) => {
      const bait = traceBaitLine(moment); const turn = moves[moment.ply - 1];
      return <button type="button" key={moment.ply} className={activePly === moment.ply ? 'is-selected' : ''} onClick={() => select(moment.ply)} aria-pressed={activePly === moment.ply}>
        {moment.decision.provenance?.source === 'opening-book' ? <BookOpen size={17} aria-hidden="true" /> : <GitBranch size={17} aria-hidden="true" />}
        <span><b>{turn ? label(turn) : moment.decision.san}</b><small>{bait ? verifiedMotif(moment.rootFen, bait) : moment.decision.provenance?.bookExitReason ? 'Leaving the opening book' : moment.decision.provenance?.source === 'opening-book' ? 'Following the opening' : 'A recorded choice'}</small></span><ChevronRight size={15} aria-hidden="true" />
      </button>;
    })}</div> : null}
    <div className="game-review-layout">
      <div className="game-review-timeline"><h3><History size={15} aria-hidden="true" /> Complete move timeline</h3>
        <ol aria-label="Game move timeline">{moves.map((item, index) => <li key={`${index}-${item.san}`}>
          <button type="button" onClick={() => select(index + 1)} aria-pressed={activePly === index + 1}>
            <span>{label(item)}</span><small>{byPly.has(index + 1) ? 'Engine decision' : 'Played move'}</small>
          </button></li>)}</ol>
        {!moves.length ? <p>No moves were played.</p> : null}
      </div>
      <div className="game-review-detail" aria-live="polite">
        {trace ? <RecordedDecision key={`${gameId}:${trace.ply}`} trace={trace} actualMove={moves[trace.ply]} onSelectPosition={onSelectPosition} />
          : move ? <PlayedMoveReview key={activePly} move={move} onSelectPosition={onSelectPosition} />
            : <p>Choose a move to inspect its position.</p>}
      </div>
    </div>
  </section>;
}

function RecordedDecision({ trace, actualMove, onSelectPosition }: { trace: DecisionTrace; actualMove?: Move; onSelectPosition?: (fen: string) => void }) {
  const [previewFen, setPreviewFen] = useState(trace.rootFen);
  const preview = (fen: string) => { setPreviewFen(fen); onSelectPosition?.(fen); };
  const recorded = useMemo(() => decisionForReview(trace.decision), [trace.decision]);
  const selected = recorded.selected; const bait = traceBaitLine(trace);
  const baitLine = bait ? legalLine(trace.rootFen, bait) : undefined;
  const defense = strongestRecordedDefense(selected.replies);
  const actual = trace.actualReply ?? (actualMove ? { move: `${actualMove.from}${actualMove.to}${actualMove.promotion ?? ''}`, san: actualMove.san } : undefined);
  const reply = actual ? selected.replies.find((item) => item.move === actual.move) : undefined;
  const provenance = trace.decision.provenance;
  const openingExit = provenance?.bookExitReason ?? trace.openingExitReason;
  const style = selected.style;
  const contributions: [string, number][] = [
    ['Human-reply preference', selected.adjustedScoreCp - selected.rootScoreCp - styleBonusCp(style)], ['King attack', style?.aggressionBonusCp ?? 0], ['Pawn storms', style?.pawnStormBonusCp ?? 0],
    ['King caution', -(style?.kingCautionPenaltyCp ?? 0)], ['Sacrifice appetite', style?.sacrificeBonusCp ?? 0],
    ['Tension', style?.tensionBonusCp ?? 0], ['Queen retention', style?.queenRetentionBonusCp ?? 0],
    ['Sharpness', style?.sharpnessBonusCp ?? 0], ['Draw aversion', -(style?.drawAversionPenaltyCp ?? 0)],
  ];
  return <article className="recorded-decision">
    <div className="recorded-decision-title"><h3>Why {selected.san}?</h3><span>{provenance?.source === 'opening-book' ? 'Opening book · safety verified' : 'Engine search'}</span></div>
    {trace.book ? <p className="recorded-book-source">Game book: <strong>{trace.book.name}</strong>. Fingerprint <code>{trace.book.id.slice(0, 12)}</code>. {provenance?.source === 'opening-book' ? 'This move came from the book after the normal risk checks. Book weights supplied no extra ranking bonus.' : 'This move came from normal engine search.'}</p> : null}
    <div className="review-position-preview"><ReviewBoard fen={previewFen} /><div><button type="button" onClick={() => preview(trace.rootFen)}>Before move</button><button type="button" onClick={() => preview(legalLine(trace.rootFen, [selected.move]).fens[1] ?? trace.rootFen)}>After {selected.san}</button></div></div>
    <FreshAnalysisLink fen={previewFen} />
    {openingExit && <p className="game-review-notice">{bookExit[openingExit] ?? openingExit}</p>}
    <dl className="recorded-decision-facts"><div><dt>Soundest searched move</dt><dd>{trace.decision.rootBestSan} · {cp(trace.decision.rootBestScoreCp)}</dd></div>
      <div><dt>Chosen move evaluation</dt><dd>{cp(selected.rootScoreCp)}</dd></div>
      <div><dt>Evaluation given up</dt><dd>{Math.round(selected.riskCp)} cp / {trace.decision.riskLimitCp ?? trace.settings.maxRiskCp} cp limit</dd></div>
      <div><dt>Human reply model</dt><dd>{trace.decision.policySource === 'maia' ? `Maia ${trace.settings.opponentRating}` : !trace.styleEnabled ? 'Not used · Stockfish' : trace.decision.warning ? 'Unavailable · Stockfish fallback' : Math.abs(selected.rootScoreCp) >= 90000 ? 'Not used · forced mate' : 'Not requested · objective selection'}</dd></div></dl>
    <div className="recorded-decision-story">
      <div><h4>Considered bait</h4><p>{selected.trap ? <><b>{selected.trap.nextReply ? `${selected.trap.replySan}, then ${selected.trap.nextReply.replySan}` : selected.trap.replySan}</b> · {(selected.trap.probability * (selected.trap.nextReply?.probability ?? 1) * 100).toFixed(1)}% modeled path probability</> : 'No qualifying lure was recorded for this move.'}</p>
        {baitLine && <><p className="recorded-bait-line">{baitLine.labels.join(' ')}{baitLine.complete ? '' : ' … (stored line incomplete)'}</p><small>{verifiedMotif(trace.rootFen, bait!)}. This is a searched possibility, not a claim about what you would play.</small></>}</div>
      <div><h4>What actually happened</h4><p>{actual ? <><b>{actual.san}</b>{selected.trap?.reply === actual.move ? ' matched the first considered bait move.' : ' was played next.'}</> : 'No subsequent reply was played.'}</p>
        {trace.actualReply?.bookExitReason === 'deviation' ? <p>This reply left the selected opening lines. Normal search continued.</p> : null}
        {actual && !reply ? <small>This reply was not retained in the searched pool. No stored punishment is available.</small> : reply ? <small>Stored continuation: {legalLine(trace.rootFen, [selected.move, reply.move, ...reply.punishment]).labels.slice(2).join(' ') || 'No further move retained.'}</small> : null}</div>
      <div><h4>Best searched defense</h4><p>{defense ? <><b>{defense.san}</b> · {cp(defense.scoreCp)}</> : 'No explicit defense was retained; see the objective continuation below.'}</p></div>
    </div>
    <details className="recorded-preferences"><summary>Preference contributions <span>Ranking points</span></summary>
      <p>These points affect preference among eligible moves. They are separate from objective centipawn evaluation.</p>
      <dl>{contributions.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{Math.abs(selected.rootScoreCp) >= 90000 ? 'Bypassed for mate' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`}</dd></div>)}</dl>
      <p>Variety was {Math.round((trace.settings.variety ?? 0) * 100)}%. Selection: {trace.decision.selection?.method ?? 'best'}. All values above describe the original decision.</p>
    </details>
    <details className="recorded-tree"><summary><GitBranch size={15} aria-hidden="true" /> Explore recorded reply tree</summary>
      <p>This compact trace preserves selected branches. Omitted branches and older evicted traces cannot be reconstructed here.</p>
      <AnalysisTree fen={trace.rootFen} candidate={selected} onSelectLine={(line, ply) => { const path = legalLine(trace.rootFen, line.moves); preview(path.fens[Math.min(ply ?? path.moves.length, path.moves.length)]); }} />
      {selected.replies.filter((reply) => (reply.continuation?.alternatives?.length ?? 0) > 1).map((reply) => <div className="recorded-continuations" key={reply.move}>
        <h4>Engine choices after {reply.san}</h4><p>Deep compared these own continuations before selecting the branch above. Evaluations are for the engine; utility is a bounded evaluation rather than a win probability.</p>
        <div className="recorded-table-scroll"><table><thead><tr><th>Continuation</th><th>Defensive eval</th><th>Expected utility</th><th>Ranking</th></tr></thead><tbody>{reply.continuation!.alternatives!.map((alternative) => <tr key={alternative.move}>
          <th scope="row">{alternative.san}{alternative.selected ? ' · Chosen' : ''}</th><td>{cp(alternative.scoreCp)}</td><td>{alternative.expectedScore.toFixed(3)}</td><td>{alternative.selectionScoreCp.toFixed(1)}</td>
        </tr>)}</tbody></table></div>
      </div>)}
    </details>
    <StoredReranking trace={trace} />
    <details className="recorded-internals"><summary><Search size={15} aria-hidden="true" /> Original search internals & settings</summary>
      <p>Recorded budgets: root depth {trace.settings.rootDepth}, outcome depth {trace.settings.trapDepth}, {trace.settings.candidateCount} root candidates, {trace.settings.replyCount} human replies, {trace.settings.opponentPlies ?? 2} human turns, {trace.settings.continuationBranches ?? 3} refined first replies, {trace.settings.continuationReplies ?? 4} follow-up replies, {trace.settings.continuationCandidates ?? 1} engine continuations, {Math.round(trace.settings.replyCoverage * 100)}% target coverage.</p>
      <AnalysisHud decision={recorded} selected={selected} settings={trace.settings} />
    </details>
  </article>;
}

const reviewPieces: Record<string, string> = { wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙', bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟' };
function ReviewBoard({ fen }: { fen: string }) {
  const board = new Chess(fen);
  return <figure className="review-mini-board"><div role="img" aria-label={`Review board, ${board.turn() === 'w' ? 'White' : 'Black'} to move, White at bottom`} data-fen={fen}>
    {board.board().flat().map((piece, index) => <span key={index} aria-hidden="true" className={`${(Math.floor(index / 8) + index % 8) % 2 ? 'dark' : 'light'} ${piece?.color === 'w' ? 'white-piece' : 'black-piece'}`}>{piece ? reviewPieces[`${piece.color}${piece.type}`] : ''}</span>)}
  </div><figcaption>{board.turn() === 'w' ? 'White' : 'Black'} to move · White at bottom</figcaption></figure>;
}
function PlayedMoveReview({ move, onSelectPosition }: { move: Move; onSelectPosition?: (fen: string) => void }) {
  const [fen, setFen] = useState(move.before);
  const preview = (next: string) => { setFen(next); onSelectPosition?.(next); };
  return <article><h3>{label(move)}</h3><ReviewBoard fen={fen} /><p>This move is preserved in the game. No engine decision trace is available at this point.</p><div className="review-position-actions"><button type="button" onClick={() => preview(move.before)}>Before move</button><button type="button" onClick={() => preview(move.after)}>After move</button></div><FreshAnalysisLink fen={fen} /></article>;
}
function FreshAnalysisLink({ fen }: { fen: string }) {
  return <div className="review-fresh-analysis"><a href={`?fen=${encodeURIComponent(fen)}`} target="_blank" rel="noreferrer">Fresh analysis in a new tab</a><p>Runs a new search with the Analysis workspace’s settings, separate from this recorded decision.</p></div>;
}

const rerankParameters = [
  ['trappiness', 'Trappiness'], ['aggression', 'King attack'], ['pawnStorm', 'Pawn storms'], ['kingCaution', 'King caution'],
  ['sacrifice', 'Sacrifice appetite'], ['tension', 'Tension'], ['queenRetention', 'Queen retention'], ['sharpness', 'Sharpness'], ['drawAversion', 'Draw aversion'],
] as const;
function StoredReranking({ trace }: { trace: DecisionTrace }) {
  const [settings, setSettings] = useState<TrappySettings>({ ...trace.settings });
  const [parameter, setParameter] = useState<(typeof rerankParameters)[number][0]>('trappiness');
  const ranking = useMemo(() => rerankStoredCandidates(trace, settings), [trace, settings]);
  return <details className="recorded-reranking"><summary>Try different preferences among the searched candidates</summary>
    <p>This reweights the retained candidates using their stored outcomes and defense lines. It runs no new search, adds no new moves, and leaves the historical decision unchanged. Variety is not sampled here.</p>
    <label>Preference<select aria-label="Review preference to compare" value={parameter} onChange={(event) => setParameter(event.target.value as typeof parameter)}>{rerankParameters.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <label className="recorded-rerank-slider"><span>Preference strength <output>{Math.round((settings[parameter] ?? 0) * 100)}%</output></span><input aria-label="Review preference strength" type="range" min={0} max={1} step={0.05} value={settings[parameter] ?? 0} onChange={(event) => setSettings({ ...settings, [parameter]: Number(event.target.value) })} /></label>
    <button type="button" onClick={() => setSettings({ ...trace.settings })}>Restore recorded preferences</button>
    <ol className="recorded-ranking">{ranking.map(({ candidate, score, eligible }) => <li key={candidate.move}><b>{candidate.san}</b><span>{eligible ? `${score.toFixed(1)} points` : 'Outside risk limit'}{candidate.move === trace.decision.move ? ' · Played' : ''}</span></li>)}</ol>
    <p>Only a fresh analysis can discover different moves or defenses. The Analysis workspace runs that separate search.</p>
  </details>;
}
