import { useState } from 'react';
import { type Color } from 'chess.js';
import { Microscope, Swords } from 'lucide-react';
import { AnalysisWorkspace } from './components/AnalysisWorkspace';
import { PlayWorkspace } from './components/PlayWorkspace';
import { validatePosition } from './import/position';

type Workspace = 'analysis' | 'play';

export function App() {
  const [session] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const suppliedFen = query.get('fen');
    const initialFen = suppliedFen ? validatePosition(suppliedFen).fen ?? undefined : undefined;
    return {
      initialFen,
      player: (query.get('player') === 'b' ? 'b' : 'w') as Color,
      mode: (query.get('mode') === 'play' || query.has('engine') ? 'play' : 'analysis') as Workspace,
    };
  });
  const [workspace, setWorkspace] = useState<Workspace>(session.mode);
  const [analysisOpened, setAnalysisOpened] = useState(session.mode === 'analysis');
  const [playOpened, setPlayOpened] = useState(session.mode === 'play');
  const [playPosition, setPlayPosition] = useState({ fen: session.initialFen, color: session.player, version: 0 });

  const switchWorkspace = (next: Workspace) => {
    setWorkspace(next);
    if (next === 'analysis') setAnalysisOpened(true);
    if (next === 'play') setPlayOpened(true);
    const url = new URL(window.location.href);
    url.searchParams.delete('engine');
    if (next === 'play') url.searchParams.set('mode', 'play');
    else url.searchParams.delete('mode');
    window.history.replaceState(null, '', url);
  };

  const playFromPosition = (fen: string, color?: Color) => {
    setPlayPosition((previous) => ({ fen, color: color ?? fen.split(' ')[1] as Color, version: previous.version + 1 }));
    switchWorkspace('play');
  };

  return <>
    <nav className="workspace-nav" aria-label="Trappyfish workspace">
      <span className="workspace-brand"><Swords size={21} aria-hidden="true" /> Trappyfish</span>
      <div className="workspace-switch" role="group" aria-label="Choose workspace">
        <button type="button" className={workspace === 'analysis' ? 'is-active' : ''} aria-pressed={workspace === 'analysis'}
          onClick={() => switchWorkspace('analysis')}><Microscope size={18} /> Analyze</button>
        <button type="button" className={workspace === 'play' ? 'is-active' : ''} aria-pressed={workspace === 'play'}
          onClick={() => switchWorkspace('play')}><Swords size={18} /> Play AI</button>
      </div>
      <p>{workspace === 'analysis' ? 'Find the bait. Study the punishment.' : 'Practice against a ruthless opponent.'}</p>
    </nav>
    <div className="workspace-panel" hidden={workspace !== 'analysis'}>
      {analysisOpened ? <AnalysisWorkspace active={workspace === 'analysis'} initialFen={session.initialFen} onPlayFromPosition={playFromPosition} /> : null}
    </div>
    <div className="workspace-panel" hidden={workspace !== 'play'}>
      {playOpened ? <PlayWorkspace key={playPosition.version} active={workspace === 'play'} initialFen={playPosition.fen} initialPlayer={playPosition.color} /> : null}
    </div>
  </>;
}
