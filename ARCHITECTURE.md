# Fly Brain Arena architecture

## Goal

Two independent embodied Drosophila nervous-system simulations interact in one closed-loop arena. The long-term fidelity target is MaleCNS v1.0 for the CNS and NeuroMechFly v2 for the body and physics.

## Runtime today

The repository currently runs a browser baseline so the experiment is testable while the high-fidelity assets are integrated:

```
Fly A sensory encoder -> connectome worker A -> neural-only learned readout A -> body A
                                                                   |          |
                                                                   +-- arena -+
                                                                   |          |
Fly B sensory encoder -> connectome worker B -> neural-only learned readout B -> body B
```

The two workers do not share neural state or learned weights. Environment coordinates are not passed to either policy. Arena geometry is used only to generate each fly's egocentric sensory input, resolve contact, and produce scalar reinforcement.

## Target CNS

The target is MaleCNS v1.0: 166,700 neurons and 25,582,938 connections. The browser integration should follow the `fly.ai` web-export pattern: chunked sparse weights, WebGPU when available, CPU fallback, fixed connectome weights, and task learning only at the input/output interface.

Required validation before switching the UI badge to `MaleCNS active`:

1. Manifest has exactly 166,700 neurons and 25,582,938 connections.
2. Left/right LC4/LPLC2 stimulation produces lateralized descending-neuron responses.
3. Deterministic seeds reproduce the same smoke-test traces.
4. Two brains run independently with no shared voltage/spike state.
5. Policy inputs remain descending/neural telemetry only.

## Target body

FlyGym 2.1.0 ships an in-browser NeuroMechFly game using MuJoCo 3.9.0 compiled to WebAssembly. The target battle model is a generated shared-world MJCF containing two prefixed NeuroMechFly bodies, one arena floor, inter-fly collision pairs, per-fly contact sensors, and separate actuator maps.

The browser physics bridge should expose:

```ts
interface EmbodiedArena {
  step(dt: number): void;
  setDescendingDrive(fly: 0 | 1, left: number, right: number): void;
  getEgocentricState(fly: 0 | 1): SensoryState;
  getContactEvents(): ContactEvent[];
  resetRound(seed: number): void;
}
```

CPG/hybrid locomotion is the intended bridge between descending-neuron activity and the 42 active leg DOFs. Directly mapping arbitrary whole-brain neurons to every joint would be less biologically defensible.

## Competition semantics

The arena is non-graphic. A "fight" consists of approach, retreat, turning, lunging, body contact, knockback, stability loss, and ring-outs. `stability` is a game variable rather than a claim of tissue damage. Contact can drive an aversive sensory signal without implying pain or subjective experience.

## Next implementation step

Generate a two-fly MJCF from the FlyGym 2.1.0 model assets, duplicate and prefix the NeuroMechFly body/actuator/sensor tree, remove the slalom obstacles, add inter-fly contact, and validate it against MuJoCo-WASM before replacing `arena.js`.
