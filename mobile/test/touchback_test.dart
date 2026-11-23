import 'dart:io';
import 'dart:typed_data';

import 'package:argocast/protocol/touchback.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses touch packets split across chunks, and keys', () {
    final p = FeedbackParser();
    final pkt = encodeTouch(const [
      TouchPoint(1, TouchAction.down, 0x1234, 0xfffe),
      TouchPoint(2, TouchAction.move, 0, 65535),
    ]);
    final bytes = [...pkt, ...encodeKey(0x17)];
    expect(p.push(bytes.sublist(0, 5)), isEmpty);
    final out = p.push(bytes.sublist(5));
    expect(out, hasLength(2));
    final t = out[0] as PanelTouch;
    expect(t.mouse, isFalse);
    expect(t.points, const [TouchPoint(1, 0, 0x1234, 0xfffe), TouchPoint(2, 2, 0, 65535)]);
    expect(t.flatten(), Int32List.fromList([1, 0, 0x1234, 0xfffe, 2, 2, 0, 65535]));
    expect((out[1] as PanelKey).keycode, 0x17);
  });

  test('mouse-mode type and resync on a bad count', () {
    final p = FeedbackParser();
    final out = p.push([
      0,
      0,
      ...encodeTouch(const [TouchPoint(0x85, 1, 10, 20)], type: 1),
    ]);
    expect(out, hasLength(1));
    final t = out.single as PanelTouch;
    expect(t.mouse, isTrue);
    expect(t.points.single, const TouchPoint(5, 1, 10, 20)); // id keeps the low 7 bits
  });

  test('FeedbackClient reads events from the panel control port', () async {
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((s) {
      s.add(encodeTouch(const [TouchPoint(0, TouchAction.down, 100, 200)]));
      s.add(encodeKey(4));
      s.close();
    });
    final events = <FeedbackEvent>[];
    final fb = await FeedbackClient.connect('127.0.0.1', server.port, events.add);
    await fb.done.timeout(const Duration(seconds: 3));
    expect(events, hasLength(2));
    expect((events[0] as PanelTouch).points.single, const TouchPoint(0, 0, 100, 200));
    expect((events[1] as PanelKey).keycode, 4);
    await server.close();
  });
}
