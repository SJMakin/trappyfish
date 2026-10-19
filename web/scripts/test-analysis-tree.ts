import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { buildAnalysisTree, type AnalysisMoveNode, type AnalysisTreeNode } from '../src/engine/analysisTree';
import { playUci, type CandidateInfo, type ReplyInfo } from '../src/engine/trappy';
import { TRAP_POSITIONS } from '../benchmarks/trap-positions';

const tests: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });
function reply(move: string, probability: number, overrides: Partial<ReplyInfo> = {}): ReplyInfo {
  return { move, san: move, probability, scoreCp: 30, expectedScore: 0.54, lossCp: 0, punishment: [], ...overrides };
}
function candidate(overrides: Partial<CandidateInfo> = {}): CandidateInfo {
  return { move: 'e2e4', san: 'e4', rootScoreCp: 30, adjustedScoreCp: 80, riskCp: 0, bonusCp: 50,
    expectedScoreCp: 80, expectedScore: 0.6, objectiveScore: 0.54, policyCoverage: 0.8,
    replies: [], analyzed: true, status: 'evaluated', ...overrides };
}
function fixture() {
  return candidate({ bestDefenseMove: 'e7e5', replies: [
    reply('e7e5', 0.6, { bestDefense: true, punishment: ['g1f3', 'b8c6', 'f1b5'], continuation: {
      move: 'g1f3', san: 'Nf3', scoreCp: 30, expectedScore: 0.58, policyCoverage: 0.75, bestDefenseMove: 'b8c6',
      replies: [reply('b8c6', 0.5, { bestDefense: true, punishment: ['f1b5', 'a7a6'] }),
        reply('d7d6', 0.25, { scoreCp: 180, lossCp: 150, punishment: ['d2d4', 'e5d4'] })],
    } }),
    reply('d7d5', 0.2, { scoreCp: 200, lossCp: 170, punishment: ['e4d5', 'd8d5'] }),
  ] });
}
function get(nodes: AnalysisTreeNode[], move: string): AnalysisMoveNode {
  const node = nodes.find((row): row is AnalysisMoveNode => row.kind === 'move' && row.uci === move);
  assert.ok(node, `Missing move ${move}`); return node;
}
function allNodes(node: AnalysisTreeNode): AnalysisTreeNode[] {
  return [node, ...node.children.flatMap(allNodes)];
}

test('all replies and PVs share legal prefixes without repeated line cards or invented branches', () => {
  const tree = buildAnalysisTree(new Chess().fen(), fixture()); const root = tree.root!;
  const e5 = get(root.children, 'e7e5');
  const nf3 = get(e5.children, 'g1f3');
  assert.equal(e5.children.filter((node) => node.kind === 'move').length, 1);
  assert.equal(nf3.children.filter((node) => node.kind === 'move').length, 2, 'Both modeled next replies remain visible');
  const nc6 = get(nf3.children, 'b8c6'); const bb5 = get(nc6.children, 'f1b5');
  assert.equal(nf3.children.filter((node) => node.kind === 'move' && node.uci === 'b8c6').length, 1);
  assert.equal(bb5.children.filter((node) => node.kind === 'move').length, 1, 'Longer shared PV extends the existing branch');
  assert.ok(get(root.children, 'd7d5').tags.includes('human-mistake'));
  assert.ok(e5.tags.includes('best-defense'));
  assert.equal(nf3.role, 'engine-continuation');
  assert.equal(tree.replyCount, 4);
  for (const node of allNodes(root)) if (node.kind === 'move') {
    assert.deepEqual(node.line.moves.slice(0, node.ply), node.path, 'Every clickable node selects a full real branch containing its prefix');
    const board = new Chess();
    for (const move of node.path) assert.ok(playUci(board, move));
    assert.equal(node.fen, board.fen());
  }
});

test('conditional policy probabilities multiply only at human choices; PV scores and chances are not fabricated', () => {
  const root = buildAnalysisTree(new Chess().fen(), fixture()).root!;
  const e5 = get(root.children, 'e7e5'); const nf3 = get(e5.children, 'g1f3');
  const nc6 = get(nf3.children, 'b8c6'); const bb5 = get(nc6.children, 'f1b5');
  assert.equal(e5.conditionalProbability, 0.6); assert.equal(e5.jointProbability, 0.6);
  assert.equal(nc6.conditionalProbability, 0.5); assert.equal(nc6.jointProbability, 0.3);
  assert.equal(nf3.conditionalProbability, undefined); assert.equal(nf3.jointProbability, undefined);
  assert.equal(bb5.conditionalProbability, undefined); assert.equal(bb5.jointProbability, undefined);
  assert.equal(bb5.scoreCp, undefined, 'A PV tail is not an independently scored position');
});

test('each searched chance layer keeps its residual policy mass explicitly', () => {
  const tree = buildAnalysisTree(new Chess().fen(), fixture()); const root = tree.root!;
  const firstResidual = root.children.find((node) => node.kind === 'residual');
  assert.ok(firstResidual?.kind === 'residual');
  assert.ok(Math.abs(firstResidual.conditionalProbability - 0.2) < 1e-12);
  assert.equal(firstResidual.children.length, 0);
  assert.equal(firstResidual.scoreCp, 30, 'Residual has conservative fallback utility, not a fabricated searched move');
  const continuation = get(get(root.children, 'e7e5').children, 'g1f3');
  const secondResidual = continuation.children.find((node) => node.kind === 'residual');
  assert.ok(secondResidual?.kind === 'residual');
  assert.equal(secondResidual.conditionalProbability, 0.25); assert.equal(secondResidual.jointProbability, 0.15);
  assert.equal(tree.residualCount, 2);
  const full = fixture(); full.policyCoverage = 1;
  assert.equal(buildAnalysisTree(new Chess().fen(), full).root!.children.some((node) => node.kind === 'residual'), false);
});

test('objective-only fallback is fully replayable without human probabilities or residuals', () => {
  const tree = buildAnalysisTree(new Chess().fen(), candidate({ policyCoverage: 0, pv: ['e2e4', 'e7e5', 'g1f3'] }));
  assert.equal(tree.moveCount, 3); assert.equal(tree.replyCount, 0); assert.equal(tree.residualCount, 0);
  for (const node of allNodes(tree.root!)) if (node.kind === 'move') {
    assert.equal(node.conditionalProbability, undefined); assert.equal(node.line.kind, 'objective');
    assert.deepEqual(node.line.moves, ['e2e4', 'e7e5', 'g1f3']);
  }
});

test('illegal suffixes are truncated and cannot become tree nodes or replay moves', () => {
  const tree = buildAnalysisTree(new Chess().fen(), candidate({ policyCoverage: 0,
    pv: ['e2e4', 'e7e5', 'e1e8', 'g1f3'] }));
  assert.equal(tree.truncatedLines, 1); assert.equal(tree.moveCount, 2);
  assert.deepEqual(get(tree.root!.children, 'e7e5').line.moves, ['e2e4', 'e7e5']);
  assert.equal(buildAnalysisTree(new Chess().fen(), candidate({ move: 'e1e8', pv: ['e1e8'] })).root, null);
});

test('Black promotion paths preserve SAN, fullmove numbering, colors and original score perspective', () => {
  const fen = '7k/8/8/8/8/8/p7/7K b - - 0 22';
  const tree = buildAnalysisTree(fen, candidate({ move: 'a2a1q', san: 'a1=Q+', rootScoreCp: 600, policyCoverage: 0,
    pv: ['a2a1q', 'h1g2'] }));
  const root = tree.root!;
  assert.equal(root.color, 'b'); assert.equal(root.san, 'a1=Q+'); assert.equal(root.label, '22… a1=Q+');
  assert.equal(root.scoreCp, 600); assert.equal(root.line.scoreCp, 600, 'No Black score inversion is introduced');
  const white = get(root.children, 'h1g2'); assert.equal(white.color, 'w'); assert.equal(white.label, '23. Kg2');
  assert.equal(new Chess(root.fen).get('a1')?.type, 'q');
});

test('deferred human mistakes and final checkmate remain explicit nodes in the same tree', () => {
  const position = TRAP_POSITIONS.find((row) => row.id === 'englund')!;
  const tree = buildAnalysisTree(position.fen, candidate({ move: 'e7b4', san: 'Qb4+', rootScoreCp: -200,
    bestDefenseMove: 'f4d2', replies: [reply('f4d2', 0.8, { scoreCp: -200, bestDefense: true,
      punishment: ['b4b2'], continuation: { move: 'b4b2', san: 'Qxb2', scoreCp: -200, expectedScore: 0.5,
        policyCoverage: 0.75, replies: [reply('d2c3', 0.75, { scoreCp: 100_000, lossCp: 100_200,
          punishment: ['f8b4', 'd1d2', 'b4c3', 'd2c3', 'b2c1'] })] } })] }));
  const bd2 = get(tree.root!.children, 'f4d2'); const qb2 = get(bd2.children, 'b4b2'); const bc3 = get(qb2.children, 'd2c3');
  assert.equal(bc3.jointProbability, 0.8 * 0.75); assert.ok(bc3.tags.includes('human-mistake'));
  const mate = allNodes(tree.root!).find((node) => node.kind === 'move' && node.tags.includes('checkmate'));
  assert.ok(mate?.kind === 'move'); assert.equal(mate.san, 'Qc1#'); assert.equal(mate.color, 'b');
  assert.equal(mate.line.scoreCp, 100_000);
});

test('terminal continuations tag draws and do not add residual pseudo-moves', () => {
  const fen = '7k/8/8/8/8/8/8/K1B5 w - - 0 1';
  const tree = buildAnalysisTree(fen, candidate({ move: 'c1b2', san: 'Bb2', policyCoverage: 0, pv: ['c1b2'] }));
  assert.ok(tree.root?.tags.includes('draw')); assert.equal(tree.residualCount, 0);
});

test('an objective best-defense PV omitted from policy samples is exposed without a made-up probability', () => {
  const tree = buildAnalysisTree(new Chess().fen(), candidate({ bestDefenseMove: 'c7c5', policyCoverage: 0.6,
    pv: ['e2e4', 'c7c5', 'g1f3'], replies: [reply('e7e5', 0.6, { punishment: ['g1f3'] })] }));
  const defense = get(tree.root!.children, 'c7c5');
  assert.ok(defense.tags.includes('best-defense')); assert.equal(defense.conditionalProbability, undefined);
  assert.equal(get(tree.root!.children, 'e7e5').tags.includes('best-defense'), false);
});

test('shared choice prefixes default to the verified defense rather than a longer human mistake', () => {
  const entry = fixture();
  entry.replies[0].continuation!.replies[1].punishment.push('f3d4');
  const root = buildAnalysisTree(new Chess().fen(), entry).root!;
  const first = get(root.children, 'e7e5');
  const setup = get(first.children, 'g1f3');
  assert.equal(first.line.moves[3], 'b8c6');
  assert.equal(setup.line.moves[3], 'b8c6');
  assert.equal(first.line.kind, 'defense');
  const mistaken = get(setup.children, 'd7d6');
  assert.equal(mistaken.line.moves.at(-1), 'f3d4', 'Choosing the mistake itself still exposes its full punishment');
});

for (const { name, run } of tests) { run(); console.log(`PASS ${name}`); }
console.log(`${tests.length} analysis-tree tests passed.`);
