# Fly Brain Doom

A browser experiment that connects a Drosophila connectome simulation to a live Freedoom environment.

## What it does

- boots Freedoom in the browser through a WebAssembly Chocolate Doom build;
- downsamples live game frames into motion and looming-like sensory signals;
- injects those signals into LC4/LPLC2 visual pathways in a browser whole-brain simulation;
- reads descending-neuron and population activity into a small reinforcement-learning readout;
- maps the learned output to navigation controls only: forward, left, right and use/open;
- renders live game vision, neural activity, policy actions and reward history;
- persists learned readout weights in `localStorage`.

Weapon firing is deliberately not part of the controller.

## Scientific boundary

The connectome topology and neuron metadata are sourced from the browser-ready FlyWire dataset used by [Fruit Fly Lab](https://github.com/vaibhavkedarisetti/fruit-fly-lab). The neural dynamics, sensory encoding, reward function and readout are modelling choices. This is not a literal reconstructed living fly brain and improvement in game reward is not evidence of biological learning.

The browser visual encoder uses motion/looming proxies because the referenced browser simulator explicitly does not model direct photoreceptor light input with a correct histaminergic sign.

## Run locally

No build step is required.

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` and press **Start experiment**.

The first load downloads the connectome graph and WebAssembly game engine from pinned/public CDNs, so it requires an internet connection.

## Deployment

The app is static and Vercel-ready. `vercel.json` adds the cross-origin isolation headers used by the browser runtime.

## Upstream components

See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md).
