import type { TrappySettings } from '../engine/trappy';
import { applySearchProfile, identifySearchProfile } from '../play/searchProfiles';
import { PlayingStyleControls } from './PlayingStyleControls';

export function PlaySettings({ settings, onChange, trappyEnabled, onModeChange }: {
  settings: TrappySettings; onChange: (settings: TrappySettings) => void;
  trappyEnabled: boolean; onModeChange: (enabled: boolean) => void;
}) {
  const update = (key: keyof TrappySettings, value: number) => onChange({ ...settings, [key]: value });
  return <details className="opponent-settings">
    <summary><span><strong>Opponent settings</strong><small>Independent controls · changes apply next turn</small></span><span>{trappyEnabled ? 'Custom style' : 'Stockfish'} · {identifySearchProfile(settings)}</span></summary>
    <div className="settings settings-content">
      <div className="control-band persona-controls" role="group" aria-label="Engine selection">
        <button type="button" aria-pressed={trappyEnabled} className={trappyEnabled ? 'is-active' : ''} onClick={() => onModeChange(true)}>Custom style</button>
        <button type="button" aria-pressed={!trappyEnabled} className={!trappyEnabled ? 'is-active' : ''} onClick={() => onModeChange(false)}>Stockfish</button>
      </div>
      <p className="muted">{trappyEnabled ? 'Style ranks sound candidates using your explicit preferences.' : 'Stockfish chooses its strongest move. Style preferences stay saved and inactive.'}</p>
      {trappyEnabled ? <><div className="rating-heading"><span>Human reply model</span><strong>{settings.opponentRating}</strong></div>
        <div className="rating-presets" role="group" aria-label="Opponent rating presets">{[800, 1000, 1400, 1800].map((rating) => <button key={rating} type="button" aria-pressed={settings.opponentRating === rating}
          className={settings.opponentRating === rating ? 'is-active' : ''} onClick={() => update('opponentRating', rating)}>{rating}</button>)}</div>
        <p className="rating-note">Predicts human replies at this level. This does not limit the engine’s strength.</p>
        <PlayingStyleControls settings={settings} onChange={onChange} context="Play" />
      </> : null}
      <section className="search-budget" aria-label="Search budget">
        <h3>Search budget <span>{identifySearchProfile(settings)}</span></h3>
        <div className="budget-choices" role="group" aria-label="Search budget choices">{(['Quick', 'Deep'] as const).map((profile) => <button key={profile} type="button"
          className={identifySearchProfile(settings) === profile ? 'is-active' : ''} aria-pressed={identifySearchProfile(settings) === profile} onClick={() => onChange(applySearchProfile(settings, profile))}>{profile}</button>)}</div>
        <p>Only the values below change. Style, risk limits and ratings stay as you set them.</p>
        <dl className="budget-readout">
          <div><dt>Root / outcome depth</dt><dd>{settings.rootDepth} / {settings.trapDepth}</dd></div>
          <div><dt>Candidates / human replies</dt><dd>{settings.candidateCount} / {settings.replyCount}</dd></div>
          <div><dt>Opponent turns modeled</dt><dd>{settings.opponentPlies ?? 1}</dd></div>
          <div><dt>Refined first reply branches</dt><dd>{settings.opponentPlies === 2 ? settings.continuationBranches ?? 3 : 'Inactive'}</dd></div>
          <div><dt>Follow-up replies / engine continuations</dt><dd>{settings.opponentPlies === 2 ? `${settings.continuationReplies ?? 4} / ${settings.continuationCandidates ?? 1}` : 'Inactive'}</dd></div>
          <div><dt>Target reply coverage</dt><dd>{Math.round(settings.replyCoverage * 100)}%</dd></div>
        </dl>
        <details className="search-settings"><summary>Edit search values</summary>
          {([
            ['rootDepth', 'Search depth', 6, 14, 1], ['trapDepth', 'Outcome search depth', 6, 14, 1],
            ['candidateCount', 'Candidate moves', 4, 24, 1], ['replyCount', 'Replies per candidate', 3, 20, 1],
          ] as const).map(([key, label, min, max, step]) => <label key={key}><span>{label}</span><strong>{settings[key]}</strong>
            <input type="range" aria-label={label} min={min} max={max} step={step} value={settings[key]} onChange={(event) => update(key, Number(event.target.value))}/></label>)}
          <label><span>Opponent turns to model</span><select aria-label="Opponent turns to model" value={settings.opponentPlies ?? 1} onChange={(event) => update('opponentPlies', Number(event.target.value))}><option value={1}>One</option><option value={2}>Two</option></select></label>
          {settings.opponentPlies === 2 ? <>
            {([
              ['continuationBranches', 'Follow-up paths', 1, 8, 3], ['continuationReplies', 'Replies on a follow-up', 2, 10, 4],
              ['continuationCandidates', 'Engine continuations per branch', 1, 2, 1],
            ] as const).map(([key, label, min, max, fallback]) => <label key={key}><span>{label}</span><strong>{settings[key] ?? fallback}</strong>
              <input aria-label={label} type="range" min={min} max={max} value={settings[key] ?? fallback} onChange={(event) => update(key, Number(event.target.value))}/></label>)}
          </> : null}
          <label><span>Reply probability coverage</span><strong>{Math.round(settings.replyCoverage * 100)}%</strong><input aria-label="Reply probability coverage" type="range" min={.7} max={1} step={.01} value={settings.replyCoverage} onChange={(event) => update('replyCoverage', Number(event.target.value))}/></label>
          <label><span>Human model rating</span><strong>{settings.opponentRating}</strong><input aria-label="Opponent rating" type="range" min={400} max={3000} step={100} value={settings.opponentRating} onChange={(event) => update('opponentRating', Number(event.target.value))}/></label>
          <label><span>Engine rating seen by Maia</span><strong>{settings.engineRating}</strong><input aria-label="Engine rating" type="range" min={400} max={3000} step={100} value={settings.engineRating} onChange={(event) => update('engineRating', Number(event.target.value))}/></label>
        </details>
      </section>
    </div>
  </details>;
}
