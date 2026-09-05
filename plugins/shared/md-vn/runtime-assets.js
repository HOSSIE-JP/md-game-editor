'use strict';

const fs = require('node:fs');
const path = require('node:path');

// MD Novel remains the proven implementation owner, but consumers use this
// shared facade so the runtime ABI, message sprites and bundled Japanese font
// cannot drift between game plugins.
const NOVEL_TEMPLATE_ROOT = path.join(__dirname, '..', '..', 'md-novel-builder', 'template');

const MESSAGE_SHAPE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAABlBMVEUAAAD///+l2Z/dAAAAAnRSTlMA/1uRIrUAAAAWSURBVHjaY2AkABhGFYwqGFUwUhUAAESYBAF9lrJwAAAAAElFTkSuQmCC',
  'base64',
);

const RUNTIME_FILES = Object.freeze({
  'src/novel_runtime/novel_runtime.c': 'src/novel_runtime/novel_runtime.c',
  'inc/novel_runtime/novel_runtime.h': 'inc/novel_runtime/novel_runtime.h',
  'res/novel/system/message-shapes.png': null,
});

function templatePath(relativePath) {
  return path.join(NOVEL_TEMPLATE_ROOT, String(relativePath || '').replace(/\//g, path.sep));
}

function bundledAtlasPath() {
  return templatePath('res/novel/font/JF-Dot-Shinonome16-atlas.png');
}

function bundledFontPath() {
  return templatePath('res/novel/font/JF-Dot-Shinonome16.ttf');
}

function collectRuntimeFiles() {
  const files = {};
  for (const [target, source] of Object.entries(RUNTIME_FILES)) {
    files[target] = source ? fs.readFileSync(templatePath(source)) : MESSAGE_SHAPE_PNG;
  }
  return files;
}

module.exports = {
  NOVEL_TEMPLATE_ROOT,
  MESSAGE_SHAPE_PNG,
  RUNTIME_FILES,
  templatePath,
  bundledAtlasPath,
  bundledFontPath,
  collectRuntimeFiles,
};
