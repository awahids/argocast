import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:argocast/protocol/frame.dart';
import 'package:argocast/protocol/lrtsp.dart';
import 'package:argocast/protocol/session.dart';
import 'package:flutter_test/flutter_test.dart';

RequestBuilder rb() => RequestBuilder(serverIp: '192.168.1.50', deviceName: 'PHONE', uuid: 'u-1', os: 'Android');

void main() {
  group('LRTSP requests (same bytes as the desktop sender)', () {
    test('OPTIONS layout', () {
      const body = 'Version: sender v20210311\r\nOs: Android\r\nModel: PHONE\r\nuuid: u-1\r\nCode: 1234\r\n\r';
      expect(
        rb().options(pin: '1234'),
        'OPTIONS lrtsp://192.168.1.50 LRTSP/2.0\r\n'
        'Cseq: 1\r\n'
        'Content-Length: ${body.length}\r\n'
        'Content-Type: application/sdp\r\n'
        '$body',
      );
    });

    test('Cseq increments and SSRC follows', () {
      final r = rb();
      r.options();
      r.ssrc = '55667788';
      expect(r.setup(), 'SETUP lrtsp://192.168.1.50 LRTSP/2.0\r\nCseq: 2\r\nSSRC: 55667788\r\n\r');
      expect(r.active(), startsWith('ACTIVE lrtsp://192.168.1.50 LRTSP/2.0\r\nCseq: 3\r\n'));
    });

    test('ANNOUNCE SDP', () {
      final r = rb()..ssrc = '1';
      final msg = r.announce(width: 1088, height: 2400);
      expect(msg, contains('Width=integer:1088\r\nHeight=integer:2400\r\nMimetype=string:"video/avc"\r\n'));
      expect(msg, endsWith('AudioOn=integer:0\r\n\r'));
    });
  });

  group('responses', () {
    test('status, SSRC, Public, aeskey, Transport', () {
      final res = parseResponse('LRTSP/2.0 200 OK\r\nCseq: 3\r\nSSRC: 42\r\nSession: 42\r\n'
          'Public: ACTIVE,ANNOUNCE,SETUP\r\na=aeskey:string:abc\r\n'
          'Transport: RTP/TCP/unicast;rtp_port=9000;rtcp_port=9001;control_port=9002\r\n\r\n')!;
      expect(res.status, '200');
      expect(res.ssrc, '42');
      expect(res.aeskey, 'abc');
      expect(res.public, ['ACTIVE', 'ANNOUNCE', 'SETUP']);
      expect(res.transport.rtpPort, 9000);
      expect(res.transport.controlPort, 9002);
    });

    test('split keep-alives and concatenated replies', () {
      final parts = splitMessages('ACTIVE\r\nLRTSP/2.0 200 OK\r\n\r\nLRTSP/2.0 406 Code Unavailable\r\n\r\n');
      expect(parts.length, 3);
      expect(parts.first, isA<KeepAlive>());
      expect(parseResponse((parts[2] as RawMessage).raw)!.status, '406');
    });
  });

  test('16-byte frame header', () {
    final enc = FrameEncoder('305419896');
    final f = enc.encode(Uint8List.fromList([0xAA, 0xBB, 0xCC]), isKey: true, nowMs: 0x0102030405);
    expect(f.toList(), [0xE8, 1, 0, 0, 2, 3, 4, 5, 0x12, 0x34, 0x56, 0x78, 0, 0, 0, 3, 0xAA, 0xBB, 0xCC]);
    expect(enc.encode(Uint8List(1), isKey: false)[1], 2);
  });

  // End-to-end against the Node.js mock panel shared with the desktop app.
  group('against mock panel', () {
    Process? panel;
    const port = 48554, mediaPort = 48555;

    setUpAll(() async {
      final root = Directory.current.parent.path; // mobile/ -> repo root
      panel = await Process.start('node', ['mock/panel.js', '--port', '$port', '--media-port', '$mediaPort', '--pin', '2468', '--no-mdns'],
          workingDirectory: root, runInShell: Platform.isWindows);
      // Keep draining both pipes: closing them would kill node with EPIPE on its next log line.
      final ready = Completer<void>();
      panel!.stdout.transform(utf8.decoder).listen((l) {
        if (l.contains('listening') && !ready.isCompleted) ready.complete();
      });
      panel!.stderr.drain<void>();
      await ready.future.timeout(const Duration(seconds: 10));
    });

    tearDownAll(() => panel?.kill());

    test('wrong PIN is rejected', () async {
      final s = LrtspSession(host: '127.0.0.1', port: port, deviceName: 't', uuid: 'u');
      await s.connect();
      await expectLater(s.authenticate('0000'), throwsA(isA<LrtspException>().having((e) => e.status, 'status', '406')));
      s.destroy();
    });

    test('full session and frame delivery', () async {
      final s = LrtspSession(host: '127.0.0.1', port: port, deviceName: 't', uuid: 'u');
      await s.connect();
      final opt = await s.authenticate('2468');
      expect(opt.ssrc, isNotEmpty);
      final t = await s.startCast(width: 1088, height: 2400);
      expect(t.rtpPort, mediaPort);
      for (var i = 0; i < 20; i++) {
        s.sendAccessUnit(Uint8List.fromList([0, 0, 0, 1, i == 0 ? 0x65 : 0x41, 0x80, i]), isKey: i == 0);
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(s.framesSent, greaterThan(0));
      await s.stop();
    });
  });
}
