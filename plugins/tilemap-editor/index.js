'use strict';

const manifest = require('./manifest.json');

function getTab() {
  return {
    id: manifest.id,
    label: manifest.tab?.label || manifest.name,
    icon: manifest.tab?.icon || 'grid',
    mountType: manifest.tab?.page || manifest.id,
  };
}

function onActivate(_payload, context = {}) {
  context?.logger?.debug?.('tilemap-editor activated');
  return { ok: true };
}

function onDeactivate(_payload, context = {}) {
  context?.logger?.debug?.('tilemap-editor deactivated');
  return { ok: true };
}

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
};
