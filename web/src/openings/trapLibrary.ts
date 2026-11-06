import { Chess } from 'chess.js';
import { trapRepertoire, type TrapStudy } from './trapRepertoire';
import legacyVerification from './trapVerification.json';
import imported from './importedTrapStudies.json';
import provenance from './trapLibraryProvenance.json';

export interface TrapDefensiveAlternative {
  /** Position after the trapper's own bait move and before the opponent's illustrative reply. */
  fen: string;
  move: string;
  san: string;
  continuation: string[];
  continuationSan: string[];
  basis: 'source-decline' | 'engine-sample';
}
export interface TrapLibraryStudy extends TrapStudy {
  side: 'w' | 'b';
  family: string;
  sourceId: string;
  sourceVariation?: number;
  rootFen: string;
  baitUci: string;
  afterBaitFen: string;
  temptingReplyUci: string;
  punishmentUci: string[];
  defensiveAlternative?: TrapDefensiveAlternative;
  provenance: {
    project: string;
    revision?: string;
    url: string;
    license: 'MIT' | 'project-original';
    sourceSha256?: string;
  };
}

function extendOriginal(trap: TrapStudy): TrapLibraryStudy {
  const board = new Chess(); trap.setup.forEach(san => board.move(san));
  const rootFen = board.fen(); const side = board.turn(); const bait = board.move(trap.bait);
  const baitUci = `${bait.from}${bait.to}${bait.promotion ?? ''}`; const afterBaitFen = board.fen();
  const mistake = board.move(trap.temptingReply); const punishmentUci = trap.punishment.map(san => {
    const move = board.move(san); return `${move.from}${move.to}${move.promotion ?? ''}`;
  });
  const verified = legacyVerification.positions.find(row => row.id === trap.id);
  let defensiveAlternative: TrapDefensiveAlternative | undefined;
  if (verified) {
    const defense = new Chess(afterBaitFen); const first = defense.move(verified.bestDefense);
    const continuation: string[] = []; const continuationSan: string[] = [];
    for (const uci of verified.defensePv.slice(1)) {
      const move = defense.move(uci); continuation.push(`${move.from}${move.to}${move.promotion ?? ''}`); continuationSan.push(move.san);
    }
    defensiveAlternative = { fen: afterBaitFen, move: verified.bestDefense, san: first.san, continuation, continuationSan, basis: 'engine-sample' };
  }
  return { ...trap, side, family: trap.id, sourceId: trap.id, rootFen, baitUci, afterBaitFen,
    temptingReplyUci: `${mistake.from}${mistake.to}${mistake.promotion ?? ''}`, punishmentUci, defensiveAlternative,
    provenance: { project: 'Trappyfish', url: trap.source, license: 'project-original', sourceSha256: legacyVerification.sourceSha256 } };
}

/** The original calibrated five remain intact. New studies are derived from a pinned, audited MIT dataset. */
export const allTrapStudies: readonly TrapLibraryStudy[] = [
  ...trapRepertoire.map(extendOriginal),
  ...(imported as TrapLibraryStudy[]),
];
export const quarantinedTrapStudies = [{ id: 'trap-import-london-qxb2-trap',
  reason: 'The source’s first illustrative punishment loses about four pawns against the independently searched best continuation. Retained for audit, excluded from the playable catalogue.' }] as const;
export const selectableTrapStudies = allTrapStudies.filter(study => !quarantinedTrapStudies.some(item => item.id === study.id));
export const curatedTrapOpenings = selectableTrapStudies.map(study => study.opening);
export const trapLibraryProvenance = { ...provenance, auditedStudies: allTrapStudies.length, totalStudies: selectableTrapStudies.length };
