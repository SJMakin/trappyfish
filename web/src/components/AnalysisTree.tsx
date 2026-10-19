import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import type { CandidateInfo } from '../engine/trappy';
import { formatCp, percent, type ResearchLine } from '../engine/analysisLines';
import { buildAnalysisTree, type AnalysisMoveNode, type AnalysisTreeData, type AnalysisTreeNode } from '../engine/analysisTree';
import './analysisTree.css';

type AnalysisTreeProps = {
  fen: string; candidate: CandidateInfo; activeLineId?: string; activeMoves?: string[];
  onSelectLine: (line: ResearchLine, ply?: number) => void;
};

export function AnalysisTree({ fen, candidate, activeLineId, activeMoves, onSelectLine }: AnalysisTreeProps) {
  const tree = useMemo(() => buildAnalysisTree(fen, candidate), [fen, candidate]);
  const [expanded, setExpanded] = useState(() => defaultExpanded(tree));
  const [nodeLimit, setNodeLimit] = useState(500);
  const [inspectedId, setInspectedId] = useState<string>();
  const branchesRef = useRef<HTMLUListElement>(null);
  useEffect(() => { setExpanded(defaultExpanded(tree)); setNodeLimit(500); setInspectedId(undefined); }, [tree]);
  const allMoves = useMemo(() => flattenMoves(tree.root), [tree]);
  const currentPath = activeMoves?.join('/');
  useEffect(() => {
    if (!currentPath) return;
    const path = currentPath.split('/');
    setExpanded((prior) => {
      const next = new Set(prior);
      for (let ply = 1; ply < path.length; ply++) next.add(path.slice(0, ply).join('/'));
      return next;
    });
  }, [currentPath]);
  useEffect(() => {
    const container = branchesRef.current;
    const selected = container?.querySelector<HTMLButtonElement>('.analysis-tree-move[aria-pressed="true"]');
    if (!container || !selected) return;
    const viewport = container.getBoundingClientRect(); const node = selected.getBoundingClientRect();
    // Scroll the tree pane only; board replay and mobile node selection own page scrolling.
    if (node.top < viewport.top) container.scrollTop -= viewport.top - node.top + 8;
    else if (node.bottom > viewport.bottom) container.scrollTop += node.bottom - viewport.bottom + 8;
  }, [currentPath, expanded]);
  const inspected = allMoves.find((node) => node.id === currentPath)
    ?? allMoves.find((node) => node.id === inspectedId);
  const mover = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  const toggle = (node: AnalysisMoveNode) => setExpanded((prior) => {
    const next = new Set(prior); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next;
  });
  let rendered = 0;
  let limited = false;
  const renderNodes = (nodes: AnalysisTreeNode[], depth: number) => <ul className="analysis-tree-branches" ref={depth === 0 ? branchesRef : undefined} aria-label={depth === 0 ? 'Opponent replies and continuations' : 'Continuations'}>
    {nodes.map((node) => {
      if (rendered >= nodeLimit) { limited = true; return null; }
      rendered++;
      if (node.kind === 'residual') return <li className="analysis-tree-residual" key={node.id}>
        <div><span className="analysis-tree-residual-label">{node.label}</span><span className="analysis-tree-probability">
          <span title="Probability conditional on reaching this position">cond {percent(node.conditionalProbability)}</span>
          <span title="Probability of this path from the candidate move">joint {percent(node.jointProbability)}</span>
        </span></div>
        <small>Not searched · best-defense utility used in the model. No move inferred.</small>
      </li>;
      const isExpanded = expanded.has(node.id);
      const isActive = currentPath ? currentPath === node.id : false;
      const onPath = Boolean(currentPath && `${currentPath}/`.startsWith(`${node.id}/`));
      const hasChildren = node.children.length > 0;
      return <li className={`analysis-tree-node${onPath ? ' is-on-path' : ''}${isActive ? ' is-current' : ''}`} key={node.id}>
        <div className="analysis-tree-node-row">
          {hasChildren ? <button type="button" className="analysis-tree-toggle" aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} continuations after ${node.label}`} onClick={() => toggle(node)}>
            {isExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          </button> : <span className="analysis-tree-leaf" aria-hidden="true">·</span>}
          <button type="button" className={`analysis-tree-move ${node.role}`} aria-pressed={isActive}
            data-testid={node.ply === 2 && node.conditionalProbability !== undefined ? 'analysis-reply' : 'analysis-tree-move'} data-move={node.uci}
            data-ply={node.ply} data-role={node.role} data-path={node.id}
            title={`${node.label} (${node.uci}) · ${roleLabel(node)} · Replay the board at ply ${node.ply}`}
            onClick={() => { setInspectedId(node.id); onSelectLine(node.line, node.ply); }}>
            <span className="analysis-tree-move-heading"><b className="analysis-tree-san">{node.label}</b>
              <span className="analysis-tree-tags">
                {node.tags.includes('best-defense') ? <small className="tree-tag defense">Best defense</small> : null}
                {node.tags.includes('human-mistake') ? <small className="tree-tag mistake">Human mistake</small> : null}
                {node.role === 'engine-continuation' ? <small className="tree-tag engine">Engine</small> : null}
                {node.role === 'pv' ? <small className="tree-tag pv">PV</small> : null}
                {node.tags.includes('checkmate') ? <small className="tree-tag terminal">checkmate</small> : null}
                {node.tags.includes('draw') ? <small className="tree-tag terminal">draw</small> : null}
              </span>
            </span>
            <span className="analysis-tree-node-metrics">
              {node.conditionalProbability !== undefined ? <span className="analysis-tree-probability">
                <span title="Maia probability of this reply, conditional on reaching its parent position">cond {percent(node.conditionalProbability)}</span>
                {node.ply > 2 ? <span title="Joint Maia probability of reaching this reply from the candidate move">joint {percent(node.jointProbability ?? 0)}</span> : null}
              </span> : null}
              {node.scoreCp !== undefined ? <span className="analysis-tree-eval" title={`Evaluated branch outcome from ${mover}’s perspective; not a static evaluation at this node`}>{formatCp(node.scoreCp)} <small>branch</small></span> : null}
              {node.lossCp !== undefined && node.lossCp >= 80 ? <span className="analysis-tree-loss" title="Opponent evaluation loss relative to the strongest searched defense">{Math.abs(node.scoreCp ?? 0) >= 90_000 || node.lossCp >= 90_000 ? 'mate outcome' : `Δ ${(node.lossCp / 100).toFixed(2)}`}</span> : null}
              {node.role === 'pv' ? <span className="analysis-tree-pv-note">Stockfish continuation</span> : null}
              {hasChildren && !isExpanded ? <span className="analysis-tree-collapsed-note">{node.children.filter((child) => child.kind === 'move').length} continuation{node.children.filter((child) => child.kind === 'move').length === 1 ? '' : 's'} hidden{hasTerminalDescendant(node, 'checkmate') ? ' · checkmate branch' : hasTerminalDescendant(node, 'draw') ? ' · draw branch' : ''}</span> : null}
            </span>
          </button>
        </div>
        {hasChildren && isExpanded ? renderNodes(node.children, depth + 1) : null}
      </li>;
    })}
  </ul>;
  // Build the subtree before the limit notice so the node budget is accurate.
  const branches = tree.root ? renderNodes(tree.root.children, 0) : null;

  return <section className="analysis-move-tree" aria-label={`Branching analysis of ${candidate.san}`} data-testid="analysis-tree">
    <div className="analysis-tree-heading"><h3><GitBranch size={15} aria-hidden="true" /> Move tree</h3>
      <span>{tree.moveCount} positions · {tree.replyCount} modeled replies</span></div>
    <p className="analysis-tree-explanation">Maia chance: <b>cond</b> = reply given this position; <b>joint</b> = the complete human-choice path from {candidate.san}. Engine moves and PV tails have no assigned probability.</p>
    <div className="analysis-tree-toolbar"><span>Click a move to inspect its board.</span>
      <div><button type="button" onClick={() => setExpanded(new Set(allMoves.filter((node) => node.children.length).map((node) => node.id)))}>Expand all</button>
        <button type="button" onClick={() => setExpanded(new Set())}>Collapse all</button></div></div>
    {tree.root ? <>
      <div className="analysis-tree-root"><span><b>{tree.root.label}</b><small>Candidate · {mover}</small></span>
        <strong title={`Conservative objective evaluation from ${mover}’s perspective`}>{formatCp(candidate.rootScoreCp)} <small>objective</small></strong>
        {tree.root.tags.includes('checkmate') ? <small className="tree-tag terminal">checkmate</small> : null}
        {tree.root.tags.includes('draw') ? <small className="tree-tag terminal">draw</small> : null}
      </div>
      {branches}
      {!tree.root.children.length ? <p className="analysis-tree-empty">{tree.root.tags.includes('checkmate') ? 'The candidate delivers checkmate.' : tree.root.tags.includes('draw') ? 'This position is drawn.' : 'No additional searched moves returned for this candidate.'}</p> : null}
    </> : <p className="analysis-tree-empty">No legal continuation returned for this position.</p>}
    {limited ? <div className="analysis-tree-limit"><span>Showing the first {nodeLimit} expanded nodes.</span>
      <button type="button" onClick={() => setNodeLimit((limit) => limit + 500)}>Show 500 more</button></div> : null}
    {tree.truncatedLines ? <p className="analysis-tree-caution">{tree.truncatedLines} continuation{tree.truncatedLines === 1 ? '' : 's'} truncated at the last legal move. No extra branches inferred.</p> : null}
    {inspected ? <div className="analysis-tree-inspector" aria-label="Selected tree node metadata">
      <div><b>{inspected.label}</b><span>{roleLabel(inspected)} · ply {inspected.ply} · UCI {inspected.uci}</span></div>
      {inspected.scoreCp !== undefined ? <p>Branch outcome: <b>{formatCp(inspected.scoreCp)}</b> for {mover}. This is the evaluated continuation, not a static score for this board.</p>
        : <p>Stockfish PV move. No independent evaluation or human move probability was measured here.</p>}
      {inspected.conditionalProbability !== undefined ? <p>Maia conditional: <b>{percent(inspected.conditionalProbability)}</b> · joint path: <b>{percent(inspected.jointProbability ?? 0)}</b>{inspected.lossCp !== undefined ? Math.abs(inspected.scoreCp ?? 0) >= 90_000 || inspected.lossCp >= 90_000 ? ' · mate outcome, not a finite pawn loss.' : ` · opponent loss: ${(inspected.lossCp / 100).toFixed(2)} pawns.` : '.'}</p> : null}
      <code>{inspected.fen}</code>
    </div> : activeLineId ? <p className="analysis-tree-selected-note">A branch is loaded in the board player. Click any tree move to jump directly to that position.</p> : null}
    <p className="analysis-tree-footnote">Branch evaluations stay in {mover}’s perspective. Connected PV moves show one searched continuation; they do not imply that every legal reply was searched.</p>
  </section>;
}

function flattenMoves(root: AnalysisMoveNode | null): AnalysisMoveNode[] {
  if (!root) return [];
  const moves = [root];
  for (let index = 0; index < moves.length; index++) for (const node of moves[index].children) if (node.kind === 'move') moves.push(node);
  return moves;
}
function defaultExpanded(tree: AnalysisTreeData): Set<string> {
  return new Set(flattenMoves(tree.root).filter((node) => node.ply < 4 && node.children.length).map((node) => node.id));
}
function roleLabel(node: AnalysisMoveNode): string {
  return node.role === 'human-reply' ? 'Modeled human reply' : node.role === 'engine-continuation' ? 'Engine continuation'
    : node.role === 'candidate' ? 'Candidate move' : 'Stockfish principal variation';
}
function hasTerminalDescendant(node: AnalysisMoveNode, tag: 'checkmate' | 'draw'): boolean {
  return node.children.some((child) => child.kind === 'move' && (child.tags.includes(tag) || hasTerminalDescendant(child, tag)));
}
