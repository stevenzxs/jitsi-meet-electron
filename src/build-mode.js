// Packaged behavior is fixed at build time; runtime environment cannot enable Debug.
function getBuildPolicy(isPackaged, metadata = {}) {
  const debug = !isPackaged || metadata.cloudmeetBuildMode === 'debug';
  return { debug, devTools: debug, singleInstance: !debug };
}

module.exports = { getBuildPolicy };
