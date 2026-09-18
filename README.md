# Fly Brain Arena

Fly Brain Arena is a browser-based two-agent embodied connectome experiment. Two independent simulated fly nervous systems receive separate egocentric sensory streams, choose their own actions, and interact in the same non-graphic contact arena.

## Current runnable build

The current browser build is **Fly Brain Arena v0**. It is deliberately split into a runnable baseline and a higher-fidelity target stack.

### Running now

- Two independent Fruit Fly Lab / FlyWire connectome simulations, one Web Worker per fly.
- Separate neural state, learning weights, random exploration, sensory input and resets for fly A and fly B.
- Six high-level outputs per fly: `idle`, `forward`, `backward`, `turn-left`, `turn-right`, `lunge`.
- Egocentric opponent sensing converted to looming / lateralized visual stimulation before reaching the connectome.
- Non-graphic body contact, knockback, ring-boundary interaction and a scalar **stability** variable. Stability is a game/control metric, not modeled tissue injury or subjective pain.
- Independent reinforcement learners receive neural telemetry only. They do not receive privileged opponent coordinates, distance, arena state or score as policy inputs.

The running neural baseline remains the pinned Fruit Fly Lab simulator used by earlier versions of this project. It is a useful browser-compatible whole-brain baseline, but it is **not MaleCNS v1.0** and the arena body is **not yet NeuroMechFly/MuJoCo**.

## Target fidelity stack

The target architecture is:

```text
MaleCNS v1.0 anatomy
        ↓
connectome-constrained neural dynamics
        ↓
identified descending-neuron readout
        ↓
FlyGym / NeuroMechFly v2 CPG + motor bridge
        ↓
shared two-fly MuJoCo-WASM world
        ↑
vision + contact + proprioceptive feedback
```

Pinned source targets are recorded in `source-manifest.json` and the adapter modules under `adapters/`.

### MaleCNS target

`adapters/malecns-webgpu.js` describes the integration boundary for a browser MaleCNS backend. The target graph is MaleCNS v1.0 with 166,700 neurons and 25,582,938 connections. The adapter is intentionally marked inactive until the exact weight parts and metadata are loaded and validated in-browser.

### NeuroMechFly target

`adapters/flygym-wasm.js` pins FlyGym v2.1.0 and its generated browser assets. FlyGym includes the NeuroMechFly v2 body running real MuJoCo dynamics in WebAssembly. The remaining body milestone is to generate and validate **one shared MJCF containing two independently prefixed fly bodies**, inter-fly collision pairs, per-fly contact sensing and separate actuator maps.

## Closed loop in v0

For each fly independently:

1. Arena geometry is converted into an egocentric visual stimulus: opponent bearing, apparent angular size, closing motion and nearby arena boundary.
2. Only that sensory representation is sent to that fly's connectome worker.
3. The worker advances its own connectome simulation and returns neural telemetry.
4. A small learned readout maps neural telemetry to one of the six arena actions.
5. Contact and round outcome generate scalar reinforcement.
6. A contact also produces a short modeled aversive sensory pulse to the receiving fly. This is a computational signal and is not a claim that the simulation experiences pain.

The two flies never share policy weights or neural state.

## Scientific boundary

This project is an embodied connectome experiment, not a digital copy of a living fly. Connectome topology can be biologically grounded while neural dynamics, sensory encoding, descending-neuron-to-body mapping, learning and arena rules remain modeling choices. The UI and documentation should keep those layers visibly separate.

The highest-fidelity target is therefore best described as a **connectome-constrained neuromechanical simulation**, not a perfect virtual fly.

## Source pins

- Fruit Fly Lab baseline: `vaibhavkedarisetti/fruit-fly-lab@26672e06427c12c61536ce1bd93dae7442944681`
- MaleCNS browser integration reference: `alextitonis/fly.ai@95a3dbcb05241b0a5c07028ca8ad945b23fbbe6e`
- FlyGym release: `NeLy-EPFL/flygym@v2.1.0` / commit `ca65a510c2afe6ac61c51df4f274c8d190c2f95f`
- FlyGym generated browser assets snapshot: `0884af08981994543634563d95e9b1eb49945082`
- MuJoCo browser package target: `@mujoco/mujoco@3.9.0`

See `ATTRIBUTIONS.md` for upstream acknowledgements and `ARCHITECTURE.md` for validation gates.

## Run locally

Serve the repository over HTTP and open `index.html` in a modern browser. The baseline connectome assets are downloaded on first load. Two complete workers are initialized sequentially to reduce peak download contention.
