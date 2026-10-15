import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Color, type Move, type Square } from 'chess.js';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import { Bot, BrainCircuit, Check, Eye, EyeOff, FlipVertical2, RotateCcw, Swords, Undo2 } from 'lucide-react';
import { UciClient } from '../engine/uci';
import { MaiaClient } from '../engine/maia';
import { PositionImport } from './PositionImport';
import { validatePosition } from '../import/position';
import {
  DEFAULT_TRAPPY_SETTINGS, TrappyEngine, moveToUci, opposite, playUci, squarePairFromUci,
  type MoveDecision, type TrappySettings,
} from '../engine/trappy';

const ENGINE_ARROW = 'rgba(26, 92, 180, 0.75)';
const TRAP_ARROW = 'rgba(215, 111, 34, 0.9)';
type Plan = { decision: MoveDecision; fen: string };
type ReviewedPlan = Plan & { actualReply: string; actualReplySan: string };
type Promotion = { from: string; to: string };

export function PlayWorkspace({ initialFen, initialPlayer = 'w', active = true }: { initialFen?: string; initialPlayer?: Color; active?: boolean }) {
  const gameRef = useRef(createInitialGame(initialFen));
  const activeRef = useRef(active);
  activeRef.current = active;
  const searchIdRef = useRef(0);
  const uci = useMemo(() => new UciClient(), []);
  const maia = useMemo(() => new MaiaClient(), []);
  const trappyEngine = useMemo(() => new TrappyEngine(uci, maia), [uci, maia]);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [playerColor, setPlayerColor] = useState<Color>(initialPlayer);
  const [orientation, setOrientation] = useState<Color>(initialPlayer);
  const [newGameColor, setNewGameColor] = useState<Color>(initialPlayer);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [trappyEnabled, setTrappyEnabled] = useState(true);
  const [analysis, setAnalysis] = useState(false);
  const [settings, setSettings] = useState<TrappySettings>(DEFAULT_TRAPPY_SETTINGS);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [review, setReview] = useState<ReviewedPlan | null>(null);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [keyboardSquare, setKeyboardSquare] = useState<string>(initialPlayer === 'w' ? 'e2' : 'e7');
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  const promotionDialog = useRef<HTMLElement>(null);
  const engineColor = opposite(playerColor);
  const game = gameRef.current;

  const syncGameState = useCallback(() => {
    setFen(gameRef.current.fen());
    setMoveHistory(gameRef.current.history({ verbose: true }));
  }, []);

  const clearInteraction = useCallback(() => { setSelectedSquare(null); setPromotion(null); }, []);
  const cancelPromotion = useCallback(() => {
    const from = promotion?.from;
    clearInteraction();
    if (from) requestAnimationFrame(() => document.getElementById(`trappy-board-keyboard-${from}`)?.focus());
  }, [promotion, clearInteraction]);

  const resetGame = useCallback((color = playerColor) => {
    searchIdRef.current += 1;
    trappyEngine.cancel();
    gameRef.current = new Chess();
    setPlayerColor(color);
    setOrientation(color);
    setThinking(false);
    setPlan(null);
    setReview(null);
    setLastMove(null);
    setError(null);
    setNotice(null);
    setNewGameOpen(false);
    clearInteraction();
    syncGameState();
  }, [playerColor, trappyEngine, clearInteraction, syncGameState]);

  const loadPosition = useCallback((input: string, color: Color) => {
    const position = validatePosition(input);
    if (!position.fen) { setError(position.error ?? 'Invalid position.'); return; }
    searchIdRef.current += 1;
    trappyEngine.cancel();
    gameRef.current = new Chess(position.fen);
    setPlayerColor(color);
    setOrientation(color);
    setNewGameColor(color);
    setThinking(false);
    setPlan(null);
    setReview(null);
    setLastMove(null);
    setError(null);
    setNotice('Position loaded.');
    clearInteraction();
    syncGameState();
  }, [trappyEngine, clearInteraction, syncGameState]);

  const undoPair = useCallback(() => {
    if (thinking) return;
    searchIdRef.current += 1;
    setError(null);
    gameRef.current.undo();
    if (gameRef.current.turn() !== playerColor) gameRef.current.undo();
    setPlan(null);
    setReview(null);
    setLastMove(null);
    clearInteraction();
    syncGameState();
  }, [playerColor, syncGameState, thinking, clearInteraction]);

  const makeEngineMove = useCallback(async () => {
    const activeGame = gameRef.current;
    if (!active || thinking || activeGame.isGameOver() || activeGame.turn() !== engineColor) return;
    const searchId = ++searchIdRef.current;
    const fenAtStart = activeGame.fen();
    setThinking(true);
    setError(null);
    try {
      const decision = await trappyEngine.chooseMove(fenAtStart, settings, trappyEnabled);
      if (!activeRef.current || searchId !== searchIdRef.current || gameRef.current.fen() !== fenAtStart) return;
      const move = playUci(gameRef.current, decision.move);
      if (!move) throw new Error(`Engine produced an illegal move: ${decision.move}`);
      setPlan({ decision, fen: gameRef.current.fen() });
      setLastMove(moveToUci(move));
      syncGameState();
    } catch (err) {
      if (searchId === searchIdRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (searchId === searchIdRef.current) setThinking(false);
    }
  }, [active, engineColor, settings, syncGameState, thinking, trappyEnabled, trappyEngine]);

  useEffect(() => {
    if (active && !error && gameRef.current.turn() === engineColor && !gameRef.current.isGameOver()) void makeEngineMove();
  }, [active, engineColor, error, fen, makeEngineMove]);
  useEffect(() => {
    if (active) return;
    searchIdRef.current += 1;
    trappyEngine.cancel();
    setThinking(false);
    clearInteraction();
  }, [active, trappyEngine, clearInteraction]);
  useEffect(() => () => trappyEngine.terminate(), [trappyEngine]);
  useEffect(() => {
    if (promotion) promotionDialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [promotion]);

  const commitPlayerMove = useCallback((from: string, to: string, promoteTo = 'q'): boolean => {
    if (thinking || gameRef.current.isGameOver() || gameRef.current.turn() !== playerColor) return false;
    try {
      const move = gameRef.current.move({ from, to, promotion: promoteTo });
      const returnFocusToBoard = promotionDialog.current !== null;
      if (plan) setReview({ ...plan, actualReply: moveToUci(move), actualReplySan: move.san });
      setLastMove(moveToUci(move));
      setPlan(null);
      setError(null);
      setNotice(null);
      clearInteraction();
      setKeyboardSquare(to);
      if (returnFocusToBoard) requestAnimationFrame(() => document.getElementById(`trappy-board-keyboard-${to}`)?.focus());
      syncGameState();
      return true;
    } catch { return false; }
  }, [playerColor, syncGameState, thinking, plan, clearInteraction]);

  const attemptPlayerMove = useCallback((from: string, to: string): boolean => {
    if (thinking || promotion || gameRef.current.turn() !== playerColor || gameRef.current.isGameOver()) return false;
    const legal = gameRef.current.moves({ square: from as Square, verbose: true }).filter((move) => move.to === to);
    if (!legal.length) return false;
    if (legal.some((move) => move.isPromotion())) {
      setPromotion({ from, to });
      setSelectedSquare(from as Square);
      return false;
    }
    return commitPlayerMove(from, to);
  }, [thinking, promotion, playerColor, commitPlayerMove]);

  const handleDrop = useCallback<NonNullable<ChessboardOptions['onPieceDrop']>>(
    ({ sourceSquare, targetSquare }) => Boolean(targetSquare && attemptPlayerMove(sourceSquare, targetSquare)),
    [attemptPlayerMove],
  );
  const handleSquareClick = useCallback<NonNullable<ChessboardOptions['onSquareClick']>>(({ square }) => {
    if (thinking || promotion || gameRef.current.isGameOver() || gameRef.current.turn() !== playerColor) return;
    if (selectedSquare && selectedSquare !== square && attemptPlayerMove(selectedSquare, square)) return;
    const piece = gameRef.current.get(square as Square);
    setSelectedSquare(piece?.color === playerColor && selectedSquare !== square ? square as Square : null);
  }, [thinking, promotion, playerColor, selectedSquare, attemptPlayerMove]);

  const styles = useMemo(() => {
    const result = squareStyles(lastMove, analysis ? plan?.decision.selected.trap?.reply : undefined);
    if (selectedSquare) {
      result[selectedSquare] = { boxShadow: 'inset 0 0 0 4px #d47435', backgroundColor: '#ceba81' };
      for (const move of gameRef.current.moves({ square: selectedSquare, verbose: true })) {
        result[move.to] = {
          backgroundImage: move.isCapture() || move.isEnPassant()
            ? 'radial-gradient(transparent 55%, rgba(26, 44, 29, 0.35) 56%, rgba(26, 44, 29, 0.35) 67%, transparent 68%)'
            : 'radial-gradient(rgba(26, 44, 29, 0.35) 19%, transparent 20%)',
        };
      }
    }
    return result;
  }, [lastMove, analysis, plan, selectedSquare, fen]);

  const boardOptions = useMemo<ChessboardOptions>(() => ({
    id: 'trappy-board', position: fen, boardOrientation: orientation === 'w' ? 'white' : 'black',
    animationDurationInMs: 180, showNotation: true, allowDrawingArrows: !promotion,
    allowDragging: !thinking && !promotion && !game.isGameOver() && game.turn() === playerColor,
    canDragPiece: ({ piece }) => game.turn() === playerColor && piece.pieceType[0] === playerColor,
    onPieceDrop: handleDrop, onSquareClick: handleSquareClick,
    boardStyle: { borderRadius: 7, boxShadow: '0 18px 55px rgba(21, 28, 41, 0.18)' },
    lightSquareStyle: { backgroundColor: '#e9dfcf' }, darkSquareStyle: { backgroundColor: '#7a8f77' },
    squareStyles: styles,
    squareRenderer: ({ square, piece, children }) => <div id={`trappy-board-keyboard-${square}`} className="keyboard-square"
      style={{ width: '100%', height: '100%', ...styles[square] }} role="button" tabIndex={keyboardSquare === square ? 0 : -1}
      aria-label={`${square}${piece ? `: ${piece.pieceType[0] === 'w' ? 'White' : 'Black'} ${pieceName(piece.pieceType[1])}` : ': empty'}`}
      aria-pressed={selectedSquare === square} onFocus={() => setKeyboardSquare(square)} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleSquareClick({ square, piece }); }
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
        if (!delta) return;
        event.preventDefault();
        const direction = orientation === 'w' ? 1 : -1;
        const file = square.charCodeAt(0) + delta[0] * direction;
        const rank = Number(square[1]) + delta[1] * direction;
        if (file < 97 || file > 104 || rank < 1 || rank > 8) return;
        const destination = `${String.fromCharCode(file)}${rank}`;
        setKeyboardSquare(destination);
        requestAnimationFrame(() => document.getElementById(`trappy-board-keyboard-${destination}`)?.focus());
      }}>{children}</div>,
    arrows: analysis ? boardArrows(lastMove, plan?.decision.selected.trap?.reply) : [],
  }), [fen, orientation, thinking, promotion, game, playerColor, handleDrop, handleSquareClick, styles, analysis, lastMove, plan, keyboardSquare, selectedSquare]);

  return (
    <main className="app-shell">
      <section className="board-column" aria-label="Chess board">
        <header className="panel-header">
          <div><div className="brand-line"><Swords size={24} /><h1>Trappyfish</h1></div>
            <p role="status" aria-live="polite">{statusText(game, playerColor, thinking)}</p></div>
          <div className="status-light" data-active={thinking || undefined} aria-label={thinking ? 'Engine thinking' : 'Ready'}>
            {thinking ? <BrainCircuit size={20} /> : <Check size={20} />}
          </div>
        </header>
        <div className="board-meta"><span>You play {playerColor === 'w' ? 'White' : 'Black'}</span>
          <span>{trappyEnabled ? `Ruthless · ${settings.opponentRating} profile` : 'Stockfish'}</span></div>
        <div className="board-wrap">
          <Chessboard options={boardOptions} />
          {promotion ? <div className="promotion-backdrop">
            <section ref={promotionDialog} className="promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title" onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); cancelPromotion(); }
              if (event.key === 'Tab') {
                const buttons = Array.from(promotionDialog.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
                const first = buttons[0]; const last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
            }}>
              <h2 id="promotion-title">Choose your promotion</h2>
              <div className="promotion-choices">{(['q', 'r', 'b', 'n'] as const).map((piece) => <button key={piece} type="button"
                onClick={() => commitPlayerMove(promotion.from, promotion.to, piece)}>
                <span aria-hidden="true">{{ q: '♛', r: '♜', b: '♝', n: '♞' }[piece]}</span>
                {{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[piece]}
              </button>)}</div>
              <button className="subtle-button" type="button" onClick={cancelPromotion}>Cancel promotion</button>
            </section>
          </div> : null}
        </div>
        <div className="board-tools">
          <button type="button" aria-expanded={newGameOpen} onClick={() => setNewGameOpen(!newGameOpen)}><RotateCcw size={16} /> New game</button>
          <button type="button" disabled={!moveHistory.length || thinking} onClick={undoPair}><Undo2 size={16} /> Undo</button>
          <button type="button" onClick={() => setOrientation(opposite(orientation))}><FlipVertical2 size={16} /> Flip board</button>
        </div>
        {newGameOpen ? <section className="new-game-panel" aria-label="Start a new game">
          <label>Play as <select aria-label="New game colour" value={newGameColor} onChange={(event) => setNewGameColor(event.target.value as Color)}>
            <option value="w">White</option><option value="b">Black</option></select></label>
          <button className="primary-button" type="button" onClick={() => resetGame(newGameColor)}>Start new game</button>
          <p>This starts from the initial position.</p>
        </section> : null}
        <p className="board-hint">Tap a piece, then its destination. You can also drag.</p>
      </section>

      <section className="side-panel" aria-label="Game controls">
        <section className="opponent-panel" aria-label="Opponent setup">
          <div className="section-title"><h2>Your opponent</h2><span className="mode-badge">{trappyEnabled ? 'RUTHLESS' : 'STOCKFISH'}</span></div>
          <div className="control-band persona-controls">
            <button className={trappyEnabled ? 'is-active' : ''} aria-pressed={trappyEnabled} disabled={thinking} onClick={() => setTrappyEnabled(true)} type="button"><Swords size={17} /> Ruthless</button>
            <button className={!trappyEnabled ? 'is-active' : ''} aria-pressed={!trappyEnabled} disabled={thinking} onClick={() => setTrappyEnabled(false)} type="button"><Bot size={17} /> Stockfish</button>
          </div>
          <p className="persona-description">{trappyEnabled ? 'Targets mistakes. Follows through.' : 'Plays the strongest move it finds.'}</p>
          <SettingsPanel settings={settings} setSettings={setSettings} disabled={thinking} trappyEnabled={trappyEnabled} />
        </section>
        <div className="view-switch" role="group" aria-label="View mode">
          <button type="button" className={!analysis ? 'is-active' : ''} aria-pressed={!analysis} onClick={() => setAnalysis(false)}><EyeOff size={16} /> Play</button>
          <button type="button" className={analysis ? 'is-active' : ''} aria-pressed={analysis} onClick={() => setAnalysis(true)}><Eye size={16} /> Analysis</button>
        </div>
        {analysis ? <p className="analysis-notice" role="status">Analysis reveals the engine’s current plans and predicted replies.</p> : null}
        {error ? <div className="error-strip" role="alert">{error}
          {game.turn() === engineColor ? <button type="button" onClick={() => setError(null)}>Retry search</button> : null}</div> : null}
        {notice ? <p className="import-notice" role="status">{notice}</p> : null}
        {plan?.decision.warning && !analysis ? <p className="import-warning" role="status">{plan.decision.warning}</p> : null}
        {analysis ? <DecisionPanel decision={plan?.decision ?? null} trappyEnabled={trappyEnabled} fen={plan?.fen ?? fen} /> : <section className="decision empty-state play-state">
          <h2>{game.isGameOver() ? 'Game finished' : thinking ? 'Finding the punishment…' : 'No hints. Make your move.'}</h2>
          <p>{game.isGameOver() ? 'Review the previous move below, or start a new game.' : 'The engine’s plans stay hidden in Play mode.'}</p>
        </section>}
        {review ? <details className="past-review" key={review.fen}>
          <summary>Review your last move: {review.actualReplySan}</summary>
          <p className="review-intro">The plan behind {review.decision.san}, before you played {review.actualReplySan}.
            {review.decision.selected.trap?.reply === review.actualReply && !review.decision.selected.trap.nextReply ? ' You took the bait.' : ''}</p>
          {analysis || game.isGameOver()
            ? <DecisionPanel decision={review.decision} trappyEnabled={review.decision.mode === 'trappy'} fen={review.fen} />
            : <CommittedMoveReview review={review} />}
        </details> : null}
        <MoveList moves={moveHistory} />
        <PositionImport currentFen={fen} playerColor={playerColor} onLoad={loadPosition} />
      </section>
    </main>
  );
}

function createInitialGame(fen?: string): Chess {
  if (!fen) return new Chess();
  try { const position = validatePosition(fen); return position.fen ? new Chess(position.fen) : new Chess(); }
  catch { return new Chess(); }
}

function SettingsPanel({ settings, setSettings, disabled, trappyEnabled }: {
  settings: TrappySettings; setSettings: (settings: TrappySettings) => void; disabled: boolean; trappyEnabled: boolean;
}) {
  return <div className="settings">
    {trappyEnabled ? <><div className="rating-heading"><span>Your rating</span><strong>{settings.opponentRating}</strong></div>
      <div className="rating-presets" role="group" aria-label="Opponent rating presets">
        {[800, 1000, 1400, 1800].map((rating) => <button type="button" key={rating} disabled={disabled}
          className={settings.opponentRating === rating ? 'is-active' : ''} aria-pressed={settings.opponentRating === rating}
          onClick={() => setSettings({ ...settings, opponentRating: rating })}>{rating}</button>)}
      </div><p className="rating-note">Helps predict which mistakes to punish. The engine stays strong.</p></> : null}
    <details className="search-settings">
      <summary>Advanced settings</summary>
      <p className="muted">Changes apply on the next engine turn.</p>
      <label><span>Search depth</span><strong>{settings.rootDepth}</strong>
        <input aria-label="Search depth" disabled={disabled} max={14} min={6} onChange={(event) => {
          const depth = Number(event.target.value); setSettings({ ...settings, rootDepth: depth });
        }} type="range" value={settings.rootDepth} /></label>
      <label><span>Outcome search depth</span><strong>{settings.trapDepth}</strong>
        <input aria-label="Outcome search depth" disabled={disabled} max={14} min={6} type="range" value={settings.trapDepth}
          onChange={(event) => setSettings({ ...settings, trapDepth: Number(event.target.value) })} /></label>
      <label><span>Opponent turns to model</span>
        <select aria-label="Opponent turns to model" disabled={disabled} value={settings.opponentPlies ?? 1}
          onChange={(event) => setSettings({ ...settings, opponentPlies: Number(event.target.value) as 1 | 2 })}>
          <option value={1}>One turn · faster</option><option value={2}>Two turns · deeper traps</option>
        </select></label>
      {(settings.opponentPlies ?? 1) === 2 ? <>
        <label><span>Follow-up paths</span><strong>{settings.continuationBranches ?? 3}</strong>
          <input aria-label="Follow-up paths" disabled={disabled} type="range" min={1} max={8} value={settings.continuationBranches ?? 3}
            onChange={(event) => setSettings({ ...settings, continuationBranches: Number(event.target.value) })} /></label>
        <label><span>Replies on a follow-up</span><strong>{settings.continuationReplies ?? 4}</strong>
          <input aria-label="Replies on a follow-up" disabled={disabled} type="range" min={2} max={10} value={settings.continuationReplies ?? 4}
            onChange={(event) => setSettings({ ...settings, continuationReplies: Number(event.target.value) })} /></label>
      </> : null}
      <label><span>Practical weight</span><strong>{formatPercent(settings.aggression)}</strong>
        <input disabled={disabled} aria-label="Practical weight" max={1} min={0} step={0.05} type="range" value={settings.aggression}
          onChange={(event) => setSettings({ ...settings, aggression: Number(event.target.value) })} /></label>
      <label><span>Custom opponent rating</span><strong>{settings.opponentRating}</strong>
        <input aria-label="Opponent rating" disabled={disabled} max={3000} min={400} step={100} type="range" value={settings.opponentRating}
          onChange={(event) => setSettings({ ...settings, opponentRating: Number(event.target.value) })} /></label>
      <label><span>Risk against best defense</span><strong>{(settings.maxRiskCp / 100).toFixed(2)} pawns</strong>
        <input aria-label="Maximum risk" disabled={disabled} max={300} min={0} step={25} type="range" value={settings.maxRiskCp}
          onChange={(event) => setSettings({ ...settings, maxRiskCp: Number(event.target.value) })} /></label>
      <label><span>Candidate moves</span><strong>{settings.candidateCount}</strong>
        <input aria-label="Candidate moves" disabled={disabled} type="range" min={4} max={24} value={settings.candidateCount}
          onChange={(event) => setSettings({ ...settings, candidateCount: Number(event.target.value) })} /></label>
      <label><span>Replies per candidate</span><strong>{settings.replyCount}</strong>
        <input aria-label="Replies per candidate" disabled={disabled} type="range" min={3} max={20} value={settings.replyCount}
          onChange={(event) => setSettings({ ...settings, replyCount: Number(event.target.value) })} /></label>
      <label><span>Reply probability coverage</span><strong>{formatPercent(settings.replyCoverage)}</strong>
        <input aria-label="Reply probability coverage" disabled={disabled} type="range" min={0.7} max={1} step={0.01} value={settings.replyCoverage}
          onChange={(event) => setSettings({ ...settings, replyCoverage: Number(event.target.value) })} /></label>
      <label><span>Engine rating seen by Maia</span><strong>{settings.engineRating}</strong>
        <input aria-label="Engine rating" disabled={disabled} type="range" min={400} max={3000} step={100} value={settings.engineRating}
          onChange={(event) => setSettings({ ...settings, engineRating: Number(event.target.value) })} /></label>
    </details>
  </div>;
}

function DecisionPanel({ decision, trappyEnabled, fen }: { decision: MoveDecision | null; trappyEnabled: boolean; fen: string }) {
  if (!decision) return <section className="decision empty-state"><h2>Engine analysis</h2>
    <p>{trappyEnabled ? 'Reply probabilities and outcomes appear after the engine moves.' : 'Stockfish analysis appears after the engine moves.'}</p></section>;
  const trap = decision.selected.trap;
  return <section className="decision">
    <div className="section-title"><h2>Engine analysis</h2><span>{engineBadge(decision, trappyEnabled)}</span></div>
    <div className="decision-main">
      <div><small>played</small><strong>{decision.san}</strong></div>
      <div><small>expected score</small><strong>{formatPercent(decision.selected.expectedScore)}</strong></div>
      <div><small>best defense</small><strong>{formatCp(decision.selected.rootScoreCp)}</strong></div>
    </div>
    <p className="decision-explanation">Risk vs Stockfish’s best move: <strong>{(decision.selected.riskCp / 100).toFixed(2)} pawns</strong>.
      {decision.policySource === 'maia' ? <> Maia reply coverage: <strong>{formatPercent(decision.selected.policyCoverage)}</strong>.</> : null}</p>
    <p className="muted score-note">Expected score is a model estimate from the engine’s perspective, not a measured win rate.</p>
    {decision.policySource === 'maia' && decision.selected.mistakeProbability !== undefined ? <p className="decision-explanation">
      Modeled chance of a mistake worth at least a pawn across the searched replies: <strong>{formatPercent(decision.selected.mistakeProbability)}</strong>.
    </p> : null}
    {decision.warning ? <p className="import-warning" role="status">{decision.warning}</p> : null}
    {trap ? <div className="trap-box">{trap.nextReply && trap.setupSan ? <>
      <p>Tempting line: <strong>{trap.replySan} → {trap.setupSan} → {trap.nextReply.replySan}</strong>.</p>
      <p className="punishment-line">Maia estimates {formatPercent(trap.probability)} for {trap.replySan}, then {formatPercent(trap.nextReply.probability)} for {trap.nextReply.replySan} after {trap.setupSan}.
        {trap.nextReply.scoreCp > 90_000 ? ' That follow-up allows a forced mate.' : <> If that follow-up is played, Stockfish scores the outcome at <strong>{formatCp(trap.nextReply.scoreCp)}</strong>.</>}</p>
      {trap.punishment.length ? <p className="punishment-line">Stockfish continuation: {continuationSan(fen, trap.reply, trap.punishment)}</p> : null}
    </> : <><p>Targeted mistake: <strong>{trap.replySan}</strong> ({formatPercent(trap.probability)} Maia probability).
      {trap.scoreCp > 90_000 ? ' It leads to a forced mate.' : <> It improves the engine’s position by <strong>{(trap.profitCp / 100).toFixed(2)} pawns</strong>.</>}</p>
      {trap.punishment.length ? <p className="punishment-line">Stockfish continuation: {continuationSan(fen, trap.reply, trap.punishment)}</p> : null}</>}
    </div>
      : <p className="muted">{decision.policySource === 'maia' ? 'Selected for practical outcomes within the risk limit.' : 'Strongest Stockfish move selected.'}</p>}
    {decision.policySource === 'maia' && decision.selected.replies.length ? <div className="reply-list">
      <div className="reply-list-heading"><span>Predicted reply</span><span>Maia</span><span>Outcome</span></div>
      {decision.selected.replies.slice(0, 5).map((reply) => <div key={reply.move}><span>{reply.san}</span><span>{formatPercent(reply.probability)}</span><span>{formatCp(reply.scoreCp)}</span></div>)}
    </div> : null}
    <details className="candidate-details"><summary>Other candidates</summary><div className="candidate-list">
      {decision.candidates.slice(0, 6).map((candidate) => <div className={candidate.trap ? 'candidate has-trap' : 'candidate'} key={candidate.move}>
        <span>{candidate.san}</span><span>{formatCp(candidate.rootScoreCp)} · {formatPercent(candidate.expectedScore)} expected</span></div>)}
    </div></details>
  </section>;
}

function engineBadge(decision: MoveDecision, trappyEnabled: boolean): string {
  if (!trappyEnabled) return 'Stockfish';
  if (decision.policySource !== 'maia') return decision.warning ? 'Stockfish fallback' : 'Stockfish';
  return decision.selected.trap ? 'Maia trap' : 'Maia practical';
}
function CommittedMoveReview({ review }: { review: ReviewedPlan }) {
  const reply = review.decision.selected.replies.find((entry) => entry.move === review.actualReply);
  return <div className="committed-review">
    <p>You played <strong>{review.actualReplySan}</strong> after <strong>{review.decision.san}</strong>.</p>
    {reply ? <>
      <p>Maia estimated <strong>{formatPercent(reply.probability)}</strong> for your committed reply.</p>
      {reply.scoreCp > 90_000 ? <p>Your reply allowed a forced mate.</p> : <p>Stockfish evaluation after your reply: <strong>{formatCp(reply.scoreCp)}</strong>, from the engine’s perspective.</p>}
      {Math.abs(reply.scoreCp) <= 90_000 ? <p>Cost against best defense: <strong>{(reply.lossCp / 100).toFixed(2)} pawns</strong>.</p> : null}
    </> : null}
  </div>;
}
function MoveList({ moves }: { moves: Move[] }) {
  const rows = new Map<number, { white?: Move; black?: Move }>();
  for (const move of moves) {
    const number = Number(move.before.split(' ')[5]);
    const row = rows.get(number) ?? {};
    if (move.color === 'w') row.white = move; else row.black = move;
    rows.set(number, row);
  }
  const moveScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (moveScroll.current) moveScroll.current.scrollTop = moveScroll.current.scrollHeight; }, [moves.length]);
  return <section className="moves"><h2>Moves</h2><div className="move-scroll" ref={moveScroll}>
    {rows.size ? [...rows].map(([number, { white, black }]) => <div className="move-row" key={number}><span>{number}.</span><span>{white?.san ?? ''}</span><span>{black?.san ?? ''}</span></div>)
      : <p className="muted">No moves yet.</p>}
  </div></section>;
}
function boardArrows(lastMove: string | null, trapReply?: string) {
  const arrows = [];
  const engineMove = lastMove ? squarePairFromUci(lastMove) : null;
  const trapMove = trapReply ? squarePairFromUci(trapReply) : null;
  if (engineMove) arrows.push({ startSquare: engineMove[0], endSquare: engineMove[1], color: ENGINE_ARROW });
  if (trapMove) arrows.push({ startSquare: trapMove[0], endSquare: trapMove[1], color: TRAP_ARROW });
  return arrows;
}
function squareStyles(lastMove: string | null, trapReply?: string): Record<string, React.CSSProperties> {
  const styles: Record<string, React.CSSProperties> = {};
  const mark = (move: string | null | undefined, color: string) => {
    const pair = move ? squarePairFromUci(move) : null;
    if (!pair) return;
    styles[pair[0]] = { boxShadow: `inset 0 0 0 999px ${color}` };
    styles[pair[1]] = { boxShadow: `inset 0 0 0 999px ${color}` };
  };
  mark(lastMove, 'rgba(46, 91, 170, 0.22)');
  mark(trapReply, 'rgba(224, 124, 42, 0.24)');
  return styles;
}
function statusText(game: Chess, playerColor: Color, thinking: boolean): string {
  if (game.isCheckmate()) return game.turn() === playerColor ? 'Checkmate. The engine wins.' : 'Checkmate. You win.';
  if (game.isDraw()) return 'Drawn game.';
  if (game.isGameOver()) return 'Game over.';
  if (thinking) return 'Engine is searching.';
  if (game.turn() === playerColor) return game.isCheck() ? 'Your move. You are in check.' : 'Your move.';
  return 'Engine to move.';
}
function formatCp(cp: number): string {
  if (Math.abs(cp) > 90_000) return cp > 0 ? 'mate+' : 'mate-';
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
function formatPercent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function pieceName(piece: string): string { return ({ P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' } as Record<string, string>)[piece] ?? 'piece'; }
function continuationSan(fen: string, reply: string, continuation: string[]): string {
  try {
    const board = new Chess(fen);
    if (!playUci(board, reply)) return continuation.join(' ');
    const moves = [];
    for (const uci of continuation.slice(0, 8)) { const move = playUci(board, uci); if (!move) break; moves.push(move.san); }
    return moves.length ? moves.join(' ') : continuation.join(' ');
  } catch { return continuation.join(' '); }
}
