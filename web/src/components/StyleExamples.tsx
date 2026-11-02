import { useState } from 'react';
import data from '../play/styleExamples.json';

const glyphs: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
/** Examples are generated from actual runs, independently of the controls being edited. */
export function StyleExamples() {
  const [key, setKey] = useState(data.examples[0].key);
  const example = data.examples.find((item) => item.key === key) ?? data.examples[0];
  const squares = example.fen.split(' ')[0].split('/').flatMap(rank => [...rank].flatMap(piece => /[1-8]/.test(piece) ? Array<string>(Number(piece)).fill('') : [piece]));
  const levelLabel = (value: number) => key === 'maxRiskCp' || key === 'winningRiskCp' ? `${value} cp` : `${Math.round(value * 100)}%`;
  return <details className="style-examples"><summary>What do these controls actually change?</summary>
    <p>Recorded engine examples at depth {data.budget.rootDepth}/{data.budget.trapDepth}, {data.budget.candidateCount} root candidates and {data.budget.replyCount} replies. Your current game uses its own displayed budget.</p>
    <label>Control example<select aria-label="Playing preference example" value={key} onChange={event => setKey(event.target.value)}>{data.examples.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
    <div className="style-example-board" role="img" aria-label={`Example position. ${example.fen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move.`}>{squares.map((piece, i) => <span key={i} className={`${(Math.floor(i / 8) + i % 8) % 2 ? 'dark' : 'light'} ${piece === piece.toUpperCase() ? 'white-piece' : 'black-piece'}`} aria-hidden="true">{glyphs[piece]}</span>)}</div>
    <div className="style-example-table"><table><caption>{example.label}: separate searches at three settings</caption><thead><tr><th>Setting</th><th>Played</th><th>Oracle risk</th></tr></thead><tbody>{example.levels.map(level => <tr key={level.value}><th scope="row">{levelLabel(level.value)}</th><td>{level.san}</td><td>{Math.round(level.oracleRiskCp)} cp</td></tr>)}</tbody></table></div>
    <p>{example.note}</p>
    {example.effectExample ? <p>For the considered move <strong>{example.effectExample.san}</strong>, the recorded ranking contribution was {example.effectExample.contributions.map(level => `${levelLabel(level.value)}: ${level.cp >= 0 ? '+' : ''}${level.cp.toFixed(1)}`).join(' · ')} points. These points are separate from objective evaluation.</p> : null}
    <p>Reweighting the retained pool: {example.fixedPool.map(level => `${levelLabel(level.value)} → ${level.san}`).join(' · ')}. This comparison is only among the searched candidates.</p>
    <p>Oracle risk is a separate depth-14 Stockfish estimate; finite searches can disagree. These examples are evidence of behavior, not a promise of a particular move or a player rating.</p>
    <a href={`?fen=${encodeURIComponent(example.fen)}`} target="_blank" rel="noreferrer">Explore this position in Analyze · fresh search</a>
  </details>;
}
