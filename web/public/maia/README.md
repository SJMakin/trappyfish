# Maia-3 opponent policy

`maia3-5m.onnx` is the 5M-parameter Maia-3 (Chessformer) human move prediction
model from the University of Toronto Computational Social Science Lab. Its move
probabilities condition on the rating of the player to move and their opponent.
Stockfish, rather than Maia's value head, evaluates the resulting positions.

- Official inference reference and license: https://github.com/CSSLab/maia3
- Official checkpoint: https://huggingface.co/UofTCSSLab/Maia3-5M
- ONNX export: https://huggingface.co/cemoss17/maia3-onnx/tree/2a8295492e802fdea829cc9d30d8ad42fc3c7f72
- ONNX SHA-256: `f7bd01b3e41dceb5e93eb9f4c61e9c4db8b35411effd1d8c984b006cd74bb804`
- Model/code upstream license: AGPL-3.0; included as `LICENSE-MAIA3.txt`.
  The exporter's JavaScript glue is MIT licensed; it is not included here.
- ONNX Runtime: https://github.com/microsoft/onnxruntime (MIT).
- Conceptual reference: https://github.com/flawchess/flawchess (AGPL-3.0).
  FlawChess combines Stockfish evaluations with Maia human reply probabilities.
  This project implements its own adapter and one-reply expected-outcome search.

The pinned full-history model accepts `tokens: float32 [batch,64,96]`,
`self_elo: int64 [batch]`, `oppo_elo: int64 [batch]`, and returns
`logits_move: float32 [batch,4352]`, plus a value head not used by Trappyfish.
Standalone FENs repeat the current position in all eight history slots, matching
the official UCI client's default when UCI history reconstruction is disabled.
Black positions are rank-mirrored with colors swapped. Legal moves are masked
before softmax, with all four promotions in their explicit vocabulary lanes.

Citation: Daniel Monroe, George Eilender, Philip Chalmers, Zhenwei Tang, and Ashton
Anderson, *Chessformer: A Unified Architecture for Chess Modeling*, ICLR 2026.
https://openreview.net/forum?id=2ltBRzEHyd

This is a model of human choices, not a guarantee of an individual player's play.
