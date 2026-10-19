import { useId } from 'react';
import type { TrappySettings } from '../engine/trappy';

export function PlayingStyleControls({ settings, onChange, disabled = false, context }: {
  settings: TrappySettings; onChange: (settings: TrappySettings) => void; disabled?: boolean; context: 'Play' | 'Analysis';
}) {
  const id = useId();
  const preferences = [
    { key: 'trappiness', label: 'Trappiness', hint: 'Favour opportunities that exploit likely human mistakes.' },
    { key: 'aggression', label: 'Aggressiveness', hint: 'Favour coordinated king attacks and supported pawn storms.' },
    { key: 'tension', label: 'Tension', hint: 'Keep pieces and unresolved pawn or piece exchanges in play.' },
  ] as const;
  return <fieldset className="playing-style-controls" disabled={disabled}>
    <legend>Playing style</legend>
    <p>Independent preferences. 0% adds no preference.</p>
    {preferences.map(({ key, label, hint }) => <label className="style-control" key={key}>
      <span className="style-control-heading"><span>{label}</span><output>{Math.round((settings[key] ?? 0) * 100)}%</output></span>
      <input aria-label={`${context} ${label.toLowerCase()}`} aria-describedby={`${id}-${key}`} type="range" min={0} max={1} step={0.05}
        value={settings[key] ?? 0} onChange={(event) => onChange({ ...settings, [key]: Number(event.target.value) })} />
      <small id={`${id}-${key}`}>{hint}</small>
    </label>)}
    <label className="style-control style-control-risk">
      <span className="style-control-heading"><span>Risk tolerance</span><output>{(settings.maxRiskCp / 100).toFixed(2)} pawns</output></span>
      <input aria-label={`${context} risk tolerance`} aria-describedby={`${id}-risk`} type="range" min={0} max={300} step={25}
        value={settings.maxRiskCp} onChange={(event) => onChange({ ...settings, maxRiskCp: Number(event.target.value) })} />
      <small id={`${id}-risk`}>Maximum evaluation loss against the soundest move, using the searched defenses.</small>
    </label>
    <label className="style-control style-control-risk">
      <span className="style-control-heading"><span>Risk when winning</span><output>{((settings.winningRiskCp ?? 40) / 100).toFixed(2)} pawns</output></span>
      <input aria-label={`${context} risk when winning`} aria-describedby={`${id}-winning-risk`} type="range" min={0} max={300} step={5}
        value={settings.winningRiskCp ?? 40} onChange={(event) => onChange({ ...settings, winningRiskCp: Number(event.target.value) })} />
      <small id={`${id}-winning-risk`}>At +5 pawns or better, use the lower of the two risk limits.</small>
    </label>
    <p>Attack and tension preferences share these risk limits. Forced mates take priority.</p>
  </fieldset>;
}
