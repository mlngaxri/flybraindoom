# Fly Brain Saber

A browser experiment that connects a simulated Drosophila connectome to an original random 3D saber-slicing task.

## What it is

The environment is inspired by the general one-to-one coloured-saber mechanic familiar from rhythm-slicing games, but it is not the commercial Beat Saber game and includes none of its code, music, models, textures, charts or other assets.

The active task has no music. Incoming cubes are procedurally generated with random hand, position, speed, spacing and rotation. Blue targets are randomly positioned in the left visual field and red targets in the right so the current looming-dominant visual pathway has a genuine lateralized cue without receiving a hidden colour label. The visible avatar is a smiling cube. Its left saber is blue and its right saber is red.

## Closed loop

1. The 3D scene is rendered to the browser canvas.
2. The complete rendered frame is downsampled and converted into spatial temporal-change / looming candidates.
3. Those candidates are mapped into the existing LC4/LPLC2 visual pathway provided by the Fruit Fly Lab browser simulator.
4. The connectome simulation produces neural telemetry.
5. A small learned readout chooses exactly one of three actions: `idle`, `left-swing`, or `right-swing`.
6. Hits, misses and empty swings provide scalar reinforcement.

The policy never receives block coordinates, colour labels, depth, time-to-contact, score, or other privileged game state. Hidden environment state is used only for collision detection and scalar reward generation.

## What is biological vs engineered

The connectome graph, neuron positions/metadata and simulator visual pathway come from the pinned Fruit Fly Lab source. Electrical dynamics, frame-to-looming encoding, the action readout, reward model, saber body mapping and the game itself are computational assumptions.

The result should be described as a fly-connectome-driven controller, not as an uploaded fly mind and not as evidence that a simulated fly experiences the game subjectively.

## Learning

Saber learning uses its own storage namespace (`flybrainsaber.*`) and does not reuse Doom or Flappy policy weights. The v2 controller uses a global 720 ms saber rearm lockout, moderate penalties for empty swings, stronger penalties for missed targets, large timing/accuracy-weighted hit rewards, and left/right symmetry augmentation to reduce one-hand policy collapse. Episodes reset automatically while learned weights persist locally.

## Run

Serve the repository as static files and open `index.html` in a modern browser. The brain simulator downloads its pinned connectome assets on first load.
