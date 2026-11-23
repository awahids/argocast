import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestBuilder, parseResponse, splitMessages, parseRequest } from '../src/lrtsp.js';

const rb = () => new RequestBuilder({ serverIp: '192.168.1.50', deviceName: 'LAPTOP', uuid: 'u-1', os: 'Windows' });

test('OPTIONS matches the Android client layout', () => {
  const msg = rb().options({ pin: '1234' });
  const body = 'Version: sender v20210311\r\nOs: Windows\r\nModel: LAPTOP\r\nuuid: u-1\r\nCode: 1234\r\n\r';
  assert.equal(msg,
    'OPTIONS lrtsp://192.168.1.50 LRTSP/2.0\r\n'
    + 'Cseq: 1\r\n'
    + `Content-Length: ${body.length}\r\n`
    + 'Content-Type: application/sdp\r\n'
    + body);
});

test('PIN typed as shown on the panel ("834 109") is sent as digits only', () => {
  assert.match(rb().options({ pin: ' 834 109 ' }), /\r\nCode: 834109\r\n\r$/);
  assert.match(rb().options({ pin: '834-109' }), /\r\nCode: 834109\r\n\r$/);
});

test('Cseq increments and SSRC is sent once known', () => {
  const r = rb();
  r.options({ pin: '' });
  r.ssrc = '55667788';
  assert.equal(r.setup(), 'SETUP lrtsp://192.168.1.50 LRTSP/2.0\r\nCseq: 2\r\nSSRC: 55667788\r\n\r');
  assert.match(r.play(), /^PLAY .*\r\nCseq: 3\r\n/);
  assert.match(r.active(), /^ACTIVE lrtsp:\/\/192\.168\.1\.50 LRTSP\/2\.0\r\nCseq: 4\r\nSSRC: 55667788\r\n\r$/);
});

test('ANNOUNCE carries the SDP fields', () => {
  const r = rb();
  r.ssrc = '1';
  const msg = r.announce({ width: 1920, height: 1080, framerate: 30, audio: false });
  assert.match(msg, /m=video 0 LRTP\/AVP 116\r\nWidth=integer:1920\r\nHeight=integer:1080\r\nMimetype=string:"video\/avc"\r\nFramerate=integer:30\r\nAudioOn=integer:0\r\n\r$/);
  const sdp = msg.slice(msg.indexOf('m=video'), msg.length - 3);
  assert.match(msg, new RegExp(`Content-Length: ${sdp.length}\\r\\n`));
});

test('parseResponse reads status, SSRC, Public, aeskey and Transport', () => {
  const res = parseResponse(
    'LRTSP/2.0 200 OK\r\nCseq: 3\r\nSSRC: 42\r\nSession: 42\r\n'
    + 'Public: ACTIVE,ANNOUNCE,SETUP,PLAY,MODERATOR_CONTROL\r\n'
    + 'a=aeskey:string:abcdef\r\n'
    + 'Transport: RTP/TCP/unicast;rtp_port=9000;rtcp_port=9001;control_port=9002\r\n\r\n');
  assert.equal(res.status, '200');
  assert.equal(res.ssrc, '42');
  assert.equal(res.session, '42');
  assert.equal(res.aeskey, 'abcdef');
  assert.deepEqual(res.public, ['ACTIVE', 'ANNOUNCE', 'SETUP', 'PLAY', 'MODERATOR_CONTROL']);
  assert.equal(res.transport.rtp_port, 9000);
  assert.equal(res.transport.rtcp_port, 9001);
  assert.equal(res.transport.control_port, 9002);
});

test('parseResponse tolerates headers without a space after the colon', () => {
  const res = parseResponse('LRTSP/2.0 406 Code Unavailable\r\nCseq:1\r\nSSRC:7\r\n\r\n');
  assert.equal(res.status, '406');
  assert.equal(res.ssrc, '7');
});

test('splitMessages separates concatenated replies and keep-alives', () => {
  const parts = splitMessages('ACTIVE\r\nLRTSP/2.0 200 OK\r\nCseq: 1\r\n\r\nLRTSP/2.0 401 Unauthorized\r\n\r\n');
  assert.equal(parts.length, 3);
  assert.ok(parts[0].keepalive);
  assert.equal(parseResponse(parts[1].raw).status, '200');
  assert.equal(parseResponse(parts[2].raw).status, '401');
});

test('parseRequest extracts PIN and announce fields (mock panel side)', () => {
  const r = rb();
  const opt = parseRequest(r.options({ pin: '9876' }));
  assert.equal(opt.method, 'OPTIONS');
  assert.equal(opt.headers.cseq, '1');
  assert.equal(opt.fields.code, '9876');
  r.ssrc = '5';
  const ann = parseRequest(r.announce({ width: 1280, height: 720 }));
  assert.equal(ann.fields.width, '1280');
  assert.equal(ann.fields.mimetype, 'video/avc');
});
