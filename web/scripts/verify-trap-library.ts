import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Chess, type Color } from 'chess.js';
import { NodeUci } from '../benchmarks/node-uci';
import { DEFAULT_TRAPPY_SETTINGS, TrappyEngine, type TrappySettings } from '../src/engine/trappy';
import { allTrapStudies, quarantinedTrapStudies, selectableTrapStudies, type TrapLibraryStudy } from '../src/openings/trapLibrary';
import { evaluationLossCp } from '../src/openings/trapEvidence';

const depth = 16;
const output = 'src/openings/trapLibraryVerification.json';
const cachePath = 'artifacts/trap-library/stockfish-depth16-cache.json';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourceHash = async (path: string) => sha((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'));
const engineSha256 = sha(await readFile('node_modules/stockfish/bin/stockfish-18-lite-single.wasm'));
type Snapshot = { move: string; scoreCp: number; mate?: number; pv: string[]; depth: number; nodes?: number };
const cache: { depth: number; engineSha256: string; positions: Record<string, Snapshot> } = { depth, engineSha256, positions: {} };
try {
  const saved = JSON.parse(await readFile(cachePath, 'utf8'));
  if (saved.depth === depth && saved.engineSha256 === engineSha256) cache.positions = saved.positions;
} catch (error: any) { if (error.code !== 'ENOENT') throw error; }
await mkdir('artifacts/trap-library', { recursive: true });
let uci: NodeUci | undefined;
async function engine() { if (!uci) { uci = new NodeUci(); await uci.init(); } return uci; }
async function sample(fen: string, forced?: string): Promise<Snapshot> {
  const key = JSON.stringify([fen, depth, forced ?? null]);
  if (cache.positions[key]) return cache.positions[key];
  const board = new Chess(fen);
  if (board.isGameOver()) {
    assert.equal(forced, undefined);
    return { move: '', scoreCp: board.isCheckmate() ? -100_000 : 0, mate: board.isCheckmate() ? 0 : undefined, pv: [], depth };
  }
  const result = await (await engine()).analyzeFen(fen, depth, 1, forced ? [forced] : []);
  const line = result.lines.find(row => !forced || row.firstMove === forced);
  assert.ok(line, `No scored legal engine line for ${fen} / ${forced ?? 'root'}`);
  const row = { move: line.firstMove, scoreCp: line.score.cp,
    mate: line.score.type === 'mate' ? line.score.raw : undefined,
    pv: line.pv, depth: line.depth, nodes: line.nodes };
  cache.positions[key] = row;
  await writeFile(cachePath, JSON.stringify(cache, null, 2) + '\n');
  return row;
}
const uciOf = (move: { from: string; to: string; promotion?: string }) => `${move.from}${move.to}${move.promotion ?? ''}`;
function studyPositions(study: TrapLibraryStudy) {
  const board = new Chess(); study.setup.forEach(san => board.move(san));
  assert.equal(board.fen(), study.rootFen, `${study.id} setup root`);
  assert.equal(board.turn(), study.side, `${study.id} trapper color`);
  const bait = board.move(study.bait); assert.equal(uciOf(bait), study.baitUci);
  assert.equal(board.fen(), study.afterBaitFen);
  const reply = board.move(study.temptingReply); assert.equal(uciOf(reply), study.temptingReplyUci);
  const afterReplyFen = board.fen();
  const punishment = study.punishment.map(san => uciOf(board.move(san)));
  assert.deepEqual(punishment, study.punishmentUci);
  return { baitSan: bait.san, replySan: reply.san, afterReplyFen };
}
function lineSample(study: TrapLibraryStudy) {
  const board = new Chess(study.rootFen); let unforcedHumanMoves = 0;
  const path = [study.baitUci, study.temptingReplyUci, ...study.punishmentUci];
  for (const move of path) {
    if (board.turn() !== study.side && board.moves().length > 1) unforcedHumanMoves++;
    board.move(move);
  }
  const winner: Color | undefined = board.isCheckmate() ? board.turn() === 'w' ? 'b' : 'w' : undefined;
  assert.ok(!winner || winner === study.side, `${study.id} illustrative line mates its supposed trapper`);
  return { legal: true, endsInMate: board.isCheckmate(), winner, plies: path.length, unforcedHumanMoves,
    note: 'Legal replay proves only the supplied final position; it does not prove that every intermediate reply was forced.' };
}
const report = { version: 1, createdAt: new Date().toISOString(), depth,
  engine: 'Stockfish 18 lite single WASM', engineSha256,
  sourceSha256: sha(JSON.stringify(allTrapStudies)), selectorSourceSha256: await sourceHash('src/engine/trappy.ts'),
  selectionPolicySha256: sha(JSON.stringify({ quarantinedTrapStudies, selectableIds: selectableTrapStudies.map(study => study.id) })),
  quarantinedStudies: quarantinedTrapStudies, selectableStudyIds: selectableTrapStudies.map(study => study.id),
  model: 'No human policy model is used in this independent content verification or the objective book-selection probes.',
  method: 'Cold-hash depth-16 unrestricted root, forced bait, strongest reply, forced illustrative reply, and unrestricted/forced first-punishment searches. Scores refer to the trapper; reply loss compares searches of the same post-bait position. Source decline lines are replayed independently and scored as optional alternatives, not presumed best defenses.',
  caveat: 'Independent finite-depth samples, not mathematical proofs, full-line forcedness checks or measured human lure rates. The live engine still verifies every book move using the chosen game settings.',
  positions: [] as any[], selectionChecks: [] as any[] };
const save = async () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
try {
  for (const study of allTrapStudies) {
    const places = studyPositions(study);
    const root = await sample(study.rootFen);
    const bait = await sample(study.rootFen, study.baitUci);
    const defense = await sample(study.afterBaitFen);
    const tempting = await sample(study.afterBaitFen, study.temptingReplyUci);
    const afterReply = await sample(places.afterReplyFen);
    const firstPunishment = study.punishmentUci[0];
    assert.ok(firstPunishment, `${study.id} needs an illustrative punishment`);
    const punishment = await sample(places.afterReplyFen, firstPunishment);
    const defenseCpFromTrapper = -defense.scoreCp;
    const baitCp = Math.min(bait.scoreCp, defenseCpFromTrapper);
    const riskCp = evaluationLossCp(root.scoreCp, baitCp);
    const temptingReplyLossCp = evaluationLossCp(defense.scoreCp, tempting.scoreCp);
    const punishmentRiskCp = evaluationLossCp(afterReply.scoreCp, punishment.scoreCp);
    const illustrativeLine = lineSample(study);
    const warnings: string[] = [];
    if (temptingReplyLossCp < 50) warnings.push('The illustrative reply was not verified as a substantial error at this depth.');
    if (punishmentRiskCp > 50) warnings.push('The illustrative first punishment was weaker than the strongest searched continuation.');
    if (illustrativeLine.endsInMate && afterReply.scoreCp < 90_000) warnings.push('The supplied line reaches mate, but a forced mate after the initial reply was not established by this search.');
    let decline;
    if (study.defensiveAlternative) {
      const alternative = study.defensiveAlternative;
      assert.equal(alternative.fen, study.afterBaitFen, `${study.id} avoidance line must start before the illustrative reply`);
      const board = new Chess(alternative.fen); const move = board.move(alternative.move);
      alternative.continuation.forEach(uci => board.move(uci));
      const chosen = await sample(alternative.fen, alternative.move);
      decline = { move: alternative.move, san: move.san, riskCp: evaluationLossCp(defense.scoreCp, chosen.scoreCp),
        scoreCpFromDefender: chosen.scoreCp, lineLegal: true, basis: alternative.basis, lineEndsInMate: board.isCheckmate() };
      if (decline.riskCp > 100) warnings.push('The source avoidance move was weaker than the strongest searched defense.');
    }
    report.positions.push({ id: study.id, fen: study.rootFen, bait: study.baitUci, baitSan: places.baitSan,
      rootBest: root.move, rootCp: root.scoreCp, baitCp, riskCp,
      bestDefense: defense.move, bestDefenseSan: new Chess(study.afterBaitFen).move(defense.move).san,
      defenseCpFromTrapper, defensePv: defense.pv,
      temptingReply: study.temptingReplyUci, temptingReplySan: places.replySan,
      temptingReplyCpFromTrapper: -tempting.scoreCp, temptingReplyLossCp,
      temptingReplyAllowsMate: afterReply.scoreCp >= 90_000,
      punishment: firstPunishment, punishmentSan: new Chess(places.afterReplyFen).move(firstPunishment).san,
      punishmentRiskCp, punishmentKeepsMate: afterReply.scoreCp >= 90_000 && punishment.scoreCp >= 90_000,
      bestPunishmentCp: afterReply.scoreCp, punishmentCp: punishment.scoreCp,
      bestPunishment: afterReply.move, bestPunishmentSan: new Chess(places.afterReplyFen).move(afterReply.move).san,
      illustrativeLine, decline, warnings });
    await save();
    console.log(`${study.id}: bait risk ${Math.round(riskCp)}cp, reply loss ${Math.round(temptingReplyLossCp)}cp, punishment loss ${Math.round(punishmentRiskCp)}cp${warnings.length ? ` (${warnings.length} caveats)` : ''}`);
  }
  // Targeted real-selector checks augment the unchanged original 30-case calibration.
  const candidates = report.positions.filter(row => selectableTrapStudies.find(study => study.id === row.id)?.provenance.license === 'MIT');
  const safe = candidates.filter(row => row.riskCp <= 25 && Math.abs(row.rootCp) < 90_000).sort((a, b) => a.riskCp - b.riskCp)[0];
  const risky = [...candidates].sort((a, b) => b.riskCp - a.riskCp)[0];
  assert.ok(safe, 'Need a sound newly imported study for a real book probe');
  assert.ok(risky?.riskCp > 100, 'Need a risky newly imported study for a real strict-limit probe');
  const policy = { predict: async () => { throw new Error('Objective book probes must not request a human policy.'); } };
  const selector = new TrappyEngine(await engine(), policy);
  for (const [row, maxRiskCp, expected] of [[safe, 100, 'accept-book'], [risky, 0, 'reject-book']] as const) {
    const settings: TrappySettings = { ...DEFAULT_TRAPPY_SETTINGS, continuationCandidates: 2, maxRiskCp, trappiness: 0 };
    const decision = await selector.chooseMove(row.fen, settings, false, { bookMoves: [row.bait] });
    assert.equal(decision.warning, undefined);
    assert.ok(decision.selected.riskCp <= maxRiskCp);
    if (expected === 'accept-book') { assert.equal(decision.move, row.bait); assert.equal(decision.provenance?.source, 'opening-book'); }
    else { assert.notEqual(decision.move, row.bait); assert.equal(decision.provenance?.bookExitReason, 'outside-risk'); }
    report.selectionChecks.push({ id: row.id, expected, settings, chosenMove: decision.move, chosenSan: decision.san,
      selectedRiskCp: decision.selected.riskCp, provenance: decision.provenance, policyCalls: decision.diagnostics?.policyCalls ?? 0, passed: true });
    await save();
    console.log(`Real selector ${expected}: ${row.id} -> ${decision.san}`);
  }
  assert.equal(report.positions.length, allTrapStudies.length);
  await save();
} finally { uci?.terminate(); }
