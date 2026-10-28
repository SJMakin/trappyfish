import { useId } from 'react';
import type { TrappySettings } from '../engine/trappy';

export function PlayingStyleControls({ settings, onChange, disabled = false, context }: {
  settings: TrappySettings; onChange: (settings: TrappySettings) => void; disabled?: boolean; context: 'Play' | 'Analysis';
}) {
  const id = useId();
  const groups = [
    { label: 'Human replies', preferences: [
      { key: 'trappiness', label: 'Trappiness', hint: 'Favour better expected outcomes against likely human replies.' },
      { key: 'sharpness', label: 'Sharpness', hint: 'Favour wider swings in outcomes across sampled human replies. Requires a usable reply policy.' },
    ] },
    { label: 'Attack & defense', preferences: [
      { key: 'aggression', label: 'King attack', hint: 'Favour control of squares near the enemy king and coordinated attackers.' },
      { key: 'pawnStorm', label: 'Pawn storms', hint: 'Favour supported advanced pawns on or beside the enemy king’s file.' },
      { key: 'kingCaution', label: 'King caution', hint: 'Penalize enemy pressure around your own king. Independent of attack appetite.' },
    ] },
    { label: 'Material & exchanges', preferences: [
      { key: 'sacrifice', label: 'Sacrifice appetite', hint: 'Favour material invested along the searched defense. The evaluation risk limit still applies.' },
      { key: 'tension', label: 'Tension', hint: 'Retain material and unresolved defended pawn or piece contacts.' },
      { key: 'queenRetention', label: 'Queen retention', hint: 'Favour keeping your queen when it was present in the starting position.' },
    ] },
    { label: 'Outcomes & variety', preferences: [
      { key: 'drawAversion', label: 'Draw aversion', hint: 'Penalize Stockfish’s estimated draw probability. Requires a reported WDL estimate.' },
      { key: 'variety', label: 'Variety', hint: context === 'Play'
        ? 'Sample among eligible moves inside the risk limit. 0% chooses the highest-ranked move.'
        : 'Show move-selection chances for Play. The analysis recommendation stays deterministic.' },
    ] },
  ] as const;
  return <fieldset className="playing-style-controls" disabled={disabled}>
    <legend>Playing style</legend>
    <p>Independent preferences. 0% adds no preference.</p>
    {groups.map((group, index) => <section className={`style-control-group${group.preferences.length === 2 ? ' style-group-pair' : ''}`} aria-labelledby={`${id}-group-${index}`} key={group.label}>
      <h4 id={`${id}-group-${index}`}>{group.label}</h4>
      {group.preferences.map(({ key, label, hint }) => <label className="style-control" key={key}>
        <span className="style-control-heading"><span>{label}</span><output>{Math.round((settings[key] ?? 0) * 100)}%</output></span>
        <input aria-label={`${context} ${label.toLowerCase()}`} aria-describedby={`${id}-${key}`} type="range" min={0} max={1} step={0.05}
          value={settings[key] ?? 0} onChange={(event) => onChange({ ...settings, [key]: Number(event.target.value) })} />
        <small id={`${id}-${key}`}>{hint}</small>
      </label>)}
    </section>)}
    <section className="style-control-group style-risk-group" aria-labelledby={`${id}-risk-group`}>
    <h4 id={`${id}-risk-group`}>Evaluation risk limits</h4>
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
    </section>
    <p>All preferences and variety share these risk limits. Sacrificed material is separate from evaluation loss. Forced mates take priority.</p>
  </fieldset>;
}
