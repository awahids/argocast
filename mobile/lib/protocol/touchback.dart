// Touchback: the panel sends its touches back over TCP to control_port
// (default 38767). Port of src/touchback.js; see spec §4c.
//
//   u8 type, u8 n
//   type 3          -> key; n = Android keycode
//   other (1..10)   -> n points × 6 bytes: u8 id (7 bit), u8 action
//                      (0 down, 1 up, 2 move), u16 x, u16 y big-endian 0..65535
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

const feedbackPort = 38767;
const typeTouch = 0;
const typeKey = 3;

abstract final class TouchAction {
  static const down = 0, up = 1, move = 2;
}

class TouchPoint {
  const TouchPoint(this.id, this.action, this.x, this.y);
  final int id, action, x, y;
  @override
  bool operator ==(Object other) =>
      other is TouchPoint && other.id == id && other.action == action && other.x == x && other.y == y;
  @override
  int get hashCode => Object.hash(id, action, x, y);
  @override
  String toString() => 'TouchPoint($id, $action, $x, $y)';
}

sealed class FeedbackEvent {
  const FeedbackEvent();
}

class PanelTouch extends FeedbackEvent {
  const PanelTouch(this.points, {this.mouse = false});
  final List<TouchPoint> points;
  final bool mouse;

  /// [id, action, x, y, ...] for the platform channel.
  Int32List flatten() {
    final out = Int32List(points.length * 4);
    for (var i = 0; i < points.length; i++) {
      final p = points[i];
      out.setAll(i * 4, [p.id, p.action, p.x, p.y]);
    }
    return out;
  }
}

class PanelKey extends FeedbackEvent {
  const PanelKey(this.keycode);
  final int keycode;
}

/// Incremental parser for the touchback stream.
class FeedbackParser {
  final _buf = BytesBuilder(copy: false);
  Uint8List _pending = Uint8List(0);

  List<FeedbackEvent> push(List<int> chunk) {
    _buf.add(_pending);
    _buf.add(chunk);
    var b = _buf.takeBytes();
    var o = 0;
    final out = <FeedbackEvent>[];
    while (b.length - o >= 2) {
      final type = b[o], n = b[o + 1];
      if (type == typeKey) {
        out.add(PanelKey(n));
        o += 2;
        continue;
      }
      if (n < 1 || n > 10) {
        o += 2; // resync like the original
        continue;
      }
      final need = 2 + n * 6;
      if (b.length - o < need) break;
      final points = <TouchPoint>[];
      for (var i = 0; i < n; i++) {
        final p = o + 2 + i * 6;
        points.add(TouchPoint(b[p] & 0x7f, b[p + 1], (b[p + 2] << 8) | b[p + 3], (b[p + 4] << 8) | b[p + 5]));
      }
      out.add(PanelTouch(points, mouse: type != typeTouch));
      o += need;
    }
    _pending = Uint8List.sublistView(b, o);
    return out;
  }
}

/// Builds one touch packet (tests / mock panel).
Uint8List encodeTouch(List<TouchPoint> points, {int type = typeTouch}) {
  final b = Uint8List(2 + points.length * 6);
  b[0] = type;
  b[1] = points.length;
  for (var i = 0; i < points.length; i++) {
    final p = points[i], o = 2 + i * 6;
    b[o] = p.id & 0x7f;
    b[o + 1] = p.action;
    b[o + 2] = p.x >> 8;
    b[o + 3] = p.x & 0xff;
    b[o + 4] = p.y >> 8;
    b[o + 5] = p.y & 0xff;
  }
  return b;
}

Uint8List encodeKey(int keycode) => Uint8List.fromList([typeKey, keycode]);

/// Read-only TCP client for the panel's control_port.
class FeedbackClient {
  FeedbackClient._(this._sock, void Function(FeedbackEvent) onEvent) {
    final parser = FeedbackParser();
    _sock.listen(
      (data) {
        for (final e in parser.push(data)) {
          onEvent(e);
        }
      },
      onError: (Object _) => _finish(),
      onDone: _finish,
      cancelOnError: true,
    );
  }

  final Socket _sock;
  final _done = Completer<void>();

  /// Completes when the panel closes the connection.
  Future<void> get done => _done.future;

  void _finish() {
    if (!_done.isCompleted) _done.complete();
  }

  static Future<FeedbackClient> connect(
    String host,
    int port,
    void Function(FeedbackEvent) onEvent, {
    Duration timeout = const Duration(seconds: 3),
  }) async {
    final s = await Socket.connect(host, port, timeout: timeout);
    s.setOption(SocketOption.tcpNoDelay, true);
    return FeedbackClient._(s, onEvent);
  }

  void close() {
    _sock.destroy();
    _finish();
  }
}
