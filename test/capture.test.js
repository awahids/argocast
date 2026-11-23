import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopInput, parseMacScreenIndex } from '../src/capture.js';

test('Windows grabs the desktop with gdigrab', () => {
  const args = desktopInput({ ffmpeg: 'ffmpeg', fps: 30, platform: 'win32' });
  assert.deepEqual(args.slice(0, 2), ['-f', 'gdigrab']);
  assert.equal(args.at(-1), 'desktop');
});

test('macOS screen index is parsed from the avfoundation device list', () => {
  const listing = `[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] FaceTime HD Camera
[AVFoundation indev @ 0x1] [1] OBS Virtual Camera
[AVFoundation indev @ 0x1] [2] Capture screen 0
[AVFoundation indev @ 0x1] [3] Capture screen 1
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone`;
  assert.equal(parseMacScreenIndex(listing), 2);
});

test('macOS falls back to index 1 when the list is unavailable', () => {
  assert.equal(parseMacScreenIndex(''), 1);
});
