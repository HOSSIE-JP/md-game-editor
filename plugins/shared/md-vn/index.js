'use strict';

const scene = require('./scene-schema');
const font = require('./font');

function validateCanonicalSceneDocument(sceneDocument, catalog = null, options = {}) {
  return scene.validateSceneDocument(sceneDocument, catalog, options);
}

function createFontSubsetPlan(sceneDocument, profileFont, sourceBuffer) {
  return font.createFontPlan(sceneDocument, profileFont, sourceBuffer);
}

function compileSceneProject(snapshot, options = {}) {
  // Lazy load avoids coupling renderer/editor validation to builder codegen.
  return require('./compiler').generateProject(snapshot, options);
}

module.exports = {
  ...scene,
  font,
  validateCanonicalSceneDocument,
  createFontSubsetPlan,
  compileSceneProject,
};
