# Trappyfish Build Notes

Trappyfish is the patched Stockfish.js target for the Trappy Chess app.

## Build on GitHub

Use `.github/workflows/build-trappyfish.yml`.

For a public repository, standard GitHub-hosted runners are free. The workflow installs Emscripten 3.1.7, runs the Stockfish.js lite single-threaded build, uploads an Actions artifact, and force-publishes the browser assets to the `build-artifacts` branch:

- `trappyfish-lite-single.js`
- `trappyfish-lite-single.wasm`
- `Copying.txt`

In the app repo, update local assets with:

```powershell
npm run update:trappyfish
```

Then open the app with the Trappyfish engine query flag:

```text
http://127.0.0.1:5173/?engine=trappyfish
```

The app keeps plain Stockfish as the default while the Trappyfish artifact is absent.

## Local Build

Local builds require Emscripten `3.1.7` on `PATH`. This Windows workspace currently does not have `emcc`, so GitHub Actions is the intended build path.

```bash
npm run build-single-lite
```
