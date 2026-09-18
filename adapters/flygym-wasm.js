// High-fidelity body adapter contract.
// Not active in the default arena yet: the default arena stays explicitly labelled
// as the browser baseline until a two-fly shared MuJoCo world is validated.

export const FLYGYM = Object.freeze({
  repo: 'NeLy-EPFL/flygym',
  release: 'v2.1.0',
  releaseCommit: 'ca65a510c2afe6ac61c51df4f274c8d190c2f95f',
  generatedAssetsCommit: '0884af08981994543634563d95e9b1eb49945082',
  mujoco: '3.9.0',
  modelXml: 'https://cdn.jsdelivr.net/gh/NeLy-EPFL/flygym@0884af08981994543634563d95e9b1eb49945082/wasm/game/assets/model/fly.xml',
  modelMeta: 'https://cdn.jsdelivr.net/gh/NeLy-EPFL/flygym@0884af08981994543634563d95e9b1eb49945082/wasm/game/assets/model_meta.json',
});

export async function probeFlyGymAssets(){
  const [xml,meta]=await Promise.all([
    fetch(FLYGYM.modelXml,{method:'GET',cache:'force-cache'}),
    fetch(FLYGYM.modelMeta,{method:'GET',cache:'force-cache'}),
  ]);
  if(!xml.ok||!meta.ok)throw new Error(`FlyGym assets unavailable (${xml.status}/${meta.status})`);
  const xmlText=await xml.text();
  const metaJson=await meta.json();
  if(!xmlText.includes('<mujoco')||!xmlText.includes('nmf/c_thorax'))throw new Error('Unexpected NeuroMechFly MJCF');
  return {ok:true,xmlBytes:xmlText.length,timestep:metaJson.timestep,actuators:metaJson.actuators?.length??null};
}

export function flyGymIntegrationStatus(){
  return {
    active:false,
    reason:'A two-fly shared-world MJCF must be generated and validated before this adapter can replace the baseline arena.',
    target:'MuJoCo-WASM + NeuroMechFly v2 + CPG/descending-signal bridge',
  };
}
