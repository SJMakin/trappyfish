import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
import { NodeUci } from '../benchmarks/node-uci';
import { trapRepertoire } from '../src/openings/trapRepertoire';
const depth = 16;
const engine = new NodeUci();
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const report = { createdAt: new Date().toISOString(), depth, engine: 'Stockfish 18 lite single WASM',
  engineSha256: hash(await readFile('node_modules/stockfish/bin/stockfish-18-lite-single.wasm')),
  sourceSha256: hash(await readFile('src/openings/trapRepertoire.ts')),
  caveat: 'Independent finite-depth samples, not mathematical proofs or measured human lure rates.', positions: [] as object[] };
try {
  for (const trap of trapRepertoire) {
    const board = new Chess();
    for (const move of trap.setup) board.move(move);
    const fen = board.fen();
    const bait = board.move(trap.bait);
    const baitUci = `${bait.from}${bait.to}${bait.promotion ?? ''}`;
    const [root, forced, defense] = [await engine.analyzeFen(fen, depth), await engine.analyzeFen(fen, depth, 1, [baitUci]), await engine.analyzeFen(board.fen(), depth)];
    const defenseSan = new Chess(board.fen()).move(defense.bestMove).san;
    report.positions.push({ id: trap.id, fen, bait: baitUci, rootBest: root.bestMove,
      rootCp: root.lines[0]?.score.cp, baitCp: forced.lines[0]?.score.cp,
      riskCp: Math.max(0, root.lines[0].score.cp - Math.min(forced.lines[0].score.cp, -defense.lines[0].score.cp)),
      defenseFen: board.fen(), bestDefense: defense.bestMove, bestDefenseSan: defenseSan, defenseCpFromBaitMover: -defense.lines[0]?.score.cp,
      defensePv: defense.lines[0]?.pv });
    console.log(`${trap.id}: ${defenseSan}, risk ${JSON.stringify(report.positions.at(-1))}`);
  }
  await writeFile('src/openings/trapVerification.json', `${JSON.stringify(report, null, 2)}\n`);
} finally { engine.terminate(); }
