# Fly Brain Doom

A browser experiment that connects a Drosophila connectome simulation to a live Freedoom navigation environment.

## What it does

- boots Freedoom in the browser through a WebAssembly Chocolate Doom build;
- samples the complete game framebuffer rather than a cropped spectator view;
- separates camera rotation from forward optic flow so spinning is not treated as useful progress;
- detects rapid expansion, strong local motion and sudden darkening as threat-like visual events;
- projects those events into LC4/LPLC2 receptive fields in a browser whole-brain simulation;
- reads descending-neuron and population activity into a small reinforcement-learning readout;
- maps the learned output to navigation controls only: forward, left, right and use/open;
- penalizes spinning, repeated visual loops, prolonged immobility and high threat exposure;
- renders live game vision, neural activity, modeled threat drive, policy actions and reward history;
- persists the Doom readout weights and experiment history in `localStorage`.

Weapon firing is deliberately not part of the controller.

## Threat mode

“Scary for the fly” is implemented as a stronger **modeled threat drive**, not as a claim that the simulation has subjective fear. Rapid image expansion, sudden darkening and strong non-rotational local motion are selectively amplified into looming stimuli. The browser worker then projects those stimuli through Fruit Fly Lab's existing LC4/LPLC2 looming encoder using more urgent approach parameters.

This keeps the scientific boundary explicit: the connectome structure is sourced, while the neuron dynamics, sensory encoding, threat amplification, reward function and neural-to-action readout are engineering choices.

## Scientific boundary

The connectome topology and neuron metadata are sourced from the browser-ready FlyWire-derived dataset used by [Fruit Fly Lab](https://github.com/vaibhavkedarisetti/fruit-fly-lab). The neural dynamics, sensory encoding, threat model, reward function and readout are modelling choices. This is not a literal reconstructed living fly brain, and improvement in game reward is not evidence of biological learning.

The policy receives neural telemetry only. Raw game pixels are used to construct visual stimulation and environmental reward signals, not as direct action-selection inputs.

## Run locally

No build step is required.

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` and press **Start experiment**.

The first load downloads the connectome graph and WebAssembly game engine from pinned public sources, so it requires an internet connection.

## Deployment

The app is static and Vercel-ready. `vercel.json` adds the cross-origin headers used by the browser runtime.

## Upstream components

See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md).
