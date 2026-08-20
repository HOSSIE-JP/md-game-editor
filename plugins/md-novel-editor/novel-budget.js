'use strict';

const { visibleBudget } = require('../md-novel-builder/codegen');

function emptyBudget(diagnostics = []) {
  return {
    maxSpriteTiles: 0,
    maxSpritePieces: 0,
    maxScanlinePieces: 0,
    maxScanlinePixels: 0,
    maxOverlayTiles: 0,
    maxBudget: 0,
    states: 0,
    diagnostics,
  };
}

function analyzeNovelBudget(sceneDocument, bindings) {
  try {
    return visibleBudget(
      sceneDocument && typeof sceneDocument === 'object' ? sceneDocument : { scenes: [] },
      bindings && typeof bindings === 'object'
        ? { ...bindings, assets: bindings.assets && typeof bindings.assets === 'object' ? bindings.assets : {} }
        : { assets: {} },
    );
  } catch (error) {
    return emptyBudget([{
      severity: 'error',
      code: 'budget-analysis-failed',
      path: 'sceneDocument',
      message: `MD budget analysis failed: ${String(error?.message || error)}`,
    }]);
  }
}

module.exports = {
  analyzeNovelBudget,
};
