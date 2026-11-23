// LRTSP control session: OPTIONS -> ANNOUNCE -> SETUP -> PLAY, 5 s ACTIVE
// heartbeat, TEARDOWN on stop; media over a second TCP socket to rtp_port.
// Port of src/session.js.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'frame.dart';
import 'lrtsp.dart';

const _heartbeat = Duration(seconds: 5);

class LrtspException implements Exception {
  LrtspException(this.message, [this.status]);
  final String message;
  final String? status;
  @override
  String toString() => message;
}

class _Waiter {
  _Waiter(this.cseq);
  final String? cseq;
  final completer = Completer<LrtspResponse>();
}

class LrtspSession {
  LrtspSession({
    required this.host,
    required this.port,
    required String deviceName,
    required String uuid,
    this.timeout = const Duration(seconds: 8),
    this.log,
  }) : req = RequestBuilder(serverIp: host, deviceName: deviceName, uuid: uuid);

  final String host;
  final int port;
  final Duration timeout;
  final void Function(String)? log;
  final RequestBuilder req;

  Socket? _sock;
  Socket? _media;
  FrameEncoder? _encoder;
  Timer? _heartbeatTimer;
  final _waiters = <_Waiter>[];
  final _closed = Completer<Object?>();
  List<String> capabilities = const [];
  Transport transport = Transport();
  String aeskey = '';

  /// Completes (with the error, or null) when the control connection closes.
  Future<Object?> get closed => _closed.future;
  bool get mediaReady => _media != null;

  Future<void> connect() async {
    final s = await Socket.connect(host, port, timeout: timeout);
    s.setOption(SocketOption.tcpNoDelay, true);
    _sock = s;
    s.listen(
      (data) => _onData(utf8.decode(data, allowMalformed: true)),
      onError: (Object e) => _onClose(e),
      onDone: () => _onClose(null),
      cancelOnError: true,
    );
  }

  void _onData(String text) {
    log?.call('<< ${jsonEncode(text)}');
    for (final msg in splitMessages(text)) {
      if (msg is! RawMessage) continue;
      final res = parseResponse(msg.raw);
      if (res == null) continue;
      final cseq = res.cseq;
      final i = cseq != null ? _waiters.indexWhere((w) => w.cseq == cseq) : (_waiters.isEmpty ? -1 : 0);
      if (i < 0) continue; // unsolicited (e.g. heartbeat reply)
      _waiters.removeAt(i).completer.complete(res);
    }
  }

  void _onClose(Object? err) {
    _heartbeatTimer?.cancel();
    for (final w in _waiters) {
      if (!w.completer.isCompleted) w.completer.completeError(err ?? LrtspException('Koneksi kontrol tertutup.'));
    }
    _waiters.clear();
    if (!_closed.isCompleted) _closed.complete(err);
  }

  Future<LrtspResponse> _send(String text) {
    log?.call('>> ${jsonEncode(text)}');
    final w = _Waiter(RegExp(r'Cseq: (\d+)').firstMatch(text)?.group(1));
    _waiters.add(w);
    _sock!.write(text);
    return w.completer.future.timeout(timeout, onTimeout: () {
      _waiters.remove(w);
      throw LrtspException('Panel tidak menjawab ${text.split(' ').first}.');
    });
  }

  static const _statusText = {
    LrtspStatus.unauthorized: 'Panel menolak (tidak diizinkan).',
    LrtspStatus.codeUnavailable: 'PIN salah.',
    LrtspStatus.busy: 'Panel sedang sibuk atau koneksi penuh.',
    LrtspStatus.internalError: 'Panel mengalami kesalahan internal.',
  };

  Future<LrtspResponse> _expectOk(String text) async {
    final res = await _send(text);
    if (res.status != LrtspStatus.ok) {
      throw LrtspException(_statusText[res.status] ?? 'Panel menjawab status ${res.status}.', res.status);
    }
    return res;
  }

  /// OPTIONS with PIN; keeps the SSRC and starts the heartbeat.
  Future<LrtspResponse> authenticate(String? pin) async {
    final res = await _expectOk(req.options(pin: pin));
    if (res.ssrc.isNotEmpty) req.ssrc = res.ssrc;
    capabilities = res.public;
    _heartbeatTimer = Timer.periodic(_heartbeat, (_) {
      if (_waiters.isEmpty) _sock?.write(req.active());
    });
    return res;
  }

  /// ANNOUNCE -> SETUP -> PLAY, then opens the media socket.
  Future<Transport> startCast({required int width, required int height, int framerate = 30}) async {
    final ann = await _expectOk(req.announce(width: width, height: height, framerate: framerate));
    aeskey = ann.aeskey;
    final setup = await _expectOk(req.setup());
    transport = ann.transport.merge(setup.transport);
    await _expectOk(req.play());
    final rtp = transport.rtpPort;
    if (rtp == null) throw LrtspException('Panel tidak mengirim rtp_port.');
    final m = await Socket.connect(host, rtp, timeout: timeout);
    m.setOption(SocketOption.tcpNoDelay, true);
    m.listen((_) {}, onError: (_) {}, cancelOnError: true);
    _media = m;
    _encoder = FrameEncoder(req.ssrc);
    return transport;
  }

  bool _flushing = false;
  Uint8List? _pendingKey;
  int framesSent = 0;
  int framesDropped = 0;
  int bytesSent = 0;

  /// Sends one H.264 access unit. While the socket is still flushing, delta
  /// frames are dropped and the newest key frame is kept for the next slot.
  void sendAccessUnit(Uint8List data, {required bool isKey}) {
    if (_media == null) return;
    if (_flushing) {
      framesDropped++;
      if (isKey) _pendingKey = data;
      return;
    }
    _write(data, isKey);
  }

  void _write(Uint8List data, bool isKey) {
    final m = _media;
    if (m == null) return;
    _flushing = true;
    m.add(_encoder!.encode(data, isKey: isKey));
    framesSent++;
    bytesSent += data.length;
    m.flush().then((_) {
      _flushing = false;
      final k = _pendingKey;
      _pendingKey = null;
      if (k != null) _write(k, true);
    }, onError: (Object _) {
      _flushing = false;
    });
  }

  Future<void> stop() async {
    _heartbeatTimer?.cancel();
    try {
      await _media?.close();
    } catch (_) {}
    _media = null;
    final s = _sock;
    if (s != null && !_closed.isCompleted) {
      try {
        await _send(req.teardown()).timeout(const Duration(seconds: 2));
      } catch (_) {}
      try {
        await s.close();
      } catch (_) {}
    }
  }

  void destroy() {
    _heartbeatTimer?.cancel();
    _media?.destroy();
    _sock?.destroy();
  }
}
