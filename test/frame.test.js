import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameEncoder, FrameDecoder, AccessUnitSplitter, MAGIC } from '../src/frame.js';

test('16-byte header layout matches the Android helper', () => {
  const enc = new FrameEncoder('305419896'); // 0x12345678
  const buf = enc.encode(Buffer.from([0xaa, 0xbb, 0xcc]), true, 0x0102030405);
  assert.deepEqual([...buf], [
    MAGIC, 0x01,             // magic, key frame
    0x00, 0x00,              // seq 0
    0x02, 0x03, 0x04, 0x05,  // low 32 bits of ms
    0x12, 0x34, 0x56, 0x78,  // ssrc
    0x00, 0x00, 0x00, 0x03,  // length
    0xaa, 0xbb, 0xcc,
  ]);
  const next = enc.encode(Buffer.from([1]), false, 0);
  assert.equal(next[1], 0x02);
  assert.equal(next.readUInt16BE(2), 1);
});

test('decoder reassembles frames split across TCP reads', () => {
  const enc = new FrameEncoder('7');
  const a = enc.encode(Buffer.alloc(100, 1), true);
  const b = enc.encode(Buffer.alloc(50, 2), false);
  const wire = Buffer.concat([a, b]);
  const dec = new FrameDecoder();
  const got = [...dec.push(wire.subarray(0, 10)), ...dec.push(wire.subarray(10, 130)), ...dec.push(wire.subarray(130))];
  assert.equal(got.length, 2);
  assert.equal(got[0].payload.length, 100);
  assert.equal(got[1].seq, 1);
  assert.equal(got[1].ssrc, 7);
});

const nal = (type, firstMb = true, size = 4) =>
  Buffer.concat([Buffer.from([0, 0, 0, 1, type]), Buffer.from([firstMb ? 0x80 : 0x40]), Buffer.alloc(size, 0x11)]);

test('access-unit splitter groups SPS/PPS/IDR and splits delta frames', () => {
  const sp = new AccessUnitSplitter();
  const stream = Buffer.concat([
    nal(0x67), nal(0x68), nal(0x65),   // SPS PPS IDR  → AU 1 (key)
    nal(0x41),                          // slice        → AU 2
    nal(0x41), nal(0x41, false),        // two slices of one picture → AU 3
    nal(0x67), nal(0x68), nal(0x65),   // next IDR     → AU 4 (key)
  ]);
  // feed in awkward pieces
  const out = [];
  for (let i = 0; i < stream.length; i += 7) out.push(...sp.push(stream.subarray(i, i + 7)));
  out.push(...sp.end());
  assert.deepEqual(out.map((a) => a.isKey), [true, false, false, true]);
  assert.equal(out[0].data.length, nal(0x67).length * 3);
  assert.equal(out[2].data.length, nal(0x41).length * 2);
});
