# Trappyfish Build Notes

Trappyfish is the patched Stockfish.js target for the Trappy Chess app.

## Build on GitHub

Use `.github/workflows/build-trappyfish.yml`.

For a public repository, standard GitHub-hosted runners are free. The workflow installs Emscripten 3.1.7, runs the Stockfish.js lite single-threaded build, and uploads:

- `trappyfish-lite-single.js`
- `trappyfish-lite-single.wasm`
- `Copying.txt`

After downloading the workflow artifact, copy the JS/WASM pair into the app:

```powershell
Copy-Item trappyfish-lite-single.js C:\Users\Sam\Documents\trappy\public\stockfish\trappyfish-lite-single.js
Copy-Item trappyfish-lite-single.wasm C:\Users\Sam\Documents\trappy\public\stockfish\trappyfish-lite-single.wasm
```

Then open the app with the Trappyfish engine query flag:

```text
http://127.0.0.1:5173/?engine=trappyfish
```

The app keeps plain Stockfish as the default while the Trappyfish artifact is absent.

## Local Build

Local builds require Emscripten `3.1.7` on `PATH`. This Windows workspace currently does not have `emcc`, so GitHub Actions is the intended build path.

```bash
npm ci
npm run build-single-lite
```
