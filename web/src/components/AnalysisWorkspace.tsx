import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Color, type Square } from 'chess.js';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import { ArrowLeft, ArrowRight, BrainCircuit, Check, ChevronFirst, ChevronLast, Copy, Download, FlipVertical2, GitBranch, MoreHorizontal, RotateCcw, Search, ShieldCheck, Square as StopIcon, Swords, Zap } from 'lucide-react';
import { UciClient } from '../engine/uci';
import { MaiaClient } from '../engine/maia';
import { DEFAULT_ANALYSIS_SETTINGS, TrappyEngine, moveToUci, opposite, playUci, squarePairFromUci,
  type AnalysisProgress, type CandidateInfo, type PositionAnalysis, type TrappySettings } from '../engine/trappy';
import { validatePosition } from '../import/position';
import { PositionImport } from './PositionImport';
import { TrapAnalysisPanel } from './TrapAnalysisPanel';
import { candidateLines, legalLine, lineTarget, pieceName, variationToPgn, type ResearchLine } from './analysisView';
import '../analysis.css';

type AnalysisRecord = { fen: string; result: PositionAnalysis; settings: TrappySettings; requestedSettings: TrappySettings; depth: 'quick' | 'deep' };
type ManualBranch = { fens: string[]; moves: string[] };
const QUICK_SETTINGS: Partial<TrappySettings> = { rootDepth: 10, trapDepth: 8, candidateCount: 8, replyCount: 8, opponentPlies: 1 };
const LEGAL_EXAMPLE = (() => { const board = new Chess(); for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'Nc3', 'Bg4', 'h3', 'Bh5']) board.move(move); return board.fen(); })();

export function AnalysisWorkspace({ initialFen, active = true, onPlayFromPosition }: {
  initialFen?: string; active?: boolean; onPlayFromPosition: (fen: string, playerColor?: Color) => void;
}) {
  const startingFen = useMemo(() => validatePosition(initialFen ?? new Chess().fen()).fen ?? new Chess().fen(), [initialFen]);
  const engine = useMemo(() => new TrappyEngine(new UciClient(), new MaiaClient()), []);
  const [importedFen, setImportedFen] = useState(startingFen);
  const [analysisFen, setAnalysisFen] = useState(startingFen);
  const [orientation, setOrientation] = useState<Color>(startingFen.split(' ')[1] as Color);
  const [settings, setSettings] = useState<TrappySettings>({ ...DEFAULT_ANALYSIS_SETTINGS });
  const [searchSettings, setSearchSettings] = useState<TrappySettings>({ ...DEFAULT_ANALYSIS_SETTINGS });
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'quick' | 'deep'>('deep');
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedMove, setSelectedMove] = useState('');
  const [activeLine, setActiveLine] = useState<ResearchLine | null>(null);
  const [ply, setPly] = useState(0);
  const [manual, setManual] = useState<ManualBranch | null>(null);
  const [branchReturn, setBranchReturn] = useState<{ line: ResearchLine | null; ply: number } | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [keyboardSquare, setKeyboardSquare] = useState('e2');
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const searchId = useRef(0);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const cache = useRef(new Map<string, AnalysisRecord>());
  const started = useRef(false);
  const promotionDialog = useRef<HTMLElement>(null);
  const moveStrip = useRef<HTMLDivElement>(null);
  const selectionRef = useRef({ move: selectedMove, line: activeLine, ply });
  selectionRef.current = { move: selectedMove, line: activeLine, ply };
  const line = useMemo(() => activeLine ? legalLine(analysisFen, activeLine.moves) : null, [analysisFen, activeLine]);
  const viewFen = manual?.fens.at(-1) ?? line?.fens[Math.min(ply, line.fens.length - 1)] ?? analysisFen;
  const board = useMemo(() => new Chess(viewFen), [viewFen]);
  const decision = record?.fen === analysisFen ? record.result.decision : undefined;
  const isBranch = Boolean(manual);
  const analyzedSide = analysisFen.split(' ')[1] === 'w' ? 'White' : 'Black';
  const changedSettings = record && JSON.stringify(settings) !== JSON.stringify(record.requestedSettings);

  const stopSearch = useCallback(() => {
    searchId.current += 1; engine.cancel(); setBusy(false); setProgress(null);
    setNotice('Search stopped. Any completed results remain available.');
  }, [engine]);

  const selectCandidate = useCallback((candidate: CandidateInfo, fen = analysisFen) => {
    const lines = candidateLines(candidate);
    setSelectedMove(candidate.move); setActiveLine(lines.find((entry) => entry.kind === 'trap') ?? lines[0] ?? null);
    setAnalysisFen(fen); setPly(0); setManual(null); setBranchReturn(null); setSelectedSquare(null); setPromotion(null);
  }, [analysisFen]);

  const analyze = useCallback(async (fen: string, mode: 'quick' | 'deep' | 'progressive' = 'progressive') => {
    const validated = validatePosition(fen);
    if (!validated.fen) { setError(validated.error ?? 'Invalid position.'); return; }
    const targetFen = validated.fen;
    searchId.current += 1; engine.cancel(); const id = searchId.current;
    const chosenSettings = { ...settingsRef.current };
    setSearchSettings(chosenSettings);
    setAnalysisFen(targetFen); setManual(null); setBranchReturn(null); setActiveLine(null); setPly(0);
    setSelectedMove('');
    setSelectedSquare(null); setPromotion(null); setError(null); setNotice(null); setBusy(true);
    setRecord((current) => current?.fen === targetFen ? current : null);
    const passes: ('quick' | 'deep')[] = mode === 'progressive' ? ['quick', 'deep'] : [mode];
    try {
      for (const depth of passes) {
        if (id !== searchId.current) return;
        const passSettings = depth === 'quick' ? { ...chosenSettings, ...QUICK_SETTINGS } : chosenSettings;
        const key = JSON.stringify([targetFen, passSettings]);
        setPhase(depth); setProgress({ stage: 'root', message: depth === 'quick' ? 'Finding candidates and likely mistakes…' : 'Verifying defenses and deeper trap branches…', completed: 0, total: 1 });
        let next = cache.current.get(key);
        if (!next) {
          const result = await engine.analyzePosition(targetFen, passSettings, (update) => {
            if (id === searchId.current) setProgress(update);
          });
          next = { fen: targetFen, result, settings: passSettings, requestedSettings: chosenSettings, depth };
          cache.current.set(key, next);
        }
        if (id !== searchId.current) return;
        setRecord(next);
        if (next.result.decision) {
          const preserved = next.result.decision.candidates.find((candidate) => candidate.move === selectionRef.current.move);
          const candidate = depth === passes[0] ? next.result.decision.selected : preserved ?? next.result.decision.selected;
          setSelectedMove(candidate.move);
          // Show the line at its starting position; the board never plays an engine move.
          if (depth === passes[0]) {
            const lines = candidateLines(candidate);
            setActiveLine(lines.find((entry) => entry.kind === 'trap') ?? lines[0] ?? null); setPly(0);
          } else {
            const lines = candidateLines(candidate);
            const previous = selectionRef.current.line;
            const refreshed = lines.find((entry) => entry.id === previous?.id) ?? refreshReplyLine(candidate, previous);
            if (refreshed) {
              const oldPosition = previous ? legalLine(targetFen, previous.moves).fens[selectionRef.current.ply] : targetFen;
              const refreshedPosition = legalLine(targetFen, refreshed.moves).fens[selectionRef.current.ply];
              if (previous && selectionRef.current.ply > 0 && oldPosition !== refreshedPosition) {
                setActiveLine(previous);
                setNotice('Deep analysis updated. Your explored line is preserved; choose a line to view the updated continuation.');
              } else { setActiveLine(refreshed); setPly(Math.min(selectionRef.current.ply, legalLine(targetFen, refreshed.moves).moves.length)); }
            }
            else if (previous && selectionRef.current.ply > 0 && preserved) {
              setActiveLine(previous);
              setNotice('Deep analysis updated. Your explored line is preserved; choose a line to view the updated continuation.');
            }
            else { setActiveLine(lines.find((entry) => entry.kind === 'trap') ?? lines[0] ?? null); setPly(0); }
          }
        }
        if (next.result.terminal) break;
      }
    } catch (failure) {
      if (id === searchId.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (id === searchId.current) { setBusy(false); setProgress(null); }
    }
  }, [engine]);

  const loadAndAnalyze = useCallback((fen: string, color: Color) => {
    setImportedFen(fen); setOrientation(color); setRecord(null); void analyze(fen, 'progressive');
  }, [analyze]);
  useEffect(() => {
    if (active && !started.current && initialFen) { started.current = true; void analyze(startingFen, 'progressive'); }
  }, [active, initialFen, startingFen, analyze]);
  useEffect(() => { if (!active) { searchId.current += 1; engine.cancel(); setBusy(false); setProgress(null); } }, [active, engine]);
  useEffect(() => () => { searchId.current += 1; engine.terminate(); }, [engine]);
  useEffect(() => { if (promotion) promotionDialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [promotion]);
  useEffect(() => {
    const strip = moveStrip.current;
    const selected = strip?.querySelector<HTMLButtonElement>('.is-active');
    if (!strip || !selected) return;
    const left = selected.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollTo({ left });
    else if (left + selected.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: left + selected.offsetWidth - strip.clientWidth });
  }, [ply, activeLine?.id, manual]);

  const chooseLine = useCallback((next: ResearchLine) => {
    setActiveLine(next); setPly(0); setManual(null); setBranchReturn(null); setSelectedSquare(null); setPromotion(null);
    if (window.matchMedia('(max-width: 780px)').matches) requestAnimationFrame(() => document.getElementById('analysis-position')?.scrollIntoView({ block: 'start' }));
  }, []);
  const commitMove = useCallback((from: string, to: string, promoteTo = 'q') => {
    const copy = new Chess(viewFen);
    try {
      const move = copy.move({ from, to, promotion: promoteTo });
      if (!manual) setBranchReturn({ line: activeLine, ply });
      setManual((current) => ({ fens: [...(current?.fens ?? [viewFen]), copy.fen()], moves: [...(current?.moves ?? []), moveToUci(move)] }));
      setSelectedSquare(null); setPromotion(null); setKeyboardSquare(to); setNotice(null); return true;
    } catch { return false; }
  }, [viewFen, manual, activeLine, ply]);
  const attemptMove = useCallback((from: string, to: string) => {
    if (promotion || board.isGameOver()) return false;
    const legal = board.moves({ square: from as Square, verbose: true }).filter((move) => move.to === to);
    if (!legal.length) return false;
    if (legal.some((move) => move.isPromotion())) { setPromotion({ from, to }); return false; }
    return commitMove(from, to);
  }, [board, promotion, commitMove]);
  const clickSquare = useCallback<NonNullable<ChessboardOptions['onSquareClick']>>(({ square }) => {
    if (promotion || board.isGameOver()) return;
    if (selectedSquare && selectedSquare !== square && attemptMove(selectedSquare, square)) return;
    const piece = board.get(square as Square);
    setSelectedSquare(piece?.color === board.turn() && selectedSquare !== square ? square as Square : null);
  }, [promotion, board, selectedSquare, attemptMove]);
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    const last = manual?.moves.at(-1) ?? (line && ply > 0 ? line.moves[ply - 1] : undefined);
    const pair = last ? squarePairFromUci(last) : null;
    if (pair) for (const square of pair) styles[square] = { backgroundColor: '#cebb78' };
    if (activeLine?.kind === 'trap' && !manual && ply === 0) for (const square of lineTarget(analysisFen, activeLine.moves).squares) {
      styles[square] = { boxShadow: 'inset 0 0 0 3px rgba(182, 91, 43, .7)' };
    }
    if (selectedSquare) {
      styles[selectedSquare] = { boxShadow: 'inset 0 0 0 4px #b76536', backgroundColor: '#ceba81' };
      for (const move of board.moves({ square: selectedSquare, verbose: true })) styles[move.to] = { backgroundImage: move.isCapture()
        ? 'radial-gradient(transparent 55%, rgba(26,44,29,.4) 56%, rgba(26,44,29,.4) 67%, transparent 68%)'
        : 'radial-gradient(rgba(26,44,29,.38) 19%, transparent 20%)' };
    }
    return styles;
  }, [manual, line, ply, activeLine, analysisFen, selectedSquare, board]);
  const nextMove = !manual && line ? line.moves[ply] : selectedMove && viewFen === analysisFen ? selectedMove : undefined;
  const nextPair = nextMove ? squarePairFromUci(nextMove) : null;
  const boardOptions: ChessboardOptions = {
    id: 'research-board', position: viewFen, boardOrientation: orientation === 'w' ? 'white' : 'black',
    showNotation: true, animationDurationInMs: 180, allowDrawingArrows: true, allowDragging: !promotion && !board.isGameOver(),
    canDragPiece: ({ piece }) => piece.pieceType[0] === board.turn(),
    onPieceDrop: ({ sourceSquare, targetSquare }) => Boolean(targetSquare && attemptMove(sourceSquare, targetSquare)), onSquareClick: clickSquare,
    boardStyle: { borderRadius: 8, boxShadow: '0 12px 38px rgba(21,28,41,.13)' },
    lightSquareStyle: { backgroundColor: '#ede5d6' }, darkSquareStyle: { backgroundColor: '#80917a' }, squareStyles,
    arrows: nextPair && !selectedSquare ? [{ startSquare: nextPair[0], endSquare: nextPair[1], color: activeLine?.kind === 'defense' ? 'rgba(42, 102, 75, .85)' : board.turn() === analysisFen.split(' ')[1] ? 'rgba(36, 90, 142, .85)' : 'rgba(185, 96, 43, .9)' }] : [],
    squareRenderer: ({ square, piece, children }) => <div id={`research-square-${square}`} className="keyboard-square" role="button"
      style={{ width: '100%', height: '100%', ...squareStyles[square] }} tabIndex={keyboardSquare === square ? 0 : -1}
      aria-label={`${square}: ${piece ? `${piece.pieceType[0] === 'w' ? 'White' : 'Black'} ${pieceName(piece.pieceType[1])}` : 'empty'}`}
      aria-pressed={selectedSquare === square} onFocus={() => setKeyboardSquare(square)} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); clickSquare({ square, piece }); }
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
        if (!delta) return; event.preventDefault(); const direction = orientation === 'w' ? 1 : -1;
        const file = square.charCodeAt(0) + delta[0] * direction; const rank = Number(square[1]) + delta[1] * direction;
        if (file < 97 || file > 104 || rank < 1 || rank > 8) return;
        const destination = `${String.fromCharCode(file)}${rank}`; setKeyboardSquare(destination);
        requestAnimationFrame(() => document.getElementById(`research-square-${destination}`)?.focus());
      }}>{children}</div>,
  };

  const restoreAnalysis = () => { setManual(null); setBranchReturn(null); setActiveLine(null); setPly(0); setSelectedSquare(null); setPromotion(null); };
  const restoreImport = () => {
    stopSearch(); setAnalysisFen(importedFen); setActiveLine(null); setPly(0); setManual(null); setBranchReturn(null); setSelectedSquare(null); setPromotion(null);
    const found = [...cache.current.values()].reverse().find((entry) => entry.fen === importedFen);
    setRecord(found ?? null); setSelectedMove(found?.result.decision?.move ?? ''); setNotice('Returned to your imported position.');
  };
  const copyFen = async () => {
    try { await navigator.clipboard.writeText(viewFen); setNotice('Current board FEN copied.'); }
    catch { setNotice('Select and copy the FEN below.'); }
  };
  const currentPgn = () => {
    const moves = manual ? [...(branchReturn?.line?.moves.slice(0, branchReturn.ply) ?? []), ...manual.moves] : activeLine?.moves ?? [];
    return variationToPgn(analysisFen, legalLine(analysisFen, moves).moves);
  };
  const copyPgn = async () => { try { await navigator.clipboard.writeText(currentPgn()); setNotice('Analysis line PGN copied.'); } catch { setNotice('Clipboard unavailable. Use Export PGN to save the line.'); } };
  const exportPgn = () => {
    const url = URL.createObjectURL(new Blob([currentPgn()], { type: 'application/x-chess-pgn' }));
    const link = document.createElement('a'); link.href = url; link.download = 'trappyfish-analysis.pgn'; link.click(); URL.revokeObjectURL(url);
    setNotice('Analysis line exported as PGN.');
  };
  const navigate = (nextPly: number) => { setPly(nextPly); setSelectedSquare(null); setPromotion(null); };
  const phaseProgress = progress ? Math.max(0, Math.min(1, progress.completed / Math.max(1, progress.total))) : 0;

  return <main className={`analysis-workspace${record || busy ? ' has-analysis' : ''}`}>
    <section className="research-import-entry" aria-label="Import position for analysis"><PositionImport variant="analysis" initialOpen={!initialFen} currentFen={viewFen} playerColor={orientation} onLoad={loadAndAnalyze} /></section>
    {record ? <nav className="mobile-analysis-jumps" aria-label="Analysis shortcuts"><a href="#analysis-position">Board &amp; line</a><a href="#analysis-plans">Plans{decision ? ` · ${decision.selected.san}` : ''}</a></nav> : null}
    <section id="analysis-position" className="research-board-column" aria-label="Analysis chessboard and position import">
      <div className="research-board-heading"><h2>{board.isCheckmate() ? 'Checkmate' : board.isDraw() ? 'Drawn position' : `${board.turn() === 'w' ? 'White' : 'Black'} to move`}</h2>
        <span className={`research-pill ${manual || busy ? 'amber' : ''}`}>{manual ? 'Your branch' : busy ? 'Analyzing…' : ply > 0 ? `Line · ply ${ply}` : 'Position analysis'}</span></div>
      <div className="research-board-wrap" data-testid="analysis-board" data-fen={viewFen}><Chessboard options={boardOptions} />
        {promotion ? <div className="promotion-backdrop"><section ref={promotionDialog} className="promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="research-promotion-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setPromotion(null); }
            if (event.key === 'Tab') {
              const buttons = Array.from(promotionDialog.current?.querySelectorAll<HTMLButtonElement>('button') ?? []); const first = buttons[0]; const last = buttons.at(-1);
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}><h2 id="research-promotion-title">Choose promotion</h2><div className="promotion-choices">{(['q', 'r', 'b', 'n'] as const).map((piece) => <button type="button" key={piece} onClick={() => commitMove(promotion.from, promotion.to, piece)}>
            <span aria-hidden="true">{{ q: '♛', r: '♜', b: '♝', n: '♞' }[piece]}</span>{pieceName(piece)}</button>)}</div>
          <button type="button" onClick={() => setPromotion(null)}>Cancel promotion</button></section></div> : null}
      </div>

      <section className={`line-navigator ${activeLine?.kind === 'defense' ? 'is-defense' : ''}`} aria-label="Variation explorer">
        <div className="line-heading"><span className="line-title" title={manual ? 'Explore your own continuation' : activeLine?.label}><GitBranch size={16} /> {manual ? 'Your continuation' : activeLine?.label ?? 'Explore the board'}</span>
          <span className="line-ply-count">{manual ? `${manual.moves.length} moves` : line ? `${ply} / ${line.moves.length}` : ''}</span>
          {line && !manual ? <div className="line-transport"><button type="button" aria-label="Start of line" disabled={ply === 0} onClick={() => navigate(0)}><ChevronFirst size={17} /></button>
            <button type="button" aria-label="Previous move" disabled={ply === 0} onClick={() => navigate(ply - 1)}><ArrowLeft size={19} /></button>
            <button type="button" aria-label="Next move" disabled={ply >= line.moves.length} onClick={() => navigate(ply + 1)}><ArrowRight size={19} /></button>
            <button type="button" aria-label="End of line" disabled={ply >= line.moves.length} onClick={() => navigate(line.moves.length)}><ChevronLast size={17} /></button></div> : null}</div>
        {line && !manual ? <>
          <div className="line-move-chips" ref={moveStrip}><button type="button" className={ply === 0 ? 'is-active' : ''} onClick={() => navigate(0)}>Start</button>
            {line.moves.map((move, index) => <button type="button" key={`${index}-${move}`} data-uci={move} data-ply={index + 1}
              className={ply === index + 1 ? 'is-active' : ''} onClick={() => navigate(index + 1)}>{line.labels[index]}</button>)}</div>
          {!line.complete ? <p className="import-warning">The displayed line stops at its last verified legal move.</p> : null}
        </> : manual ? <>
          <p className="manual-line">{legalLine(manual.fens[0], manual.moves).labels.join(' ')}</p>
          <div className="branch-actions"><button type="button" disabled={!manual.moves.length} onClick={() => setManual((current) => current && current.moves.length > 1 ? { moves: current.moves.slice(0, -1), fens: current.fens.slice(0, -1) } : null)}><ArrowLeft size={16} /> Undo branch move</button>
            <button type="button" onClick={() => { setActiveLine(branchReturn?.line ?? null); setPly(branchReturn?.ply ?? 0); setManual(null); setBranchReturn(null); setSelectedSquare(null); }}>Return to line</button></div>
        </> : <p>Move either side to test an idea, then analyze the new position.</p>}
        {viewFen !== analysisFen || (!decision && !busy) ? <div className="line-next-action"><button type="button" className="primary-button" onClick={() => void analyze(viewFen, 'progressive')}><Search size={16} /> {viewFen === analysisFen ? 'Analyze this position' : 'Analyze this branch'}</button>
          {viewFen !== analysisFen ? <button type="button" onClick={restoreAnalysis}>Return to analyzed position</button> : null}</div> : null}
      </section>
      <div className="research-board-tools"><button type="button" onClick={() => setOrientation(opposite(orientation))}><FlipVertical2 size={15} /> Flip</button>
        <button type="button" onClick={copyFen}><Copy size={15} /> Copy FEN</button>
        <details className="research-more-tools"><summary aria-label="More board tools"><MoreHorizontal size={17} /> More</summary><div onClick={(event) => {
          if (!(event.target instanceof Element) || !event.target.closest('button')) return;
          const menu = event.currentTarget.closest('details'); menu?.removeAttribute('open'); menu?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
        }}>
        <button type="button" onClick={copyPgn}><Copy size={15} /> Copy PGN</button><button type="button" onClick={exportPgn}><Download size={15} /> Export PGN</button>
        <button type="button" onClick={restoreImport}><RotateCcw size={14} /> Restore imported position</button>
        <button type="button" className="research-text-button" onClick={() => { stopSearch(); onPlayFromPosition(viewFen, board.turn()); }}><Swords size={14} /> Play from here</button>
        <details className="research-fen"><summary>Current board FEN</summary><textarea aria-label="Current board FEN" readOnly value={viewFen} rows={3} onFocus={(event) => event.currentTarget.select()} /></details>
        <p className="research-board-hint">Blue: your next move. Orange: their reply. Green: best defense. Tap or drag to test either side.</p>
        </div></details></div>
      {notice ? <p className="import-notice" role="status">{notice}</p> : null}
    </section>

    <section id="analysis-plans" className="research-results-column" aria-label="Trap research">
      <section className="research-search-controls" aria-label="Analysis settings">
        <div className="research-settings-row"><label>Opponent rating<select aria-label="Analysis opponent rating" value={settings.opponentRating} onChange={(event) => setSettings({ ...settings, opponentRating: Number(event.target.value) })}>
          {![800, 1000, 1200, 1400, 1800, 2200, 2600].includes(settings.opponentRating) ? <option value={settings.opponentRating}>{settings.opponentRating} · custom</option> : null}
          {[800, 1000, 1200, 1400, 1800, 2200, 2600].map((rating) => <option key={rating} value={rating}>{rating}{rating === 1000 ? ' · ruthless default' : ''}</option>)}</select></label>
          <div className="analysis-depth-buttons"><button type="button" disabled={busy} onClick={() => void analyze(manual ? viewFen : analysisFen, 'quick')}><Zap size={15} /> Quick</button>
            <button type="button" className="primary-button" disabled={busy} onClick={() => void analyze(manual ? viewFen : analysisFen, 'deep')}><BrainCircuit size={15} /> {record?.depth === 'quick' ? 'Deepen analysis' : 'Deep'}</button></div></div>
        <details className="research-advanced"><summary>Customize analysis</summary><div>
          <label>Custom opponent rating<input aria-label="Custom analysis opponent rating" type="number" min={400} max={3000} step={100} value={settings.opponentRating} onChange={(event) => { const rating = Number(event.target.value); if (rating >= 400 && rating <= 3000) setSettings({ ...settings, opponentRating: rating }); }} /></label>
          <label>Root depth<input aria-label="Analysis root depth" type="number" min={6} max={20} value={settings.rootDepth} onChange={(event) => setSettings({ ...settings, rootDepth: Math.max(6, Math.min(20, Number(event.target.value))) })} /></label>
          <label>Outcome depth<input aria-label="Analysis outcome depth" type="number" min={6} max={18} value={settings.trapDepth} onChange={(event) => setSettings({ ...settings, trapDepth: Math.max(6, Math.min(18, Number(event.target.value))) })} /></label>
          <label>Risk limit (pawns)<input aria-label="Analysis risk limit in pawns" type="number" min={0} max={3} step={0.25} value={settings.maxRiskCp / 100} onChange={(event) => setSettings({ ...settings, maxRiskCp: Math.max(0, Math.min(300, Number(event.target.value) * 100)) })} /></label>
          <label>Candidate moves<input aria-label="Analysis candidates" type="number" min={4} max={24} value={settings.candidateCount} onChange={(event) => setSettings({ ...settings, candidateCount: Math.max(4, Math.min(24, Number(event.target.value))) })} /></label>
          <label>Opponent turns<select aria-label="Analysis opponent turns" value={settings.opponentPlies} onChange={(event) => setSettings({ ...settings, opponentPlies: Number(event.target.value) as 1 | 2 })}><option value={1}>One · faster</option><option value={2}>Two · deeper traps</option></select></label>
        </div><p>Deep uses these settings. Quick uses a smaller one-turn search. Changes apply when you start the next search.</p></details>
        {busy ? <div className="analysis-progress" data-testid="analysis-progress" role="status" aria-live="polite"><div><span><BrainCircuit size={15} /> {phase === 'quick' ? 'Quick scan' : 'Deep analysis'}{record?.depth === 'quick' && phase === 'deep' ? ' · first results below' : ''}</span><button type="button" onClick={stopSearch}><StopIcon size={13} /> Stop</button></div>
          <p>{progress?.message ?? 'Starting engines…'}</p><progress aria-label="Analysis search progress" value={phaseProgress} max={1} /><small>{phase === 'deep' ? `Stockfish ${searchSettings.rootDepth}/${searchSettings.trapDepth} · up to ${searchSettings.opponentPlies} opponent turns` : 'Stockfish 10/8 · one opponent turn'}. First use also loads the local Maia model.</small></div> : record ? <div className="analysis-complete" data-testid="analysis-progress" role="status"><Check size={15} /> {record.depth === 'deep' ? 'Deep analysis ready' : 'Quick analysis ready'} · {record.settings.opponentRating} opponent · depth {record.settings.rootDepth}/{record.settings.trapDepth}</div> : null}
        {changedSettings && !busy ? <p className="import-warning">Controls changed. Results below still use the settings shown in their search summary. Start a search to update them.</p> : null}
        {error ? <p className="error-strip" role="alert">{error}</p> : null}
      </section>

      {isBranch ? <section className="research-branch-empty"><GitBranch size={30} /><h2>You’re exploring a new branch</h2><p>The previous analysis belongs to the {analyzedSide} position you started from. Analyze this board to find its own traps and defenses.</p>
        <button type="button" className="primary-button" onClick={() => void analyze(viewFen, 'progressive')}><Search size={16} /> Analyze this branch</button><button type="button" onClick={restoreAnalysis}>Return to analyzed position</button></section>
        : decision ? <>{ply > 0 ? <div className="analysis-position-context">Reviewing a continuation. Candidate scores refer to the starting {analyzedSide}-to-move position.</div> : null}
          <TrapAnalysisPanel decision={decision} fen={analysisFen} selectedMove={selectedMove} activeLineId={activeLine?.id} maxRiskCp={record!.settings.maxRiskCp} onSelectCandidate={selectCandidate} onSelectLine={chooseLine} /></>
          : record?.result.terminal ? <section className="research-terminal"><ShieldCheck size={30} /><h2>{record.result.terminal === 'checkmate' ? 'This position is checkmate' : 'This position is drawn'}</h2><p>There are no live trap lines to analyze. Import another position or return to the imported board.</p></section>
            : <section className="research-starter"><div className="starter-icon"><CrosshairIcon /></div><h2>{busy ? 'Reading the position…' : 'A screenshot is the starting point.'}</h2>
              <p>{busy ? 'The first pass finds promising moves. The deeper pass checks defenses and second mistakes.' : 'Import a board, confirm the pieces and side to move, and get a ranked plan without playing a move.'}</p>
              <ol><li><span>1</span><div><strong>Import your position</strong><p>Upload, paste, or drop a screenshot. FEN works too.</p></div></li>
                <li><span>2</span><div><strong>Compare the traps and the defense</strong><p>See the targets, human reply chances, and how much risk each move takes.</p></div></li>
                <li><span>3</span><div><strong>Walk the line. Test your idea.</strong><p>Step through the punishment, make a different move, then analyze that branch.</p></div></li></ol>
              {!busy ? <button type="button" className="example-button" onClick={() => loadAndAnalyze(LEGAL_EXAMPLE, 'w')}><Zap size={16} /> Try Légal’s queen bait <ArrowRight size={16} /></button> : null}
            </section>}
    </section>
  </main>;
}

function CrosshairIcon() { return <Search size={32} />; }

function refreshReplyLine(candidate: CandidateInfo, previous: ResearchLine | null): ResearchLine | undefined {
  if (!previous?.reply) return;
  const reply = candidate.replies.find((entry) => entry.move === previous.reply!.move);
  if (!reply) return;
  if (previous.conditionalProbability !== undefined) {
    const next = reply.continuation?.replies.find((entry) => entry.move === previous.moves[3]);
    if (!next || !reply.continuation) return;
    return { ...previous, moves: [candidate.move, reply.move, reply.continuation.move, next.move, ...next.punishment],
      reply, probability: reply.probability * next.probability, conditionalProbability: next.probability, scoreCp: next.scoreCp };
  }
  return { ...previous, moves: [candidate.move, reply.move, ...reply.punishment], reply, probability: reply.probability, scoreCp: reply.scoreCp };
}
