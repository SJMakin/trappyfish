import { useEffect, useMemo, useRef, useState } from 'react';
import { type Color } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Camera, FlipVertical2, Pencil, RotateCw, Upload } from 'lucide-react';
import { recognizeScreenshot } from '../import/fenshot';
import { placementForPreview, rotatePlacement, setPlacementSquare, validatePosition } from '../import/position';

type ScanSummary = { reliable: boolean; minConfidence: number; meanConfidence: number; orientation: 'white' | 'black' };

export function PositionImport({ currentFen, playerColor, onLoad, variant = 'play', initialOpen }: {
  currentFen: string;
  playerColor: Color;
  onLoad: (fen: string, player: Color) => void;
  variant?: 'analysis' | 'play';
  initialOpen?: boolean;
}) {
  const isAnalysis = variant === 'analysis';
  const [open, setOpen] = useState(initialOpen ?? isAnalysis);
  const [draftFen, setDraftFen] = useState(isAnalysis ? '' : currentFen);
  const [playAs, setPlayAs] = useState(playerColor);
  const [previewOrientation, setPreviewOrientation] = useState<Color>(playerColor);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [turnSource, setTurnSource] = useState<'check' | 'orientation' | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingPieces, setEditingPieces] = useState(false);
  const [paintPiece, setPaintPiece] = useState<string | null>('wP');
  const scanId = useRef(0);
  const scanInFlight = useRef(false);
  const importPanel = useRef<HTMLDetailsElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const validation = useMemo(() => validatePosition(draftFen), [draftFen]);
  const fields = draftFen.trim().split(/\s+/);
  const previewPosition = useMemo(() => placementForPreview(draftFen.trim().split(/\s+/)[0]), [draftFen]);

  useEffect(() => { setPlayAs(playerColor); }, [playerColor]);

  useEffect(() => {
    return () => { scanId.current += 1; };
  }, []);

  useEffect(() => {
    return () => { if (sourceImage) URL.revokeObjectURL(sourceImage); };
  }, [sourceImage]);

  const readImage = async (file: File) => {
    if (scanInFlight.current) return;
    scanInFlight.current = true;
    const id = ++scanId.current;
    setOpen(true);
    setScanning(true);
    setError(null);
    setNotice(null);
    setReviewed(false);
    try {
      const result = await recognizeScreenshot(file);
      if (id !== scanId.current) return;
      setDraftFen(result.fen);
      setScan(result);
      setPreviewOrientation(result.orientation === 'black' ? 'b' : 'w');
      setTurnSource(result.turnSource);
      setSourceImage(URL.createObjectURL(file));
      setEditingPieces(false);
      setNotice(isAnalysis ? 'Board detected. Review the pieces, whose turn it is, and castling; then analyze.' : 'Board detected. Check the pieces, side to move, and castling before loading.');
    } catch (failure) {
      if (id === scanId.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      scanInFlight.current = false;
      if (id === scanId.current) setScanning(false);
    }
  };

  useEffect(() => {
    if (!open && !isAnalysis) return;
    const handlePaste = (event: ClipboardEvent) => {
      if (importPanel.current?.closest('[hidden]')) return;
      const image = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile();
      if (!image) return;
      event.preventDefault();
      void readImage(image);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [open, isAnalysis]);

  const updateField = (index: number, value: string) => {
    const next = draftFen.trim().split(/\s+/);
    if (next.length !== 6) return;
    scanId.current += 1;
    setScanning(false);
    next[index] = value;
    if (index === 1) next[3] = '-';
    setDraftFen(next.join(' '));
    if (index === 0 || index === 1) setTurnSource(null);
    setNotice(null);
    setReviewed(false);
  };

  const remapPieceSquares = () => {
    if (fields.length !== 6 || !previewPosition) return;
    scanId.current += 1;
    setScanning(false);
    setDraftFen(`${rotatePlacement(fields[0])} ${fields[1]} - - ${fields[4]} ${fields[5]}`);
    setTurnSource(null);
    setNotice('Piece squares changed: a1 ↔ h8, c7 ↔ f2. Check every piece and the side to move before loading.');
    setReviewed(false);
  };

  const setCastling = (right: string, checked: boolean) => {
    const rights = new Set((fields[2] ?? '-').replace('-', '').split(''));
    if (checked) rights.add(right); else rights.delete(right);
    updateField(2, ['K', 'Q', 'k', 'q'].filter((entry) => rights.has(entry)).join('') || '-');
  };

  const load = () => {
    if (!validation.fen || scanning || (scan && !scan.reliable && !reviewed)) return;
    scanId.current += 1;
    onLoad(validation.fen, isAnalysis ? previewOrientation : playAs);
    setError(null);
    setNotice(null);
    setOpen(false);
    setEditingPieces(false);
  };

  const paintSquare = (square: string) => {
    if (!editingPieces || scanning || fields.length !== 6) return;
    const placement = setPlacementSquare(fields[0], square, paintPiece);
    if (!placement) return;
    updateField(0, placement);
  };

  return (
    <details ref={importPanel} className={`position-import${isAnalysis ? ' analysis-import' : ''}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><Camera size={isAnalysis ? 20 : 16} /> {isAnalysis ? 'Screenshot or position' : 'Set position from FEN or screenshot'}</summary>
      <div className="import-content">
        <div className="image-drop-zone" aria-label="Drop or paste a chessboard screenshot"
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
          onDrop={(event) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith('image/'));
            if (file) void readImage(file); else setError('Drop an image file containing a chessboard.');
          }}>
          <button type="button" className={isAnalysis ? 'primary-button' : ''} disabled={scanning} onClick={() => fileInput.current?.click()}>
            <Upload size={18} /> {scanning ? 'Reading screenshot…' : isAnalysis ? 'Upload screenshot' : 'Choose screenshot'}
          </button>
          <p>Or drop an image here / paste from your clipboard.</p>
          <small>{isAnalysis ? 'A clear, complete 2D board works best. Recognition runs locally.' : 'Read a clear, complete 2D board. Review the pieces before loading.'}</small>
          <input ref={fileInput} aria-label="Upload chessboard screenshot" type="file" accept="image/*" hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readImage(file);
              event.target.value = '';
            }} />
        </div>

        {error ? <p className="error-strip" role="alert">{error}</p> : null}
        {notice ? <p className="import-notice" role="status">{notice}</p> : null}
        {scan ? <p className={scan.reliable ? 'muted scan-confidence' : 'import-warning'}>
          {scan.reliable ? 'Confident read' : 'Uncertain read — use Correct pieces and review every square.'}
          {' '}Mean confidence {percent(scan.meanConfidence)}, weakest square {percent(scan.minConfidence)}.
          {' '}Detected {scan.orientation} at the bottom.
        </p> : null}

        {sourceImage ? <img className="source-screenshot" src={sourceImage} alt="Uploaded chessboard screenshot for comparison" /> : null}

        <label className="fen-label" htmlFor="import-fen">{isAnalysis ? 'Or paste a FEN position' : 'Full FEN'}</label>
        <textarea id="import-fen" rows={isAnalysis && !scan ? 2 : 3} spellCheck={false} value={draftFen} disabled={scanning}
          placeholder={isAnalysis ? 'Paste your position here, or upload a screenshot above.' : undefined}
          onChange={(event) => {
            scanId.current += 1;
            setScanning(false);
            setDraftFen(event.target.value);
            setTurnSource(null);
            setReviewed(false);
            setNotice(null);
          }} />
        <button type="button" className="subtle-button" disabled={scanning} onClick={() => {
          scanId.current += 1;
          setScanning(false);
          setDraftFen(currentFen);
          setPreviewOrientation(playerColor);
          setTurnSource(null);
          setScan(null);
          setSourceImage(null);
          setError(null);
          setNotice(null);
        }}>{isAnalysis ? 'Use board position' : 'Use current position'}</button>

        {fields.length === 6 ? <>
          <div className="import-select-row">
            <label>Side to move
              <select aria-label="Side to move" value={fields[1]} disabled={scanning} onChange={(event) => updateField(1, event.target.value)}>
                <option value="w">White</option><option value="b">Black</option>
              </select>
            </label>
            {!isAnalysis ? <label>You play
              <select aria-label="You play" value={playAs} disabled={scanning} onChange={(event) => setPlayAs(event.target.value as Color)}>
                <option value="w">White</option><option value="b">Black</option>
              </select>
            </label> : null}
          </div>
          {turnSource ? <p className={turnSource === 'orientation' ? 'import-warning' : 'import-notice'} role="status">
            {turnSource === 'check'
              ? `${fields[1] === 'w' ? 'White' : 'Black'} is in check, so ${fields[1] === 'w' ? 'White' : 'Black'} must move next.`
              : `Assuming ${fields[1] === 'w' ? 'White' : 'Black'} to move because ${scan?.orientation === 'white' ? 'White' : 'Black'} is at the bottom. Change Side to move if you captured the board during your opponent’s turn.`}
          </p> : null}
          <fieldset className="castling-controls">
            <legend>Castling rights</legend>
            {(['K', 'Q', 'k', 'q'] as const).map((right) => <label key={right}>
              <input type="checkbox" disabled={scanning} checked={(fields[2] ?? '').includes(right)} onChange={(event) => setCastling(right, event.target.checked)} />
              {{ K: 'White O-O', Q: 'White O-O-O', k: 'Black O-O', q: 'Black O-O-O' }[right]}
            </label>)}
          </fieldset>
          <p className="muted import-history-note">A screenshot cannot establish castling history or en passant. Both start unset; edit the FEN if known.</p>
        </> : null}

        {previewPosition ? <>
          <div className="import-preview-heading"><strong>Review board</strong>
            <button type="button" className="subtle-button" disabled={scanning} aria-pressed={editingPieces} onClick={() => setEditingPieces(!editingPieces)}><Pencil size={14} /> {editingPieces ? 'Finish corrections' : 'Correct pieces'}</button>
          </div>
          {editingPieces ? <div className="piece-correction-tools" aria-label="Piece correction tools">
            <p>Choose a piece, then tap a square to replace it. Choose Erase to remove one.</p>
            {(['w', 'b'] as const).map((color) => <div className="piece-palette" key={color} role="group" aria-label={`${color === 'w' ? 'White' : 'Black'} pieces`}>
              {(['K', 'Q', 'R', 'B', 'N', 'P'] as const).map((type) => <button type="button" key={type} className={paintPiece === `${color}${type}` ? 'is-active' : ''}
                aria-pressed={paintPiece === `${color}${type}`} aria-label={`Place ${color === 'w' ? 'White' : 'Black'} ${{ K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' }[type]}`}
                onClick={() => setPaintPiece(`${color}${type}`)}>{pieceGlyph(`${color}${type}`)}</button>)}
            </div>)}
            <button type="button" aria-pressed={paintPiece === null} onClick={() => setPaintPiece(null)}>Erase piece</button>
            {scan ? <details className="import-orientation-correction"><summary>Fix incorrect screenshot orientation</summary>
              <p>This changes every piece’s square (a1 ↔ h8), clears castling and en passant, and changes the position. Use this only if recognition assigned the board squares backwards. To look from the other side, use Flip board view.</p>
              <button type="button" disabled={scanning} onClick={remapPieceSquares}><RotateCw size={16} /> Remap piece squares (changes FEN)</button>
            </details> : null}
          </div> : null}
          <div className="import-preview" aria-label="Position preview" data-orientation={previewOrientation === 'w' ? 'white' : 'black'}>
            <Chessboard options={{ id: 'import-preview', position: previewPosition, boardOrientation: previewOrientation === 'w' ? 'white' : 'black', allowDragging: false, allowDrawingArrows: false,
              onSquareClick: ({ square }) => paintSquare(square),
              squareRenderer: ({ square, children }) => <div style={{ width: '100%', height: '100%' }} role={editingPieces ? 'button' : undefined}
                tabIndex={editingPieces ? 0 : -1} aria-label={editingPieces ? `Correct ${square}` : undefined}
                onKeyDown={(event) => { if (editingPieces && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); paintSquare(square); } }}>{children}</div>,
              animationDurationInMs: 0, lightSquareStyle: { backgroundColor: '#e9dfcf' }, darkSquareStyle: { backgroundColor: '#7a8f77' } }} />
          </div>
          <button type="button" disabled={scanning} onClick={() => setPreviewOrientation((color) => color === 'w' ? 'b' : 'w')}><FlipVertical2 size={16} /> Flip board view</button>
          <p className="muted import-history-note">Viewing from {previewOrientation === 'w' ? 'White' : 'Black'}. Flipping the view keeps the pieces, side to move and FEN unchanged.</p>
        </> : null}

        {draftFen.trim() && validation.error ? <p className="import-warning" role="alert">{validation.error}</p> : null}
        {validation.suggestedTurn ? <button type="button" disabled={scanning} onClick={() => updateField(1, validation.suggestedTurn!)}>
          Set {validation.suggestedTurn === 'w' ? 'White' : 'Black'} to move
        </button> : null}
        {scan && !scan.reliable ? <label className="review-checkbox">
          <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
          I checked the board and corrected any mistakes.
        </label> : null}
        <button className="load-position" type="button" onClick={load}
          disabled={!validation.fen || scanning || Boolean(scan && !scan.reliable && !reviewed)}>{isAnalysis ? 'Analyze position' : 'Load position'}</button>
        {isAnalysis ? <p className="muted import-next-step">Find candidate moves, likely mistakes, strong defenses, and the lines that punish them.</p> : null}
      </div>
    </details>
  );
}

function percent(value: number) { return `${(value * 100).toFixed(1)}%`; }
function pieceGlyph(piece: string): string {
  return ({ wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙', bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟' } as Record<string, string>)[piece];
}
