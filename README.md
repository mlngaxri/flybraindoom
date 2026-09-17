# Fly Brain Flappy

A browser experiment that connects a Drosophila connectome simulation to a Flappy-style visual-control benchmark.

## What it does

- runs an original browser Flappy-style environment with replacement artwork;
- downsamples the complete game frame into spatial motion/temporal-contrast signals;
- projects the strongest visual candidates into LC4/LPLC2 receptive fields in a browser whole-brain simulation;
- reads descending-neuron and population activity into a small reinforcement-learning readout;
- exposes only two learned actions: **flap** and **coast**;
- rewards survival and pipe passes, strongly penalises collisions, and gives an additional bonus for a new best score;
- renders live gameplay, modeled fly visual drive, neural activity, policy actions and reward history;
- persists learned readout weights and experiment history in `localStorage`;
- supports a fullscreen spectator view without changing what the fly receives.

The policy does **not** receive pipe coordinates, bird height, velocity, collision geometry or other hidden game state. Its action input is neural telemetry only. Game events are used only as the external reinforcement signal.

## Scientific boundary

The connectome topology and neuron metadata are sourced from the browser-ready FlyWire-derived dataset used by [Fruit Fly Lab](https://github.com/vaibhavkedarisetti/fruit-fly-lab). The neural dynamics, sensory encoding, reward function, flap/coast mapping and readout are modelling choices. This is not a literal reconstructed living fly brain and improvement in score is not evidence of biological learning.

The visual encoder uses motion/looming-like proxies because the referenced browser simulator does not model a complete photoreceptor-to-brain visual system.

## Flappy-style environment

The environment is implemented in this repository from scratch. It is inspired by the one-button obstacle-passing structure of Flappy Bird, but it does not redistribute original Flappy Bird source code, sprites or audio.

## Run locally

No build step is required.

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` and press **Start experiment**.

The first load downloads the connectome graph and simulation modules from pinned public upstream resources, so it requires an internet connection.

## Deployment

The app is static and Vercel-ready. `vercel.json` adds the cross-origin isolation headers used by the browser runtime.

## Upstream components

See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md).
