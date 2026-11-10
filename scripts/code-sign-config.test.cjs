const test = require('node:test');
const assert = require('node:assert/strict');

test('release signing delegates hash and timestamp arguments to windows-sign', () => {
  const previous = process.env.CLOUDMEET_CODESIGN_PFX;
  process.env.CLOUDMEET_CODESIGN_PFX = 'test-only.pfx';
  try {
    const config = require('../forge.config.js');
    const signing = config.packagerConfig.windowsSign;
    assert.equal(signing.certificateFile, 'test-only.pfx');
    assert.equal(signing.signWithParams, undefined);
    assert.equal(signing.timestampServer, 'http://timestamp.digicert.com');
  } finally {
    if (previous === undefined) delete process.env.CLOUDMEET_CODESIGN_PFX;
    else process.env.CLOUDMEET_CODESIGN_PFX = previous;
  }
});
