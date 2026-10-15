import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';

const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const baseline = await read('benchmarks/review/baseline-ratings.json');
const comparison = await read('benchmarks/review/default-comparison-2400.json');
const control = await read('benchmarks/review/same-settings-horizon-control.json');
const discovery = await read('benchmarks/review/fishing-pole-discovery.json');
const chains = await read('benchmarks/review/chains-1000-depth12.json');
const punishments = await read('benchmarks/review/punishments-production.json');
const sigmoid = (cp) => cp >= 90000 ? 1 : cp <= -90000 ? 0 : 1 / (1 + Math.exp(-cp / 200));
const play = (board, uci) => board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
let validated = 0;
function checkDecision(fen, decision, settings) {
  const after = new Chess(fen);
  play(after, decision.move);
  const selected = decision.selected;
  assert.ok(selected.riskCp <= settings.maxRiskCp + 1e-7);
  assert.ok(selected.expectedScore >= 0 && selected.expectedScore <= 1);
  if (after.isGameOver()) {
    near(selected.expectedScore, after.isCheckmate() ? 1 : .5);
  } else {
    assert.equal(decision.policySource, 'maia');
    near(selected.policyCoverage, selected.replies.reduce((sum, reply) => sum + reply.probability, 0));
    near(selected.expectedScore, selected.replies.reduce((sum, reply) => sum + reply.probability * reply.expectedScore,
      (1 - selected.policyCoverage) * selected.objectiveScore));
    for (const reply of selected.replies) {
      const board = new Chess(after.fen());
      play(board, reply.move);
      assert.ok(reply.probability >= 0 && reply.probability <= 1);
      const continuation = reply.continuation;
      if (!continuation) continue;
      play(board, continuation.move);
      if (board.isGameOver()) {
        near(continuation.expectedScore, board.isCheckmate() ? 1 : .5);
        continue;
      }
      near(continuation.policyCoverage, continuation.replies.reduce((sum, next) => sum + next.probability, 0));
      near(continuation.expectedScore, continuation.replies.reduce((sum, next) => sum + next.probability * next.expectedScore,
        (1 - continuation.policyCoverage) * sigmoid(continuation.scoreCp)));
      near(reply.expectedScore, continuation.expectedScore);
      for (const next of continuation.replies) play(new Chess(board.fen()), next.move);
    }
  }
  validated++;
}
for (const report of [baseline, comparison, control, discovery]) for (const fixture of report.positions) {
  for (const row of fixture.decisions) checkDecision(fixture.fen, row.decision, row.settings);
}
for (const row of punishments.positions) checkDecision(row.fen, row.decision, punishments.settings);
assert.equal(comparison.productionSourceSha256AtStart, comparison.productionSourceSha256AtEnd);
assert.equal(punishments.productionSourceSha256AtStart, comparison.productionSourceSha256AtStart);
for (const report of [control, discovery]) {
  assert.equal(report.productionSourceSha256AtStart, comparison.productionSourceSha256AtStart);
  assert.equal(report.productionSourceSha256AtStart, report.productionSourceSha256AtEnd);
}
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const decimal = (value) => value.toFixed(3);
const rows = comparison.positions.map((fixture) => {
  const old = fixture.decisions[0]; const current = fixture.decisions[1];
  const oracle = current.commonOracle; const second = current.commonSecondChanceOracle;
  const secondRisk = Math.max(0, fixture.independentRootBest.score.cp - second.objectiveCp);
  return `| ${fixture.name} | ${old.decision.san} → ${current.decision.san} | ${oracle.rootRiskCp} → ${secondRisk}cp | ${decimal(oracle.expectedUtility)} → ${decimal(second.expectedUtility)} | ${percent(oracle.punishableProbability)} → ${percent(second.punishableProbability)} | ${(current.elapsedMs / 1000).toFixed(2)}s |`;
});
const controlRows = control.positions.map((fixture) => {
  const first = fixture.decisions[0].decision; const second = fixture.decisions[1].decision;
  return `| ${fixture.name} | ${first.san} → ${second.san} | ${decimal(first.selected.expectedScore)} → ${decimal(second.selected.expectedScore)} |`;
});
const discovered = discovery.positions[0];
const discoveryOld = discovered.decisions[0]; const discoveryNew = discovered.decisions[1];
const times = comparison.positions.map((fixture) => fixture.decisions[1].elapsedMs / 1000);
const runtimeMean = times.reduce((sum, value) => sum + value, 0) / times.length;
const blackburne = chains.positions.find((fixture) => fixture.id === 'blackburne');
const queen = blackburne.continuations.find((move) => move.san === 'Qg5');
const knight = queen.replies.find((reply) => reply.san === 'Nxf7');
const englund = chains.positions.find((fixture) => fixture.id === 'englund');
const queenCapture = englund.continuations.find((move) => move.san === 'Qxb2');
const elephant = chains.positions.find((fixture) => fixture.id === 'elephant');
const recapture = elephant.continuations.find((move) => move.san === 'Nxd5');
const tick = String.fromCharCode(96);
const report = `# Ruthless default: UI intent and trap quality evidence

The default targets a 1000-rated opponent, uses full practical aggression, and examines two opponent replies. Stockfish searches the root at depth 12 and verifies outcomes at depth 10. The independent risk budget stays 100cp, tightening to 40cp once the objective best move is at least +500cp. Engine rating 2400 conditions Maia's opponent predictions; it is a configuration input, not a measured Trappyfish Elo.

The previous engine was frozen byte for byte before this review at ${tick}benchmarks/review/baseline-trappy.ts${tick}, SHA256 ${tick}${baseline.baselineSourceSha256}${tick}. The reviewed production source was ${tick}${comparison.productionSourceSha256AtStart}${tick} at both comparison start and end.

## Rating and depth review before selection changes

The frozen selector ran all eight fixtures at opponent ratings 800, 1000, 1200 and 1500, plus 1000 with root depth 12 / outcome depth 10: 40 real decisions using the shipped Maia ONNX model and Stockfish WASM. Seven fixtures chose the same move under all settings. Blackburne changed from Nf6 at 1500 to f5 at 800/1000/1200 with depth 10. A deeper independent oracle gave f5 utility 0.518 versus Nf6 0.522, despite f5's much larger modeled mistake mass. Root depth 12 restored Nf6. This supports 1000 with the deeper root search; lowering the modeled rating alone did not establish stronger play.

These are focused diagnostics, not game results, an Elo estimate, or evidence of broad superiority. The eight final root selections match the frozen default. The new behavior is lower-rated reply conditioning, additional trap-chain analysis, explicit punishment forecasts and safer conversion when winning.

## Independent default comparison

Both selected moves are checked by one shared Maia 1000/2400 and cold Stockfish oracle. The first chance oracle uses root depth 12 and opponent depth 11, up to ten replies or 95% coverage, always including strongest defense. The second chance oracle extends the three largest non-mate first branches along Stockfish's preferred continuation, using root depth 10 and opponent depth 9 with up to ten replies or 95% coverage plus strongest defense. This is wider than production's four second replies. Both keep true probabilities and give all unsearched mass conservative defense utility.

Utility is ${tick}sigmoid(cp / 200)${tick}, with exact terminal values 0/0.5/1. It is a bounded evaluation transform, not calibrated game win probability. “Mistake mass” is the searched probability of an outcome more than 100cp better for the engine than strongest known defense, over one or two opponent replies. It excludes unknown tail outcomes. Independent root risk compares the depth-12 root best with the candidate's conservative root/defense/forced-reply baseline.

| Position | Frozen → new move | One → two chance root risk | One → two chance utility | One → two chance mistake mass | New selection time |
| --- | --- | ---: | ---: | ---: | ---: |
${rows.join('\n')}

Mean production selection time was ${runtimeMean.toFixed(2)}s, with a ${(Math.min(...times)).toFixed(2)}–${(Math.max(...times)).toFixed(2)}s range on this machine. Node Maia uses one inference thread; Stockfish is the shipped single-thread WASM. Browser and device timing can differ. The test clears Stockfish's transposition table between searches, making comparisons independent of search order. Model initialization and concurrent machine load affect runtime.

## Isolating the extra opponent reply

A separate live-engine control holds opponent/engine ratings 1000/2400, root/outcome depths 12/10, reply budgets, aggression and risk settings fixed. Only opponentPlies changes from 1 to 2. Root selections match in all eight fixtures. The table reports each actual production selector's own forecast, using its configured reply budgets; it therefore isolates the effect of additional chance-ply search and verification. Higher forecast values alone do not establish improved play or a guaranteed gain in move ranking.

| Position | One → two chance move | Actual selector utility, one → two chance |
| --- | --- | ---: |
${controlRows.join('\n')}

Before the Fishing Pole hook has been played, a ninth sensitivity probe after 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O changes ${discoveryOld.decision.san} to ${discoveryNew.decision.san}, with ${discoveryNew.commonOracle.rootRiskCp}cp independent first-chance risk. Shared one-chance utility changes ${decimal(discoveryOld.commonOracle.expectedUtility)} → ${decimal(discoveryNew.commonOracle.expectedUtility)}; shared two-chance utility changes ${decimal(discoveryOld.commonSecondChanceOracle.expectedUtility)} → ${decimal(discoveryNew.commonSecondChanceOracle.expectedUtility)}. First-chance punishable mass changes ${percent(discoveryOld.commonOracle.punishableProbability)} → ${percent(discoveryNew.commonOracle.punishableProbability)}. The named Ng4 bait is not selected. This discovery probe compares both full defaults and does not isolate one changed parameter; it shows a generic candidate chosen to pose more practical problems without any opening-specific production rule.

## Trap chains and actual punishment

At Maia 1000/2000, Blackburne Nd4 attracts Nxe5 with ${percent(blackburne.firstReplyProbability)} probability. Stockfish's strongest continuation is Qg5. Its next-reply expected utility is ${decimal(queen.expectedUtility)}, with ${percent(queen.punishableProbability)} modeled punishable replies; its strongest defense is ${queen.objectiveCp}cp. Maia assigns ${percent(knight.probability)} to Nxf7, which Stockfish scores at +${knight.cp}cp. The continuation does not assume the full famous mating sequence is certain.

In Englund, Bd2 is correct defense to Qb4+; Maia gives it ${percent(englund.firstReplyProbability)}. Stockfish's preferred Qxb2 sets a further problem, with next-reply utility ${decimal(queenCapture.expectedUtility)} and ${percent(queenCapture.punishableProbability)} punishable replies, versus ${queenCapture.objectiveCp}cp under strongest defense. In Elephant, the initial Nxd5 capture already loses: the engine recaptures Nxd5 and retains ${recapture.objectiveCp}cp under strongest defense, with next-reply utility ${decimal(recapture.expectedUtility)}.

Actual production decisions in the Blackburne illustrative line chose Qg5, Qxg2, Qxe4+, and Nf3# at every engine turn. Production also chose Qxb2 after Englund Bd2 and Nxd5 after Elephant Nxd5. These checks establish that it executes punishment when supplied those mistakes; they do not establish that a player will make them.

The report generator independently checked ${validated} recorded decisions for legal moves, bounded utilities, real Maia use, the hard risk budget, exact terminal outcomes, and both chance-ply probability backups. It verifies that reply masses equal reported coverage and that residual mass is retained at the defense value.

## Reproduce

Run from the repository root:

${tick.repeat(3)}powershell
npx tsx scripts/review-traps.ts --mode baseline --deeper --output benchmarks/review/baseline-ratings.json
npx tsx scripts/review-traps.ts --mode chains --output benchmarks/review/chains-1000-depth12.json
npx tsx scripts/review-traps.ts --mode compare --oracle-engine 2400 --output benchmarks/review/default-comparison-2400.json
npx tsx scripts/review-traps.ts --mode control --oracle-engine 2400 --output benchmarks/review/same-settings-horizon-control.json
npx tsx scripts/review-traps.ts --mode discovery --oracle-engine 2400 --output benchmarks/review/fishing-pole-discovery.json
npx tsx scripts/review-traps.ts --mode punishments --output benchmarks/review/punishments-production.json
node scripts/review-traps-report.mjs
${tick.repeat(3)}

Raw final reports contain all FENs, candidate/reply scores, true Maia probabilities, settings, actual decisions, runtimes and source/model/binary hashes. Earlier exploratory reports are retained separately; the validated comparisons above use the actual default 2400.

The search follows the same practical expected-outcome principle described in [FlawChess](https://github.com/flawchess/flawchess), with Stockfish choosing engine continuations and Maia modeling the opponent. This bounded two-reply extension still misses traps that require further later mistakes, and four production second replies can leave substantial conservative tail probability in diffuse positions.
`;
await writeFile('docs/ruthless-review.md', report);
console.log(`Validated ${validated} recorded decisions; wrote docs/ruthless-review.md.`);
