import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Color, type Move, type Square } from 'chess.js';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import { BookmarkPlus, BrainCircuit, Check, FlipVertical2, RotateCcw, Undo2 } from 'lucide-react';
import { UciClient } from '../engine/uci';
import { MaiaClient } from '../engine/maia';
import { PositionImport } from './PositionImport';
import { FishRival, type FishState } from './FishRival';
import { PlaySettings } from './PlaySettings';
import { OpeningBrowser } from './OpeningBrowser';
import { GameReview } from './GameReview';
import { getOpening, matchingBookMoves, compatibleOpeningIds, loadFavouriteIds, type Opening } from '../openings/library';
import { initialPlaySettings, identifySearchProfile, applySearchProfile } from '../play/searchProfiles';
import { publicActivity, type PlayActivity } from '../play/activity';
import { loadOpeningDefault, saveOpeningDefault } from '../play/openingDefault';
import { writeDecisionTrace, recordTraceReply, pruneDecisionTraces } from '../history/decisionTraces';
import { validatePosition } from '../import/position';
import { createHistoryId, type SavedPosition, type GameOpening, type GameResult } from '../history/positionHistory';
import { rememberPracticeGame, restorePracticeGame } from '../history/workspaceHistory';
import {
  TrappyEngine, moveToUci, opposite, playUci, squarePairFromUci,
  type TrappySettings,
} from '../engine/trappy';

type Promotion = { from: string; to: string };

export function PlayWorkspace({ initialFen, initialPlayer = 'w', active = true, savedPosition }: { initialFen?: string; initialPlayer?: Color; active?: boolean; savedPosition?: SavedPosition }) {
  const [initialGame] = useState(() => restorePracticeGame(initialFen, savedPosition));
  const gameRef = useRef(initialGame);
  const historyId = useRef(savedPosition?.id ?? createHistoryId());
  const historyCreatedAt = useRef(savedPosition?.createdAt ?? Date.now());
  const historyStarted = useRef(Boolean(savedPosition || initialFen));
  const [historyVersion, setHistoryVersion] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const searchIdRef = useRef(0);
  const uci = useMemo(() => new UciClient(), []);
  const maia = useMemo(() => new MaiaClient(), []);
  const trappyEngine = useMemo(() => new TrappyEngine(uci, maia), [uci, maia]);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [playerColor, setPlayerColor] = useState<Color>(savedPosition?.playerColor ?? initialPlayer);
  const [orientation, setOrientation] = useState<Color>(savedPosition?.orientation ?? initialPlayer);
  const [newGameColor, setNewGameColor] = useState<Color>(savedPosition?.playerColor ?? initialPlayer);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [trappyEnabled, setTrappyEnabled] = useState(savedPosition?.styleEnabled ?? true);
  const [settings, setSettings] = useState<TrappySettings>(() => initialPlaySettings(savedPosition));
  const [opening, setOpening] = useState<GameOpening | undefined>(savedPosition?.opening);
  const [result, setResult] = useState<GameResult | undefined>(savedPosition?.result ?? naturalResult(initialGame));
  const [reviewFen, setReviewFen] = useState<string>();
  const [openingBrowserOpen, setOpeningBrowserOpen] = useState(false);
  const [selectedOpening, setSelectedOpening] = useState<Opening | undefined>(() => savedPosition?.opening ? getOpening(savedPosition.opening.id) : undefined);
  const [openingChoice, setOpeningChoice] = useState<'free' | 'selected' | 'favourites'>(() => loadFavouriteIds().length ? loadOpeningDefault() : 'free');
  const [startMode, setStartMode] = useState<'position' | 'line'>('line');
  const [favouriteIds, setFavouriteIds] = useState<string[]>(loadFavouriteIds);
  const [showGuidance, setShowGuidance] = useState(false);
  const [activity, setActivity] = useState<PlayActivity | null>(null);
  const [searchStartedAt, setSearchStartedAt] = useState(0);
  const [activityBudget, setActivityBudget] = useState('');
  const [remark, setRemark] = useState(savedPosition?.result ? 'The score sheet is open.' : 'Your move. I have a fairly respectable poker face.');
  const [eventState, setEventState] = useState<FishState>('idle');
  const [lastMove, setLastMove] = useState<string | null>(() => {
    const last = gameRef.current.history({ verbose: true }).at(-1); return last ? moveToUci(last) : null;
  });
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [keyboardSquare, setKeyboardSquare] = useState<string>(initialPlayer === 'w' ? 'e2' : 'e7');
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(savedPosition ? 'Saved game restored with its moves and playing controls.' : null);
  const [moveHistory, setMoveHistory] = useState<Move[]>(() => gameRef.current.history({ verbose: true }));
  const promotionDialog = useRef<HTMLElement>(null);
  const engineColor = opposite(playerColor);
  const game = gameRef.current;

  const saveGame = useCallback(() => {
    historyStarted.current = true;
    if (result) gameRef.current.setHeader('Result', result.reason === 'unfinished' ? '*' : result.winner === 'w' ? '1-0' : result.winner === 'b' ? '0-1' : '1/2-1/2');
    rememberPracticeGame(gameRef.current, { id: historyId.current, createdAt: historyCreatedAt.current,
      orientation, playerColor, settings, styleEnabled: trappyEnabled, opening, result,
      searchProfile: identifySearchProfile(settings).toLowerCase() as 'quick' | 'deep' | 'custom' });
  }, [orientation, playerColor, settings, trappyEnabled, opening, result]);
  useEffect(() => {
    if (active && (historyStarted.current || gameRef.current.history().length > 0)) saveGame();
  }, [active, fen, historyVersion, saveGame]);

  const syncGameState = useCallback(() => {
    setFen(gameRef.current.fen());
    setMoveHistory(gameRef.current.history({ verbose: true }));
    const ending = naturalResult(gameRef.current);
    if (ending) setResult(ending);
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
    const next = new Chess();
    const currentFavourites = loadFavouriteIds();
    setFavouriteIds(currentFavourites);
    let gameOpening: GameOpening | undefined;
    if (openingChoice === 'selected' && selectedOpening) {
      if (startMode === 'position') next.loadPgn(selectedOpening.pgn);
      gameOpening = { id: selectedOpening.id, name: selectedOpening.name, eco: selectedOpening.eco,
        startPly: startMode === 'position' ? next.history().length : 0, bookIds: [selectedOpening.id] };
    } else if (openingChoice === 'favourites' && currentFavourites.length) {
      gameOpening = { id: 'favourites', name: 'Favourite openings', startPly: 0, bookIds: currentFavourites };
    }
    gameRef.current = next;
    historyId.current = createHistoryId(); historyCreatedAt.current = Date.now(); historyStarted.current = false;
    setHistoryVersion((version) => version + 1);
    setPlayerColor(color);
    setOrientation(color);
    setThinking(false);
    setOpening(gameOpening); setResult(undefined); setReviewFen(undefined); setActivity(null); setActivityBudget(''); setShowGuidance(false);
    setRemark('A fresh score sheet. Let’s make it worth keeping.'); setEventState('idle');
    setLastMove(null);
    setError(null);
    setNotice(null);
    setNewGameOpen(false);
    clearInteraction();
    syncGameState();
  }, [playerColor, trappyEngine, clearInteraction, syncGameState, openingChoice, selectedOpening, startMode, favouriteIds]);

  const loadPosition = useCallback((input: string, color: Color) => {
    const position = validatePosition(input);
    if (!position.fen) { setError(position.error ?? 'Invalid position.'); return; }
    searchIdRef.current += 1;
    trappyEngine.cancel();
    gameRef.current = new Chess(position.fen);
    historyId.current = createHistoryId(); historyCreatedAt.current = Date.now(); historyStarted.current = true;
    setHistoryVersion((version) => version + 1);
    setPlayerColor(color);
    setOrientation(color);
    setNewGameColor(color);
    setThinking(false);
    setOpening(undefined); setResult(naturalResult(gameRef.current)); setReviewFen(undefined); setActivity(null); setActivityBudget(''); setShowGuidance(false);
    setRemark('A new position. Same fish.'); setEventState('idle');
    setLastMove(null);
    setError(null);
    setNotice('Position loaded.');
    clearInteraction();
    syncGameState();
  }, [trappyEngine, clearInteraction, syncGameState]);

  const undoPair = useCallback(() => {
    if (thinking || result || gameRef.current.history().length <= (opening?.startPly ?? 0)) return;
    searchIdRef.current += 1;
    setError(null);
    gameRef.current.undo();
    if (gameRef.current.turn() !== playerColor && gameRef.current.history().length > (opening?.startPly ?? 0)) gameRef.current.undo();
    void pruneDecisionTraces(historyId.current, gameRef.current.history().length);
    setActivity(null); setRemark('Rewound. We can pretend that didn’t happen.'); setEventState('idle');
    if (opening?.bookIds) setOpening({ ...opening, bookExitReason: undefined });
    setLastMove(null);
    clearInteraction();
    syncGameState();
  }, [playerColor, syncGameState, thinking, clearInteraction, opening, result]);

  const makeEngineMove = useCallback(async () => {
    const activeGame = gameRef.current;
    if (!active || thinking || result || activeGame.isGameOver() || activeGame.turn() !== engineColor) return;
    const searchId = ++searchIdRef.current;
    const fenAtStart = activeGame.fen();
    setThinking(true);
    setSearchStartedAt(performance.now()); setActivity(null); setRemark('Give me a moment with this one.');
    setActivityBudget(`${identifySearchProfile(settings)} · depth ${settings.rootDepth}/${settings.trapDepth}`);
    setError(null);
    try {
      const history = activeGame.history({ verbose: true }).map(moveToUci);
      const bookMoves = opening?.bookIds && !opening.bookExitReason ? matchingBookMoves(history, opening.bookIds) : undefined;
      const decision = await trappyEngine.chooseMove(fenAtStart, settings, trappyEnabled, {
        bookMoves, onProgress: (progress) => {
          if (activeRef.current && searchId === searchIdRef.current) setActivity(publicActivity(progress));
        },
      });
      if (!activeRef.current || searchId !== searchIdRef.current || gameRef.current.fen() !== fenAtStart) return;
      const move = playUci(gameRef.current, decision.move);
      if (!move) throw new Error(`Engine produced an illegal move: ${decision.move}`);
      if (decision.warning) setNotice('The human reply model was unavailable for that turn. Stockfish supplied the decision; details are saved for review.');
      void writeDecisionTrace({ gameId: historyId.current, ply: gameRef.current.history().length, openingExitReason: opening?.bookExitReason,
        rootFen: fenAtStart, settings: { ...settings }, styleEnabled: trappyEnabled, decision });
      if (decision.diagnostics) setActivity(publicActivity({ stage: 'complete', completed: 1, total: 1, message: '', diagnostics: decision.diagnostics }));
      if (opening && bookMoves !== undefined && decision.provenance?.source !== 'opening-book') {
        setOpening({ ...opening, bookExitReason: decision.provenance?.bookExitReason ?? 'line-complete' });
      }
      reactToMove(move, gameRef.current, setRemark, setEventState);
      setLastMove(moveToUci(move));
      syncGameState();
    } catch (err) {
      if (searchId === searchIdRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (searchId === searchIdRef.current) setThinking(false);
    }
  }, [active, engineColor, settings, syncGameState, thinking, trappyEnabled, trappyEngine, result, opening]);

  useEffect(() => {
    if (active && !error && !result && gameRef.current.turn() === engineColor && !gameRef.current.isGameOver()) void makeEngineMove();
  }, [active, engineColor, error, fen, makeEngineMove, result]);
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
    if (thinking || result || gameRef.current.isGameOver() || gameRef.current.turn() !== playerColor) return false;
    try {
      const move = gameRef.current.move({ from, to, promotion: promoteTo });
      const returnFocusToBoard = promotionDialog.current !== null;
      const ply = gameRef.current.history().length;
      const leftBook = opening?.bookIds && !opening.bookExitReason && !compatibleOpeningIds(gameRef.current.history({ verbose: true }).map(moveToUci), opening.bookIds).length;
      void recordTraceReply(historyId.current, ply - 1, { move: moveToUci(move), san: move.san, ply, ...(leftBook ? { bookExitReason: 'deviation' as const } : {}) });
      if (leftBook && opening) {
        setOpening({ ...opening, bookExitReason: 'deviation' });
      }
      reactToMove(move, gameRef.current, setRemark, setEventState);
      setLastMove(moveToUci(move));
      setError(null);
      setNotice(null);
      clearInteraction();
      setKeyboardSquare(to);
      if (returnFocusToBoard) requestAnimationFrame(() => document.getElementById(`trappy-board-keyboard-${to}`)?.focus());
      syncGameState();
      return true;
    } catch { return false; }
  }, [playerColor, syncGameState, thinking, result, opening, clearInteraction]);

  const attemptPlayerMove = useCallback((from: string, to: string): boolean => {
    if (thinking || result || promotion || gameRef.current.turn() !== playerColor || gameRef.current.isGameOver()) return false;
    const legal = gameRef.current.moves({ square: from as Square, verbose: true }).filter((move) => move.to === to);
    if (!legal.length) return false;
    if (legal.some((move) => move.isPromotion())) {
      setPromotion({ from, to });
      setSelectedSquare(from as Square);
      return false;
    }
    return commitPlayerMove(from, to);
  }, [thinking, result, promotion, playerColor, commitPlayerMove]);

  const handleDrop = useCallback<NonNullable<ChessboardOptions['onPieceDrop']>>(
    ({ sourceSquare, targetSquare }) => Boolean(targetSquare && attemptPlayerMove(sourceSquare, targetSquare)),
    [attemptPlayerMove],
  );
  const handleSquareClick = useCallback<NonNullable<ChessboardOptions['onSquareClick']>>(({ square }) => {
    if (thinking || result || promotion || gameRef.current.isGameOver() || gameRef.current.turn() !== playerColor) return;
    if (selectedSquare && selectedSquare !== square && attemptPlayerMove(selectedSquare, square)) return;
    const piece = gameRef.current.get(square as Square);
    setSelectedSquare(piece?.color === playerColor && selectedSquare !== square ? square as Square : null);
  }, [thinking, result, promotion, playerColor, selectedSquare, attemptPlayerMove]);

  const styles = useMemo(() => {
    const result = squareStyles(reviewFen ? null : lastMove);
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
  }, [lastMove, reviewFen, selectedSquare, fen]);

  const boardOptions = useMemo<ChessboardOptions>(() => ({
    id: 'trappy-board', position: result && reviewFen ? reviewFen : fen, boardOrientation: orientation === 'w' ? 'white' : 'black',
    animationDurationInMs: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180, showNotation: true, allowDrawingArrows: !promotion,
    allowDragging: !thinking && !result && !promotion && !game.isGameOver() && game.turn() === playerColor,
    canDragPiece: ({ piece }) => game.turn() === playerColor && piece.pieceType[0] === playerColor,
    onPieceDrop: handleDrop, onSquareClick: handleSquareClick,
    boardStyle: { borderRadius: 6, boxShadow: '0 4px 16px rgba(23, 35, 56, 0.10)' },
    lightSquareStyle: { backgroundColor: '#e8edf2' }, darkSquareStyle: { backgroundColor: '#8297ad' },
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
    arrows: [],
  }), [fen, reviewFen, orientation, thinking, result, promotion, game, playerColor, handleDrop, handleSquareClick, styles, lastMove, keyboardSquare, selectedSquare]);

  const endGame = (reason: 'resigned' | 'unfinished') => {
    searchIdRef.current++; trappyEngine.cancel(); setThinking(false); clearInteraction();
    setResult({ reason, winner: reason === 'resigned' ? engineColor : undefined });
    historyStarted.current = true; setHistoryVersion((value) => value + 1);
  };
  const rewindToBook = () => {
    if (!opening?.bookIds) return;
    searchIdRef.current++; trappyEngine.cancel(); setThinking(false);
    while (gameRef.current.history().length > (opening.startPly ?? 0)) {
      if (compatibleOpeningIds(gameRef.current.history({ verbose: true }).map(moveToUci), opening.bookIds).length) break;
      gameRef.current.undo();
    }
    void pruneDecisionTraces(historyId.current, gameRef.current.history().length);
    setOpening({ ...opening, bookExitReason: undefined }); setActivity(null); clearInteraction(); syncGameState();
  };
  const hintMoves = opening?.bookIds ? matchingBookMoves(moveHistory.map(moveToUci), opening.bookIds) : [];
  const fishState: FishState = result ? result.reason === 'draw' || !result.winner ? 'draw' : result.winner === engineColor ? 'victory' : 'defeat' : thinking ? 'search' : eventState;

  return (
    <main className="app-shell play-workspace">
      <section className="board-column" aria-label="Chess board">
        <header className="panel-header">
          <div><span className="eyebrow">{result ? 'THE SCORE SHEET' : 'AT THE BOARD'}</span><h1>{result ? 'Game review' : 'Play Trappyfish'}</h1>
            <p role="status" aria-live="polite">{result?.reason === 'resigned' ? 'You resigned. The engine wins.' : result?.reason === 'unfinished' ? 'Game ended unfinished.' : statusText(game, playerColor, thinking)}</p></div>
          <div className="status-light" data-active={thinking || undefined} aria-label={thinking ? 'Engine thinking' : 'Ready'}>
            {thinking ? <BrainCircuit size={20} /> : <Check size={20} />}
          </div>
        </header>
        <div className="board-meta"><span>You play {playerColor === 'w' ? 'White' : 'Black'}</span>
          <span>{trappyEnabled ? `Custom style · ${settings.opponentRating} reply model` : 'Stockfish'}</span></div>
        <div className="play-opening-identity"><span>{opening?.eco ?? '♟'}</span><div><strong>{opening?.name ?? 'Free play'}</strong>
          <small>{opening ? opening.bookExitReason ? 'Continuing with normal search' : 'Following compatible book moves while sound' : 'Your own opening, your own way'}</small></div></div>
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
          <button type="button" aria-expanded={newGameOpen} onClick={() => {
            const currentFavourites = loadFavouriteIds(); setFavouriteIds(currentFavourites);
            if (openingChoice === 'favourites' && !currentFavourites.length) setOpeningChoice('free');
            setNewGameOpen(!newGameOpen);
          }}><RotateCcw size={16} /> New game</button>
          <button type="button" disabled={moveHistory.length <= (opening?.startPly ?? 0) || thinking || Boolean(result)} onClick={undoPair}><Undo2 size={16} /> Undo</button>
          <button type="button" onClick={() => setOrientation(opposite(orientation))}><FlipVertical2 size={16} /> Flip board</button>
          <button type="button" aria-label="Save practice game" onClick={() => { saveGame(); setNotice('Game saved in Recent positions.'); }}><BookmarkPlus size={16} /> Save game</button>
        </div>
        {newGameOpen ? <section className="new-game-panel" aria-label="Start a new game">
          <label>Play as <select aria-label="New game colour" value={newGameColor} onChange={(event) => setNewGameColor(event.target.value as Color)}>
            <option value="w">White</option><option value="b">Black</option></select></label>
          <label>Opening <select aria-label="New game opening" value={openingChoice} onChange={(event) => setOpeningChoice(event.target.value as typeof openingChoice)}>
            <option value="free">Free play</option><option value="selected" disabled={!selectedOpening}>Selected opening{selectedOpening ? ` · ${selectedOpening.name}` : ''}</option>
            <option value="favourites" disabled={!favouriteIds.length}>Favourites · {favouriteIds.length} lines</option></select></label>
          {openingChoice === 'selected' ? <label>Start <select aria-label="Opening start mode" value={startMode} onChange={(event) => setStartMode(event.target.value as typeof startMode)}>
            <option value="line">Play into the opening</option><option value="position">At the selected position</option></select></label> : null}
          <div className="new-game-budget" role="group" aria-label="New game search budget"><span>Search: {identifySearchProfile(settings)}</span>{(['Quick', 'Deep'] as const).map((profile) => <button key={profile} type="button" aria-pressed={identifySearchProfile(settings) === profile} onClick={() => setSettings(applySearchProfile(settings, profile))}>{profile}</button>)}</div>
          <p>Depth {settings.rootDepth}/{settings.trapDepth} · {settings.candidateCount} candidates · {settings.replyCount} replies · {settings.opponentPlies ?? 1} opponent turn{settings.opponentPlies === 2 ? `s · ${settings.continuationBranches ?? 3} refined branches · ${settings.continuationReplies ?? 4} follow-up replies · ${settings.continuationCandidates ?? 1} engine continuations` : ''} · {Math.round(settings.replyCoverage * 100)}% coverage.</p>
          <button type="button" onClick={() => { setOpeningBrowserOpen(true); setFavouriteIds(loadFavouriteIds()); }}>Browse openings</button>
          <button className="primary-button" type="button" disabled={openingChoice === 'selected' && !selectedOpening} onClick={() => resetGame(newGameColor)}>Start new game</button>
          <p>{openingChoice === 'selected' && startMode === 'position' ? 'The opening moves are retained in the score sheet.' : 'Starts from the initial position. Your moves remain your choice.'}</p>
        </section> : null}
        <p className="board-hint">Tap a piece, then its destination. You can also drag.</p>
        {result && reviewFen ? <button type="button" onClick={() => setReviewFen(undefined)}>Return to final position</button> : null}
        {!result ? <div className="end-game-actions"><button type="button" onClick={() => endGame('resigned')}>Resign & review</button><button type="button" onClick={() => endGame('unfinished')}>End unfinished game & review</button></div> : null}
      </section>

      <section className="side-panel" aria-label="Game controls">
        <FishRival state={fishState} remark={result ? result.reason === 'unfinished' ? 'An unfinished game still has a story.' : result.reason === 'draw' ? 'A draw. We’ll call that mutual respect.' : result.winner === playerColor ? 'Well played. I shall be examining that.' : 'Good game. The score sheet has the details.' : remark}
          activity={activity} startedAt={searchStartedAt} searchSummary={activityBudget || `${identifySearchProfile(settings)} · depth ${settings.rootDepth}/${settings.trapDepth}`} />
        <div className="play-settings-summary" aria-label="Active opponent settings"><span>{trappyEnabled ? 'Custom style' : 'Stockfish'} · {identifySearchProfile(settings)}</span><span>Risk ≤ {(settings.maxRiskCp / 100).toFixed(2)} pawns · human model {settings.opponentRating}</span></div>
        <PlaySettings settings={settings} onChange={setSettings} trappyEnabled={trappyEnabled} onModeChange={setTrappyEnabled} />
        {error ? <div className="error-strip" role="alert">{error}
          {game.turn() === engineColor && !result ? <button type="button" onClick={() => setError(null)}>Retry search</button> : null}</div> : null}
        {notice ? <p className="import-notice" role="status">{notice}</p> : null}
        {opening && !result ? <section className="opening-guidance"><button type="button" aria-expanded={showGuidance} onClick={() => setShowGuidance(!showGuidance)}>Opening guidance</button>
          {showGuidance ? <div>{hintMoves.length ? <><p>Next catalogue move{hintMoves.length > 1 ? 's' : ''}: <strong>{hintMoves.map((uci) => { try { const preview = new Chess(fen); return playUci(preview, uci)?.san ?? uci; } catch { return uci; } }).join(', ')}</strong>.</p><p>Continues the selected opening line. This is book guidance, not an evaluation of your move.</p></>
            : <><p>{opening.bookExitReason === 'deviation' ? 'You have left the selected lines. Continue freely, or return to the last matching position.' : 'No next move is available in the selected lines. Normal search continues.'}</p>
              {opening.bookExitReason === 'deviation' ? <button type="button" onClick={rewindToBook}>Rewind to opening</button> : null}</>}
          </div> : null}</section> : null}
        <MoveList moves={moveHistory} />
        {!result ? <p className="postgame-promise">The plans, alternatives and turning points open after the game.</p> : <p className="postgame-promise">The full score sheet is below the board.</p>}
        <button className="browse-openings-button" type="button" aria-expanded={openingBrowserOpen} onClick={() => setOpeningBrowserOpen(!openingBrowserOpen)}>Explore openings</button>
        <PositionImport active={active} currentFen={fen} playerColor={playerColor} onLoad={loadPosition} />
      </section>
      {result ? <div className="play-review-surface"><GameReview gameId={historyId.current} moves={moveHistory} result={result} onSelectPosition={setReviewFen} /></div> : null}
      {openingBrowserOpen ? <section className="play-library" aria-label="Opening library"><button className="subtle-button" type="button" onClick={() => setOpeningBrowserOpen(false)}>Close opening library</button>
        <OpeningBrowser selectedId={selectedOpening?.id} initialOpen onSelect={(selected, mode) => {
          setSelectedOpening(selected); setOpeningChoice('selected'); setStartMode(mode); setNewGameOpen(true); setOpeningBrowserOpen(false);
          requestAnimationFrame(() => document.querySelector('.new-game-panel')?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
        }} onFreePlay={() => { saveOpeningDefault('free'); setOpeningChoice('free'); setNewGameOpen(true); setOpeningBrowserOpen(false); }} onFavourites={(ids) => {
          if (!saveOpeningDefault('favourites')) setNotice('The favourites default is kept for this tab because browser storage is unavailable.');
          setFavouriteIds(ids); setOpeningChoice('favourites'); setNewGameOpen(true); setOpeningBrowserOpen(false);
        }} />
      </section> : null}
    </main>
  );
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
function naturalResult(game: Chess): GameResult | undefined {
  if (game.isCheckmate()) return { reason: 'checkmate', winner: opposite(game.turn()) };
  if (game.isDraw() || game.isGameOver()) return { reason: 'draw' };
  return undefined;
}
function reactToMove(move: Move, board: Chess, say: (text: string) => void, show: (state: FishState) => void) {
  // Only committed, visible events may change the rival's expression or remarks.
  if (board.isCheck()) { say('Check. A fairly direct sort of conversation.'); show('check'); }
  else if (move.isPromotion()) { say('A promotion. New management has arrived.'); show('idle'); }
  else if (move.isCapture() || move.isEnPassant()) { say('A capture. The board is getting lighter.'); show('capture'); }
  else if (move.isKingsideCastle() || move.isQueensideCastle()) { say('The king has moved house.'); show('idle'); }
  else { say('Over to you.'); show('idle'); }
}
function pieceName(piece: string): string { return ({ P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' } as Record<string, string>)[piece] ?? 'piece'; }
