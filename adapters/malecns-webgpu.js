// MaleCNS browser adapter contract. The active demo does not silently substitute
// this adapter: MaleCNS becomes "active" only after the exported browser weights
// are present and the simulation passes deterministic smoke tests.

export const MALECNS = Object.freeze({
  referenceRepo:'alextitonis/fly.ai',
  referenceCommit:'95a3dbcb05241b0a5c07028ca8ad945b23fbbe6e',
  dataset:'MaleCNS v1.0',
  neurons:166700,
  connections:25582938,
  targetDt:0.020,
  inputTypes:['LPLC2','LC4','LPLC1','LC10a'],
  outputTypes:['DNa02','DNp01','DNg100','MDN'],
});

export function maleCnsCapabilities(){
  return {
    webgpu:typeof navigator!=='undefined'&&!!navigator.gpu,
    sharedArrayBuffer:typeof SharedArrayBuffer!=='undefined',
    active:false,
    reason:'Browser-exported MaleCNS weights are not bundled in this repository yet.',
  };
}

export function validateMaleCnsManifest(manifest){
  if(!manifest||manifest.neurons!==MALECNS.neurons)throw new Error('MaleCNS neuron count mismatch');
  if(manifest.connections!==MALECNS.connections)throw new Error('MaleCNS connection count mismatch');
  if(!Array.isArray(manifest.parts)||!manifest.parts.length)throw new Error('MaleCNS weight parts missing');
  return true;
}
