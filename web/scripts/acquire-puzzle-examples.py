"""Stream six CC0 motif examples; never download the full puzzle database.

Requires the optional Python zstandard package. The checked-in source rows are
the pinned input; rerunning acquisition intentionally selects a new data revision.
The first database move is the opponent's mistake, not the solver's first move.
"""
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen
import zstandard

source = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
motifs = ["fork", "pin", "skewer", "deflection", "discoveredAttack", "mateIn2"]
selected = {}
with urlopen(source, timeout=30) as response:
    with zstandard.ZstdDecompressor().stream_reader(response) as stream:
        rows = csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8"))
        for row in rows:
            themes = row["Themes"].split()
            for motif in motifs:
                if motif in themes and motif not in selected and row["PuzzleId"] not in [item["PuzzleId"] for item in selected.values()]:
                    selected[motif] = {**row, "selectedMotif": motif}
                    break
            if len(selected) == len(motifs):
                break
rows = [selected[motif] for motif in motifs]
raw = (json.dumps(rows, separators=(",", ":")) + "\n").encode("utf-8")
root = Path(__file__).resolve().parent.parent / "src" / "openings"
(root / "puzzleSourceRows.json").write_bytes(raw)
provenance = {"source": source, "license": "CC0-1.0", "acquiredAt": datetime.now(timezone.utc).isoformat(), "subsetSha256": hashlib.sha256(raw).hexdigest(), "rows": len(rows), "notes": "Pinned source rows; first Moves entry must be applied before presenting the solver position. Lichess motif labels, not independently inferred labels."}
(root / "puzzleProvenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
print(f"Saved {len(rows)} CC0 rows, SHA256 {provenance['subsetSha256']}")
