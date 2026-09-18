# Attributions and source boundaries

Fly Brain Arena combines original browser code with interfaces and data formats informed by open-source neuroscience and biomechanics projects. Upstream projects remain governed by their own licenses and citation requirements.

## Active browser baseline

### Fruit Fly Lab

- Repository: https://github.com/vaibhavkedarisetti/fruit-fly-lab
- Pinned revision: `26672e06427c12c61536ce1bd93dae7442944681`
- Role here: browser-compatible connectome graph loading, simulator/session API and modeled visual looming pathway used by the current v0 brain workers.

Fly Brain Arena does not claim that Fruit Fly Lab, FlyWire, or the underlying connectome provides a complete biophysical model of subjective experience or natural behavior.

## Target neural stack

### MaleCNS v1.0

- Project: https://male-cns.janelia.org/
- Role here: target anatomical source for the complete adult male central nervous system.
- Data licensing should be checked against the MaleCNS release metadata before redistributing generated weight artifacts. The architecture currently treats MaleCNS-derived graph files as external/versioned assets rather than embedding them in this repository.

### fly.ai

- Repository: https://github.com/alextitonis/fly.ai
- Pinned reference revision: `95a3dbcb05241b0a5c07028ca8ad945b23fbbe6e`
- Role here: engineering reference for browser-oriented MaleCNS export/inference workflows and neuron-type interface experiments.
- No fly.ai source code is copied into the active runtime by the current v0 adapter.

## Target biomechanical stack

### FlyGym / NeuroMechFly v2

- Repository: https://github.com/NeLy-EPFL/flygym
- Release target: `v2.1.0`
- Release commit: `ca65a510c2afe6ac61c51df4f274c8d190c2f95f`
- Generated browser-assets snapshot used by the adapter: `0884af08981994543634563d95e9b1eb49945082`
- License: Apache-2.0 at the pinned upstream project.
- Role here: target biomechanical body, six-leg CPG/motor bridge, contact sensing and MuJoCo-WebAssembly browser simulation.

### MuJoCo

- Project: https://github.com/google-deepmind/mujoco
- Browser package target: `@mujoco/mujoco@3.9.0`
- Role here: target rigid-body/contact physics engine for the shared two-fly NeuroMechFly world.

## Original work in this repository

The two-agent arena, egocentric sensory encoder, independent reinforcement readouts, experiment UI, adapter boundaries, validation checks and integration code in this repository are original project code unless a file says otherwise.
