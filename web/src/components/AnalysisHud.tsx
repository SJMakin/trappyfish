import { deriveScoreLedger, summarizeAnalysisTree } from '../engine/analysisDiagnostics';
import type { AnalysisProgress, CandidateInfo, MoveDecision, SearchDiagnostics, TrappySettings } from '../engine/trappy';
import './analysisHud.css';

type AnalysisHudProps = {
  decision: MoveDecision;
  selected: CandidateInfo;
  /** The immutable settings used for this decision, rather than the current control values. */
  settings?: TrappySettings;
  busy?: boolean;
  progress?: AnalysisProgress;
};

const integer = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
const number = (value: number | undefined, digits = 3) => value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
const signed = (value: number | undefined, digits = 1) => value === undefined || !Number.isFinite(value)
  ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const probability = (value: number | undefined) => value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
const count = (value: number | undefined) => value === undefined ? '—' : integer.format(value);
const short = (value: number | undefined) => value === undefined ? '—' : compact.format(value);
const duration = (value: number | undefined) => value === undefined ? '—'
  : value < 1000 ? `${Math.round(value)} ms` : value < 60_000 ? `${(value / 1000).toFixed(1)} s`
    : `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
const mate = (value: number) => Math.abs(value) >= 90_000;
const evaluation = (value: number | undefined) => value === undefined ? '—' : mate(value)
  ? value > 0 ? 'Forced mate' : 'Losing to mate' : `${signed(value, 0)} cp`;

export function AnalysisHud({ decision, selected, settings, busy = false, progress }: AnalysisHudProps) {
  const live = Boolean(busy && progress?.diagnostics);
  const diagnostics = live ? progress?.diagnostics : decision.diagnostics;
  const tree = summarizeAnalysisTree(decision.candidates);
  const ledger = deriveScoreLedger(decision, selected, settings);
  const recordedRisk = decision.riskLimitCp;
  const snapshotRisk = settings ? decision.rootBestScoreCp >= 500
    ? Math.min(settings.maxRiskCp, settings.winningRiskCp ?? 40) : settings.maxRiskCp : undefined;
  const riskLimit = recordedRisk ?? snapshotRisk;
  const outsideRisk = selected.status === 'outside-risk' || riskLimit !== undefined && ledger.objectiveGapCp > riskLimit;
  const rootTrace = decision.diagnostics?.rootTrace;

  return <section className="analysis-engine-hud" data-testid="engine-hud" aria-label="Engine internals">
    <header className="hud-heading">
      <h3><span className={`hud-status-dot${live ? ' is-live' : ''}`} /> Engine telemetry</h3>
      <span className="hud-caption">{live ? 'LIVE SEARCH' : 'COMPLETED SEARCH'}</span>
    </header>
    <div className="hud-telemetry" aria-label={live ? 'Live search counters' : 'Completed search counters'}>
      <Telemetry label="Wall time" value={duration(diagnostics?.elapsedMs)} />
      <Telemetry label="Stockfish calls" value={count(diagnostics?.stockfishCalls)} />
      <Telemetry label="Policy calls" value={count(diagnostics?.policyCalls)} />
      <Telemetry label="Nodes searched" value={short(diagnostics?.nodes)} title={diagnostics?.nodes === undefined ? undefined : count(diagnostics.nodes)} />
      <Telemetry label="Max depth / selective" value={diagnostics?.maxDepth === undefined ? '—'
        : `${diagnostics.maxDepth} / ${diagnostics.maxSelDepth ?? '—'}`} />
      <Telemetry label="Latest search n/s" value={short(diagnostics?.latestNps)} />
      <Telemetry label="Policy time" value={duration(diagnostics?.policyTimeMs)} />
      <Telemetry label="Hash occupancy" value={diagnostics?.hashfull === undefined ? '—' : `${(diagnostics.hashfull / 10).toFixed(1)}%`}
        title="UCI hashfull, reported in thousandths of the hash table." />
    </div>
    {!diagnostics ? <p className="hud-note">This result contains no search telemetry. Counters are unavailable.</p> : null}
    {live ? <p className="hud-note hud-live-note" role="status">Counters follow the new search; node, depth, and speed values update after each completed Stockfish call. The score ledger and tree describe the completed result below.</p> : null}

    <div className="hud-tree-census" aria-label="Completed search tree size">
      <span><b>{tree.candidates}</b> candidates</span>
      <span><b>{tree.evaluated}</b> evaluated</span>
      <span><b>{tree.firstReplies}</b> first replies</span>
      <span><b>{tree.continuations}</b> continuations</span>
      <span><b>{tree.secondReplies}</b> second replies</span>
      {tree.outsideRisk ? <span className="hud-caution"><b>{tree.outsideRisk}</b> outside risk</span> : null}
    </div>

    <div className="hud-ledger-heading">
      <h3>Score ledger <strong>{selected.san}</strong></h3>
      <span className={`hud-caption${outsideRisk ? ' hud-caution' : ''}`}>{outsideRisk ? 'OUTSIDE RISK LIMIT'
        : selected.analyzed === false || selected.status === 'objective-only' ? 'OBJECTIVE ONLY' : 'EVALUATED'}</span>
    </div>
    <div className="hud-score-readouts" data-testid="selected-score-ledger">
      <div><span>Conservative eval</span><strong className={ledger.forcedOutcome ? 'is-mate' : undefined}>{ledger.forcedOutcome ? evaluation(selected.rootScoreCp)
        : <>{signed(selected.rootScoreCp, 0)} <small>cp</small></>}</strong></div>
      <div><span>Expected utility</span><strong>{ledger.modeled ? number(selected.expectedScore, 4) : '—'} <small>u</small></strong></div>
      <div><span>Final ranking</span><strong className={ledger.forcedOutcome ? 'is-mate' : undefined}>{ledger.forcedOutcome ? 'Mate priority'
        : <>{signed(selected.adjustedScoreCp)} <small>pts</small></>}</strong></div>
    </div>
    <p className="hud-note">Evaluations are for the root player. Utility is bounded evaluation, <b>not a calibrated win rate</b>. Ranking points include playing preferences.</p>

    <ol className="hud-score-pipeline" aria-label="Score calculation">
      <PipelineRow label="Objective baseline" formula={ledger.forcedOutcome ? 'Forced outcome: bypass the finite utility transform'
        : 'u₀ = 1 / (1 + exp(−baselineCp / 200))'} value={number(selected.objectiveScore, 4)} unit="u" />
      {ledger.modeled ? <>
        <PipelineRow label="Human reply expectation" formula={`E[u] = Σ p(reply) × u(reply) + ${number(ledger.omittedMass, 4)} × u₀`}
          value={number(selected.expectedScore, 4)} unit="u" />
        <PipelineRow label="Trappiness interpolation" formula={ledger.weight === undefined ? 'Analysis settings snapshot unavailable'
          : `u_mix = u₀ + ${number(ledger.weight, 2)} × (E[u] − u₀)`} value={number(ledger.blendedUtility, 4)} unit="u" />
        {!ledger.forcedOutcome ? <PipelineRow label="Utility → ranking base"
          formula="R₀ = 200 × ln(u_mix / (1 − u_mix))" value={signed(ledger.baseRanking)} unit="pts" /> : null}
      </> : <PipelineRow label={ledger.forcedOutcome ? 'Forced score retained' : 'Objective ranking base'}
        formula={ledger.forcedOutcome ? 'Mate outcome keeps priority over finite ranking scores'
          : decision.warning ? 'No usable human policy: keep objective score' : 'Human reply interpolation is not applied'}
        value={ledger.forcedOutcome ? selected.rootScoreCp > 0 ? 'Mate +' : 'Mate −' : signed(ledger.baseRanking)} unit={ledger.forcedOutcome ? '' : 'pts'} />}
      <PipelineRow label={ledger.forcedOutcome ? 'Forced outcome priority' : 'Style additions'}
        formula={ledger.forcedOutcome ? 'Style additions bypassed for forced outcomes'
          : `R = R₀ + ${signed(ledger.totalStyleBonus)} net style points (all contributions below)`}
        value={ledger.forcedOutcome ? selected.rootScoreCp > 0 ? 'Mate +' : 'Mate −' : signed(selected.adjustedScoreCp)} unit={ledger.forcedOutcome ? '' : 'pts'} final />
    </ol>
    {ledger.forcedOutcome ? <p className="hud-note">Forced mate takes priority over style ranking. Stored mate encoding: {count(selected.rootScoreCp)}. This is a mate sentinel, separate from finite centipawn evaluation.</p> : null}
    {decision.policySource === 'stockfish' && settings && settings.trappiness > 0
      ? <p className="hud-note hud-caution">Requested trappiness {number(settings.trappiness, 2)}; effective interpolation is 0 because human reply analysis is unavailable.</p> : null}

    <div className="hud-risk-line" aria-label="Objective risk boundary">
      <span>Objective gap <b>{mate(ledger.objectiveGapCp) ? 'mate outcome' : `${signed(ledger.objectiveGapCp, 0)} cp`}</b></span>
      <span>{recordedRisk === undefined ? 'Configured limit' : 'Applied limit'} <b>{riskLimit === undefined ? '—' : `${number(riskLimit, 0)} cp`}</b></span>
      <span>Soundest <b>{decision.rootBestSan} {evaluation(decision.rootBestScoreCp)}</b></span>
    </div>

    <MoveSelectionDetails decision={decision} />

    <details className="hud-details">
      <summary>Probability accounting <span>{ledger.modeled ? `${probability(selected.policyCoverage)} first-turn coverage` : 'No sampled reply policy'}</span></summary>
      {ledger.modeled ? <>
        <dl className="hud-accounting">
          <dt>Sampled first replies</dt><dd>{selected.replies.length} · {probability(selected.policyCoverage)} mass</dd>
          <dt>Unsearched first-turn mass</dt><dd>{probability(ledger.omittedMass)}</dd>
          <dt>Sampled utility contribution</dt><dd>{number(ledger.searchedContribution, 6)}</dd>
          <dt>Unsearched baseline contribution</dt><dd>{number(ledger.omittedMass, 4)} × {number(selected.objectiveScore, 4)} = {number(ledger.omittedContribution, 6)}</dd>
          <dt>Expected utility</dt><dd>{number(selected.expectedScore, 6)}</dd>
          <dt>≥100 cp gain over root baseline</dt><dd>{probability(selected.mistakeProbability)}</dd>
        </dl>
        <p className="hud-note">The policy retains its probability mass; sampled replies are not renormalized. Every unsearched reply receives conservative baseline utility. A reply’s utility includes its second-turn refinement when available.</p>
        {ledger.refinements.length ? <div className="hud-table-scroll">
          <table className="hud-data-table"><caption>Second opponent turn: conditional policy and joint mass</caption>
            <thead><tr><th>After reply → our move</th><th>Replies</th><th>Coverage given setup</th><th>Joint sampled mass</th></tr></thead>
            <tbody>{ledger.refinements.map((row, index) => <tr key={`${row.reply}-${row.continuation}-${index}`}>
              <th>{row.reply} → {row.continuation}</th><td>{row.replies}</td><td>{probability(row.conditionalCoverage)}</td><td>{probability(row.jointCoverage)}</td>
            </tr>)}</tbody>
          </table>
        </div> : null}
        {ledger.refinements.length ? <p className="hud-note">Joint sampled mass = P(first reply) × P(sampled second replies | setup). Conditional coverage refers only to that setup. These are policy branch probabilities, not position win probabilities.</p> : null}
      </> : <p className="hud-note">No human reply distribution was evaluated for this candidate. Objective search values remain available; no reply probabilities are inferred.</p>}
    </details>

    <StyleInternals selected={selected} settings={settings} ledger={ledger} />

    <details className="hud-details">
      <summary>Search contract <span>{settings ? `Root d${settings.rootDepth} · ${settings.opponentPlies ?? 1} opponent turns` : 'Snapshot unavailable'}</span></summary>
      {settings ? <dl className="hud-accounting">
        <dt>Root depth / initial MultiPV cap</dt><dd>{settings.rootDepth} / {settings.candidateCount}</dd>
        <dt>First / second reply search depth</dt><dd>{Math.max(1, settings.trapDepth - 1)} / {(settings.opponentPlies ?? 1) === 2 ? Math.max(1, settings.trapDepth - 3) : 'disabled'}</dd>
        <dt>First reply cap / target coverage</dt><dd>{settings.replyCount} / {probability(settings.replyCoverage)}</dd>
        <dt>Second-turn branches / reply cap</dt><dd>{(settings.opponentPlies ?? 1) === 2 ? `${settings.continuationBranches ?? 3} / ${settings.continuationReplies ?? 4}` : 'disabled'}</dd>
        <dt>Opponent / engine policy rating</dt><dd>{settings.opponentRating} / {settings.engineRating}</dd>
        <dt>Trappiness / sharpness</dt><dd>{number(settings.trappiness, 2)} / {number(settings.sharpness ?? 0, 2)}</dd>
        <dt>King attack / pawn storms / king caution</dt><dd>{number(settings.aggression ?? 0, 2)} / {number(settings.pawnStorm ?? 0, 2)} / {number(settings.kingCaution ?? 0, 2)}</dd>
        <dt>Sacrifice / tension / queen retention</dt><dd>{number(settings.sacrifice ?? 0, 2)} / {number(settings.tension ?? 0, 2)} / {number(settings.queenRetention ?? 0, 2)}</dd>
        <dt>Draw aversion / variety</dt><dd>{number(settings.drawAversion ?? 0, 2)} / {number(settings.variety ?? 0, 2)}</dd>
        <dt>Normal / winning risk bound</dt><dd>{settings.maxRiskCp} / {settings.winningRiskCp ?? 40} cp</dd>
        <dt>Initial root score / root depth</dt><dd>{evaluation(selected.initialScoreCp)} / {selected.rootDepth ?? '—'}</dd>
        <dt>Summed Stockfish search time</dt><dd>{duration(decision.diagnostics?.searchTimeMs)}</dd>
      </dl> : <p className="hud-note">The settings used to produce this result were not recorded. Current controls are not substituted.</p>}
      <p className="hud-note">Caps apply to sampled policy moves; the strongest Stockfish defense is added even if it exceeds a cap. Checks, captures, promotions, and style candidates can increase the root candidate count. Winning risk applies from +500 cp. Mate outcomes take priority. Utility inversion clamps to [0.000001, 0.999999].</p>
    </details>

    {rootTrace?.length ? <RootConvergence diagnostics={decision.diagnostics!} /> : null}
  </section>;
}

function StyleInternals({ selected, settings, ledger }: {
  selected: CandidateInfo; settings?: TrappySettings; ledger: ReturnType<typeof deriveScoreLedger>;
}) {
  const style = selected.style;
  const signal = (value: number | undefined, setting: number | undefined, available?: boolean, units = '') =>
    available === false ? 'Unavailable' : value !== undefined ? `${number(value, 4)}${units}` : settings && !setting ? 'Disabled / not sampled' : 'Not recorded';
  const rows = [
    { name: 'King attack', feature: signal(style?.attackPressure, settings?.aggression, style?.positionalAvailable), contribution: ledger.attackBonus, scale: '60 × setting × pressure' },
    { name: 'Pawn storms', feature: signal(style?.pawnStorm, settings?.pawnStorm, style?.positionalAvailable), contribution: ledger.pawnStormBonus, scale: '50 × setting × storm' },
    { name: 'King caution', feature: signal(style?.kingExposure, settings?.kingCaution, style?.positionalAvailable), contribution: -ledger.kingCautionPenalty, scale: '−60 × setting × exposure' },
    { name: 'Sacrifice appetite', feature: signal(style?.materialInvestment, settings?.sacrifice, style?.positionalAvailable, ' pawns'), contribution: ledger.sacrificeBonus, scale: 'Up to 60 × setting; investment + compensation' },
    { name: 'Tension', feature: signal(style?.tension, settings?.tension, style?.positionalAvailable), contribution: ledger.tensionBonus, scale: '40 × setting × tension' },
    { name: 'Queen retention', feature: signal(style?.queenRetention, settings?.queenRetention, style?.positionalAvailable), contribution: ledger.queenRetentionBonus, scale: '30 × setting × retention' },
    { name: 'Sharpness', feature: signal(style?.sharpness, settings?.sharpness, style?.sharpnessAvailable), contribution: ledger.sharpnessBonus, scale: '60 × setting × 2√Var(utility)' },
    { name: 'Draw aversion', feature: signal(style?.drawProbability, settings?.drawAversion, style?.drawAversionAvailable), contribution: -ledger.drawAversionPenalty, scale: '−60 × setting × P(draw)' },
  ];
  return <details className="hud-details" data-testid="style-internals">
    <summary>Playing preference internals <span>{signed(ledger.totalStyleBonus)} ranking pts</span></summary>
    <div className="hud-table-scroll">
      <table className="hud-data-table hud-style-table" data-testid="style-contributions">
        <caption>Raw features and signed additions to ranking. {ledger.forcedOutcome ? 'All additions bypassed: forced mate takes priority.' : 'Disabled or unavailable features add zero.'}</caption>
        <thead><tr><th>Preference</th><th>Raw feature</th><th>Ranking pts</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.name}><th scope="row">{row.name}<small>{row.scale}</small></th><td>{row.feature}</td><td>{ledger.forcedOutcome ? 'Bypassed' : signed(row.contribution)}</td></tr>)}</tbody>
      </table>
    </div>
    <p className="hud-note">King attack measures controlled squares within two squares of the enemy king and coordinated attackers. King caution separately penalizes the same pressure against your own king. Pawn storms measure supported pawns on the king’s file or adjacent files, weighted by advancement toward that king.</p>
    <p className="hud-note">Positional signals average the candidate and up to four legal plies of its strongest-defense continuation. Tension is 60% retained material and 40% unresolved defended contacts. Queen retention is relative to your starting queen count.</p>
    <p className="hud-note">Material investment is the drop in your material balance from the starting position to the last sampled position, in pawn units. Sacrifice points require increased king pressure or piece activity. Existing deficits and completed fair trades earn no investment bonus. Material invested is separate from the evaluation risk limit.</p>
    <p className="hud-note">Sharpness uses the variance of bounded utility across actual sampled human replies, including second-turn joint mass. Unsearched mass receives the conservative baseline. It measures spread, not win probability. {settings?.sharpness && style?.sharpnessAvailable === false ? 'Sharpness is unavailable for this candidate because no usable human reply distribution was evaluated.' : ''}</p>
    <p className="hud-note">Draw aversion uses the actual Stockfish WDL estimate for this candidate’s conservative baseline. WDL is an engine estimate, separate from Maia reply probabilities. {style?.drawAversionAvailable === false ? 'Stockfish WDL is unavailable for this candidate; no draw penalty is inferred.' : selected.objectiveWdl ? `Reported W/D/L: ${probability(selected.objectiveWdl.win)} / ${probability(selected.objectiveWdl.draw)} / ${probability(selected.objectiveWdl.loss)}.` : 'No WDL estimate was recorded.'}</p>
  </details>;
}

/** The engine's own choice distribution, separate from its model of human replies. */
export function MoveSelectionDetails({ decision }: { decision: MoveDecision }) {
  const selection = decision.selection;
  if (!selection) return <details className="hud-details move-selection-details" data-testid="move-selection">
    <summary>Move selection <span>Not recorded</span></summary>
    <p className="hud-note">This result did not record its move-selection distribution. No probabilities are inferred.</p>
  </details>;
  const analysis = selection.method === 'analysis';
  const sampled = selection.method === 'sampled';
  return <details className="hud-details move-selection-details" data-testid="move-selection">
    <summary>Move selection <span>{analysis ? 'Deterministic analysis recommendation' : sampled ? 'Sampled in Play' : 'Highest-ranked eligible move'}</span></summary>
    <p className="hud-note">{analysis ? 'Analysis recommends the highest-ranked eligible move. These are the chances Play would use with the same settings.'
      : sampled ? 'Play sampled this move from the eligible candidates below.' : 'The highest-ranked eligible move was selected deterministically.'} These are the engine’s own selection chances, separate from Maia’s predictions of human replies.</p>
    <dl className="hud-accounting">
      <dt>Temperature</dt><dd>{number(selection.temperatureCp, 1)} ranking pts</dd>
      <dt>{analysis ? 'Recommended' : 'Played'}</dt><dd>{decision.san}</dd>
      {selection.randomDraw !== undefined ? <><dt>Recorded random draw [0, 1)</dt><dd>{number(selection.randomDraw, 6)}</dd></> : null}
    </dl>
    <div className="hud-table-scroll"><table className="hud-data-table">
      <caption>{analysis ? 'Play selection distribution' : 'Move-selection distribution'} · risk and forced-outcome eligibility applied</caption>
      <thead><tr><th>Move</th><th>Ranking pts</th><th>Selection chance</th></tr></thead>
      <tbody>{selection.probabilities.map(({ move, probability: chance }) => {
        const candidate = decision.candidates.find((candidate) => candidate.move === move);
        return <tr key={move} data-selection-move={move}><th scope="row">{candidate?.san ?? move}{move === decision.move ? analysis ? ' · recommended' : ' · played' : ''}</th><td>{candidate ? mate(candidate.adjustedScoreCp) ? 'Mate priority' : signed(candidate.adjustedScoreCp) : '—'}</td><td>{probability(chance)}</td></tr>;
      })}</tbody>
    </table></div>
    <p className="hud-note">For eligible moves, weight = exp((ranking − best ranking) / temperature); chances are normalized weights. Temperature = 100 × variety. At zero temperature, only the highest-ranked move is selected.</p>
    <p className="hud-note">Variety changes sampling, not objective evaluation or the ranking ledger. Moves outside the risk boundary are ineligible. Forced mates retain priority and set temperature to zero. Displayed chances are rounded.</p>
  </details>;
}

function Telemetry({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="hud-telemetry-cell" title={title}><span>{label}</span><strong>{value}</strong></div>;
}

function PipelineRow({ label, formula, value, unit, final }: { label: string; formula: string; value: string; unit: string; final?: boolean }) {
  return <li className={final ? 'hud-pipeline-row is-final' : 'hud-pipeline-row'}>
    <span><b>{label}</b><code>{formula}</code></span><strong>{value} <small>{unit}</small></strong>
  </li>;
}

function RootConvergence({ diagnostics }: { diagnostics: SearchDiagnostics }) {
  const trace = diagnostics.rootTrace ?? [];
  // The chart clamps mate sentinels for readability; the table retains the exact value.
  const scores = trace.map((point) => Math.max(-1500, Math.min(1500, point.scoreCp)));
  const minimum = Math.min(0, ...scores);
  const maximum = Math.max(0, ...scores);
  const range = Math.max(50, maximum - minimum);
  const y = (score: number) => 52 - (score - minimum) / range * 44;
  const x = (index: number) => 8 + index / Math.max(1, scores.length - 1) * 284;
  const points = scores.map((score, index) => `${x(index)},${y(score)}`).join(' ');
  const moveSwitches = trace.slice(1).reduce((sum, point, index) => sum + Number(point.move !== trace[index].move), 0);
  const zeroY = y(0);
  return <details className="hud-details hud-convergence">
    <summary>Root depth convergence <span>{trace.length} iterations · {moveSwitches} leader changes</span></summary>
    <svg viewBox="0 0 300 64" role="img" aria-label="Primary root evaluation by reported depth" preserveAspectRatio="none">
      <line x1="8" x2="292" y1={zeroY} y2={zeroY} className="hud-chart-zero" />
      <polyline points={points} className="hud-chart-line" />
      {scores.map((score, index) => <circle key={index} cx={x(index)} cy={y(score)} r="2.4" className="hud-chart-point" />)}
    </svg>
    <div className="hud-table-scroll"><table className="hud-data-table">
      <caption>Initial root search · primary MultiPV line · root player’s perspective</caption>
      <thead><tr><th>Depth</th><th>Leading move (UCI)</th><th>Evaluation</th><th>Nodes</th><th>Time</th></tr></thead>
      <tbody>{trace.map((point) => <tr key={point.depth}><th>{point.depth}</th><td>{point.move}</td><td title={mate(point.scoreCp) ? `Mate encoding: ${point.scoreCp}` : undefined}>{evaluation(point.scoreCp)}</td>
        <td>{short(point.nodes)}</td><td>{duration(point.timeMs)}</td></tr>)}</tbody>
    </table></div>
    <p className="hud-note">Each row is the leading move at that depth, so the line can change candidates. Node and time counts are cumulative within this root call. The sparkline places mate outcomes at ±1,500; hover the table’s mate label for its raw encoding.</p>
  </details>;
}
