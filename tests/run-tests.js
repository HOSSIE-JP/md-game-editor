'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadAppConfig } = require('../app-config');

loadAppConfig(require('../app.config'));

function collectTestFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectTestFiles(fullPath);
      }
      if (entry.isFile() && entry.name.endsWith('.test.js')) {
        const mdExcludedAfterSplit = new Set(['pce-asset-manager.test.js', 'pce-setup-manager.test.js']);
        if (mdExcludedAfterSplit.has(entry.name)) return [];
        return [fullPath];
      }
      return [];
    })
    .sort((left, right) => left.localeCompare(right, 'en'));
}

for (const testFile of collectTestFiles(__dirname)) {
  require(testFile);
}
