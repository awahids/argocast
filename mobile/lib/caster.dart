// Cast controller: native capture + LRTSP session, exposed as a ChangeNotifier.
import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'native.dart';
import 'protocol/session.dart';
import 'protocol/sharecode.dart';
import 'protocol/touchback.dart';
import 'settings.dart';

enum CastState { idle, preparing, waitingForUser, connecting, authenticating, starting, casting, stopping }

class Stats {
  const Stats({this.fps = 0, this.kbps = 0, this.frames = 0, this.dropped = 0});
  final int fps, kbps, frames, dropped;
}

class Caster extends ChangeNotifier {
  Caster(this.settings) {
    if (Platform.isIOS) _listenIOS();
  }
  final Settings settings;

  CastState state = CastState.idle;
  String? error;
  Panel? target;
  CaptureInfo? capture;
  DateTime? startedAt;
  Stats stats = const Stats();

  LrtspSession? _session;
  StreamSubscription<EncodedFrame>? _frames;
  Timer? _statsTimer;
  bool _cancelled = false;
  FeedbackClient? _feedback;

  /// Panel's touchback channel is open (Android).
  bool touchbackConnected = false;

  /// argocast's accessibility service is enabled, so touches can be injected.
  bool touchbackReady = false;

  bool get busy => state != CastState.idle;

  void _set(CastState s, {String? err}) {
    state = s;
    error = err;
    notifyListeners();
  }

  /// What the user typed or scanned: the panel's share code ("834 109"),
  /// an IP[:port] (then [pin] is used) or an airgocast:// / airgo.link QR link.
  Future<void> startWithCode(String input, {String pin = ''}) async {
    if (busy) return;
    final t = resolveTarget(input, await localIPv4s());
    if (t == null || t.candidates.isEmpty) {
      _set(CastState.idle, err: 'Kode tidak valid. Masukkan kode di layar panel (6 atau 8 karakter) atau alamat IP.');
      return;
    }
    target = Panel(name: t.name ?? 'Panel ${input.trim()}', host: t.candidates.first, port: t.port);
    _set(CastState.connecting);
    // 6/8-digit codes only fix the last two octets: probe one candidate per local /16.
    final host = await firstReachable(t.candidates, t.port);
    if (host == null) {
      _set(
        CastState.idle,
        err: 'Panel dengan kode ini tidak ditemukan. Pastikan ponsel dan panel di jaringan Wi-Fi yang sama.',
      );
      return;
    }
    state = CastState.idle; // hand over to the normal flow
    await start(Panel(name: t.name ?? 'Panel $host', host: host, port: t.port), t.pin.isNotEmpty ? t.pin : pin);
  }

  Future<void> start(Panel panel, String pin) async {
    if (busy) return;
    if (Platform.isIOS) return _startIOS(panel, pin);
    _cancelled = false;
    target = panel;
    try {
      // 1. Screen-capture consent first, so a refusal never leaves a half-open panel session.
      _set(CastState.preparing);
      final info = await NativeBridge.startCapture(
        maxSize: settings.maxSize,
        fps: settings.fps,
        bitrateKbps: settings.bitrateKbps,
      );
      capture = info;
      // Frames start flowing immediately; drop them until the media socket is open.
      _frames = NativeBridge.frames().listen(
        (f) => _session?.sendAccessUnit(f.data, isKey: f.isKey),
        onError: (Object e) => _fail('Tangkap layar berhenti: ${e is PlatformException ? e.message : e}'),
      );
      if (_cancelled) throw _Cancelled();

      // 2. Control session.
      _set(CastState.connecting);
      final s = LrtspSession(host: panel.host, port: panel.port, deviceName: settings.deviceName, uuid: settings.uuid);
      _session = s;
      await s.connect();
      unawaited(
        s.closed.then((err) {
          if (identical(_session, s) && state == CastState.casting) {
            _fail(err == null ? 'Panel menutup koneksi.' : 'Koneksi terputus: $err');
          }
        }),
      );
      if (_cancelled) throw _Cancelled();
      _set(CastState.authenticating);
      await s.authenticate(pin.isEmpty ? null : pin);
      if (_cancelled) throw _Cancelled();
      _set(CastState.starting);
      final tr = await s.startCast(width: info.width, height: info.height, framerate: settings.fps);
      await NativeBridge.requestKeyFrame();
      if (settings.touchback) unawaited(_startTouchback(s, panel.host, tr.controlPort ?? feedbackPort));

      startedAt = DateTime.now();
      _startStats();
      await settings.addRecent(panel);
      _set(CastState.casting);
    } on _Cancelled {
      await _cleanup();
      _set(CastState.idle);
    } catch (e) {
      await _cleanup();
      _set(CastState.idle, err: _friendly(e));
    }
  }

  // ---------------------------------------------------------- touchback ---

  Future<void> _startTouchback(LrtspSession s, String host, int port) async {
    await refreshTouchback();
    try {
      final fb = await FeedbackClient.connect(host, port, _onFeedback);
      if (!identical(_session, s)) {
        fb.close();
        return;
      }
      _feedback = fb;
      touchbackConnected = true;
      notifyListeners();
      unawaited(
        fb.done.then((_) {
          if (identical(_feedback, fb)) {
            touchbackConnected = false;
            notifyListeners();
          }
        }),
      );
    } catch (_) {
      // Panels without touchback simply refuse; casting goes on.
    }
  }

  void _onFeedback(FeedbackEvent e) {
    if (!touchbackReady) return;
    switch (e) {
      case PanelTouch():
        NativeBridge.touch(e.flatten()).ignore();
      case PanelKey():
        NativeBridge.key(e.keycode).ignore();
    }
  }

  /// Re-reads whether the accessibility service is on (the user may have just enabled it).
  Future<void> refreshTouchback() async {
    if (!Platform.isAndroid) return;
    bool ready;
    try {
      ready = await NativeBridge.touchbackEnabled();
    } catch (_) {
      ready = false;
    }
    if (ready != touchbackReady) {
      touchbackReady = ready;
      notifyListeners();
    }
  }

  void _startStats() {
    var lastFrames = 0, lastBytes = 0;
    _statsTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      final s = _session;
      if (s == null) return;
      stats = Stats(
        fps: s.framesSent - lastFrames,
        kbps: ((s.bytesSent - lastBytes) * 8 / 1000).round(),
        frames: s.framesSent,
        dropped: s.framesDropped,
      );
      lastFrames = s.framesSent;
      lastBytes = s.bytesSent;
      notifyListeners();
    });
  }

  Future<void> _fail(String message) async {
    if (state == CastState.idle || state == CastState.stopping) return;
    await _cleanup();
    _set(CastState.idle, err: message);
  }

  // ---------------------------------------------------------------- iOS ---
  // The extension owns the panel session; we only hand over the target and
  // mirror the status it publishes.

  Future<void> _startIOS(Panel panel, String pin) async {
    target = panel;
    try {
      _set(CastState.preparing);
      await NativeBridge.prepareBroadcast(
        panel: panel,
        pin: pin,
        maxSize: settings.maxSize,
        fps: settings.fps,
        bitrateKbps: settings.bitrateKbps,
      );
      _set(CastState.waitingForUser);
      await NativeBridge.showBroadcastPicker();
    } catch (e) {
      _set(CastState.idle, err: _friendly(e));
    }
  }

  /// Re-opens the system broadcast sheet (if the user dismissed it).
  Future<void> reopenPicker() => NativeBridge.showBroadcastPicker();

  void _listenIOS() {
    NativeBridge.broadcastStatus().listen((s) {
      stats = Stats(fps: s.fps, kbps: s.kbps);
      if (s.isError) {
        if (state != CastState.idle) _set(CastState.idle, err: s.errorMessage);
        return;
      }
      final next = switch (s.code) {
        BroadcastStatus.connecting => CastState.connecting,
        BroadcastStatus.authenticating => CastState.authenticating,
        BroadcastStatus.starting => CastState.starting,
        BroadcastStatus.casting => CastState.casting,
        BroadcastStatus.waiting => state == CastState.idle ? CastState.idle : CastState.waitingForUser,
        _ => CastState.idle,
      };
      if (next == CastState.casting && state != CastState.casting) startedAt = DateTime.now();
      if (next != state) {
        _set(next);
      } else {
        notifyListeners();
      }
    });
  }

  Future<void> stop() async {
    if (state == CastState.idle) return;
    if (Platform.isIOS) {
      await NativeBridge.stopBroadcast();
      _set(CastState.idle);
      return;
    }
    if (state != CastState.casting) {
      _cancelled = true;
      _session?.destroy();
    }
    _set(CastState.stopping);
    await _cleanup();
    _set(CastState.idle);
  }

  Future<void> _cleanup() async {
    _statsTimer?.cancel();
    _statsTimer = null;
    _feedback?.close();
    _feedback = null;
    if (touchbackConnected) {
      touchbackConnected = false;
      NativeBridge.touchReset().ignore();
    }
    await _frames?.cancel();
    _frames = null;
    try {
      await NativeBridge.stopCapture();
    } catch (_) {}
    final s = _session;
    _session = null;
    await s?.stop();
    stats = const Stats();
  }

  String _friendly(Object e) {
    if (e is PlatformException) {
      if (e.code == 'denied') return 'Izin merekam layar ditolak.';
      return e.message ?? e.code;
    }
    if (e is LrtspException) return e.message;
    final text = e.toString();
    if (text.contains('Connection refused')) return 'Panel menolak koneksi. Periksa IP dan port.';
    if (text.contains('timed out') || text.contains('No route') || text.contains('unreachable')) {
      return 'Panel tidak dapat dijangkau. Pastikan satu jaringan Wi-Fi.';
    }
    return text.substring(0, min(text.length, 160));
  }
}

class _Cancelled implements Exception {}
