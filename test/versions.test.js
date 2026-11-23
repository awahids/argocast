import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, pickMacRelease } from '../src/versions.js';

test('compareVersions orders x.y.z and ignores v / suffix', () => {
  assert.equal(compareVersions('0.3.1', '0.3.0'), 1);
  assert.equal(compareVersions('v0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.3.0', 'v0.3.0'), 0);
  assert.equal(compareVersions('0.3.0-beta', '0.3.0'), 0);
  assert.equal(compareVersions('1.0', '1.0.1'), -1);
});

test('pickMacRelease picks the newest release with a DMG for this arch', () => {
  const rel = (tag, names, extra = {}) => ({
    tag_name: tag, html_url: `https://x/${tag}`, draft: false, ...extra,
    assets: names.map((name) => ({ name, size: 10, browser_download_url: `https://dl/${name}` })),
  });
  const releases = [
    rel('v0.5.0', ['argocast-0.5.0-mac-arm64.dmg'], { draft: true }),
    rel('v0.4.1', ['argocast-Setup-0.4.1.exe']), // no mac build
    rel('v0.4.0', ['argocast-0.4.0-mac-arm64.dmg', 'argocast-0.4.0-mac-x64.dmg']),
    rel('v0.3.1', ['argocast-0.3.1-mac-arm64.dmg']),
    rel('v0.3.0', ['argocast-0.3.0-mac-arm64.dmg']),
  ];
  assert.deepEqual(pickMacRelease(releases, '0.3.0', 'arm64'), {
    version: '0.4.0', url: 'https://dl/argocast-0.4.0-mac-arm64.dmg', size: 10, page: 'https://x/v0.4.0',
  });
  assert.equal(pickMacRelease(releases, '0.3.0', 'x64').version, '0.4.0');
  assert.equal(pickMacRelease(releases, '0.4.0', 'arm64'), null);
});
