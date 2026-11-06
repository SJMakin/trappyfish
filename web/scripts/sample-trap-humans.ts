import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { allTrapStudies } from '../src/openings/trapLibrary';
import { humanTrapSample, type HumanTrapSample } from '../src/openings/trapEvidence';

const endpoint = 'https://explorer.lichess.org/lichess';
const source = 'https://lichess.org/api#tag/Opening-Explorer';
const ratings = [1000, 1200, 1400, 1600]; const speeds = ['rapid'];
const rawPath = 'benchmarks/review/trap-library-explorer.json';
const output = 'src/openings/trapHumanSamples.json';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
type StoredResponse = { fen: string; url: string; fetchedAt: string; response: unknown };
const raw: { endpoint: string; ratings: number[]; speeds: string[]; retryAt?: number;
  authorizationRequired?: { observedAt: string; status: 401 }; responses: StoredResponse[] } = { endpoint, ratings, speeds, responses: [] };
try {
  const saved = JSON.parse(await readFile(rawPath, 'utf8'));
  if (saved.endpoint === endpoint && JSON.stringify(saved.ratings) === JSON.stringify(ratings) && JSON.stringify(saved.speeds) === JSON.stringify(speeds)) {
    raw.retryAt = saved.retryAt;
    if (!process.argv.includes('--fresh')) { raw.responses = saved.responses; raw.authorizationRequired = saved.authorizationRequired; }
  }
} catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const report = { version: 1, createdAt: new Date().toISOString(), source, endpoint,
  sourceSha256: sha(JSON.stringify(allTrapStudies)), ratings, speeds,
  method: 'Conditional frequency among all rated games at the position after the bait, for rating buckets 1000/1200/1400/1600 (1000–1799) and rapid. Twelve most common moves are requested. A missing reply has unknown count, never zero. No child-position totals are substituted. These samples do not estimate how often a game reaches the setup or whether a player will take the bait.',
  attribution: 'Lichess Opening Explorer API, with request timestamps and filters. No separate CC0 redistribution claim is made for these API responses.',
  rawResponsesSha256: '', positions: [] as HumanTrapSample[] };
const save = async () => {
  report.rawResponsesSha256 = sha(JSON.stringify(raw));
  await writeFile(rawPath, JSON.stringify(raw, null, 2) + '\n');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
};
let nextRequestAt = 0;
for (const study of allTrapStudies) {
  const cached = raw.responses.find(row => row.fen === study.afterBaitFen);
  if (cached) {
    report.positions.push(humanTrapSample(study.id, study.afterBaitFen, study.temptingReplyUci, cached.response, cached.fetchedAt));
    await save(); continue;
  }
  const unavailable = (status: 'unavailable' | 'rate-limited', reason: string): HumanTrapSample => ({
    id: study.id, fen: study.afterBaitFen, mistake: study.temptingReplyUci, fetchedAt: new Date().toISOString(),
    status, reason, gamesAtPosition: null, mistakeGames: null, mistakeFrequency: null,
  });
  if (raw.authorizationRequired) {
    report.positions.push(unavailable('unavailable', `Lichess required authorization at ${raw.authorizationRequired.observedAt}; no further request was made. This script never reads credentials.`));
    await save(); continue;
  }
  if (raw.retryAt && Date.now() < raw.retryAt) {
    report.positions.push(unavailable('rate-limited', `Lichess cooldown until ${new Date(raw.retryAt).toISOString()}; no request was made.`));
    await save(); continue;
  }
  if (nextRequestAt > Date.now()) await new Promise(resolve => setTimeout(resolve, nextRequestAt - Date.now()));
  const url = `${endpoint}?${new URLSearchParams({ variant: 'standard', fen: study.afterBaitFen, ratings: ratings.join(','), speeds: speeds.join(','), moves: '12', topGames: '0', recentGames: '0' })}`;
  const timeout = AbortSignal.timeout(20_000);
  try {
    const response = await fetch(url, { signal: timeout, headers: { Accept: 'application/json', 'User-Agent': 'Trappyfish-content-verification' } });
    if (response.status === 401) {
      raw.authorizationRequired = { observedAt: new Date().toISOString(), status: 401 };
      report.positions.push(unavailable('unavailable', 'Lichess returned HTTP 401. Remaining requests are skipped; no credentials are read.'));
    } else if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const retryMs = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 60_000;
      raw.retryAt = Date.now() + Math.max(60_000, Number.isFinite(retryMs) ? retryMs : 60_000);
      report.positions.push(unavailable('rate-limited', `Lichess returned 429; requests paused until ${new Date(raw.retryAt).toISOString()}.`));
    } else if (!response.ok) report.positions.push(unavailable('unavailable', `Lichess returned HTTP ${response.status}.`));
    else {
      const body: unknown = await response.json(); const fetchedAt = new Date().toISOString();
      const sample = humanTrapSample(study.id, study.afterBaitFen, study.temptingReplyUci, body, fetchedAt);
      raw.responses.push({ fen: study.afterBaitFen, url, fetchedAt, response: body });
      report.positions.push(sample);
    }
  } catch (error) { report.positions.push(unavailable('unavailable', error instanceof Error ? error.message : String(error))); }
  nextRequestAt = Date.now() + 1_000;
  await save();
  const sample = report.positions.at(-1)!;
  console.log(`${study.id}: ${sample.status}${sample.mistakeFrequency === null ? ` (${sample.reason})` : ` ${(sample.mistakeFrequency * 100).toFixed(1)}% of ${sample.gamesAtPosition} games`}`);
}
await save();
console.log(`Human samples: ${report.positions.filter(row => row.status === 'available').length}/${report.positions.length} available; unknown and failed counts remain null.`);
