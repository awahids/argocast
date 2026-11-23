// Bridge to the Kotlin side (MainActivity / CaptureService / Discovery).
import 'dart:async';

import 'package:flutter/services.dart';

class Panel {
  Panel({required this.name, required this.host, required this.port});
  final String name;
  final String host;
  final int port;

  Map<String, Object> toJson() => {'name': name, 'host': host, 'port': port};
  static Panel fromJson(Map<dynamic, dynamic> m) =>
      Panel(name: m['name'] as String, host: m['host'] as String, port: (m['port'] as num).toInt());
}

class EncodedFrame {
  EncodedFrame(this.data, this.isKey);
  final Uint8List data;
  final bool isKey;
}

class BroadcastStatus {
  BroadcastStatus(this.code, this.fps, this.kbps);
  final int code, fps, kbps;

  static const idle = 0, waiting = 1, connecting = 2, authenticating = 3, starting = 4, casting = 5;
  bool get isError => code >= 100;

  String get errorMessage => switch (code) {
        100 => 'PIN salah.',
        101 => 'Panel sedang sibuk atau koneksi penuh.',
        102 => 'Panel menolak (tidak diizinkan).',
        103 => 'Panel tidak dapat dijangkau atau koneksi terputus. Pastikan satu jaringan Wi-Fi.',
        105 => 'Cast dihentikan.',
        _ => 'Siaran gagal. Coba lagi.',
      };
}

class CaptureInfo {
  CaptureInfo(this.width, this.height);
  final int width;
  final int height;
}

class NativeBridge {
  static const _ch = MethodChannel('argocast/native');
  static const _frames = EventChannel('argocast/frames');

  /// mDNS browse for `_airgo._tcp` via Android NsdManager.
  static Future<List<Panel>> discover({Duration timeout = const Duration(seconds: 3)}) async {
    final list = await _ch.invokeListMethod<Map<dynamic, dynamic>>('discover', {'timeoutMs': timeout.inMilliseconds});
    return (list ?? const []).map(Panel.fromJson).toList();
  }

  /// Asks for screen-capture consent, starts the foreground service and the
  /// H.264 encoder. Returns the encoded size, or throws PlatformException
  /// (code "denied" when the user refuses).
  static Future<CaptureInfo> startCapture({required int maxSize, required int fps, required int bitrateKbps}) async {
    final r = await _ch.invokeMapMethod<String, Object>('startCapture', {
      'maxSize': maxSize,
      'fps': fps,
      'bitrate': bitrateKbps * 1000,
    });
    return CaptureInfo((r!['width'] as num).toInt(), (r['height'] as num).toInt());
  }

  // ---- iOS: the panel session runs inside the Broadcast Upload Extension ----

  static const _status = EventChannel('argocast/status');

  /// Hands panel address, PIN and video settings to the broadcast extension.
  static Future<void> prepareBroadcast({
    required Panel panel,
    required String pin,
    required int maxSize,
    required int fps,
    required int bitrateKbps,
  }) =>
      _ch.invokeMethod('prepareBroadcast', {
        'host': panel.host,
        'port': panel.port,
        'pin': pin,
        'maxSize': maxSize,
        'fps': fps,
        'bitrateKbps': bitrateKbps,
      });

  /// Opens the system "Screen Broadcast" sheet with argocast preselected.
  static Future<void> showBroadcastPicker() => _ch.invokeMethod('showBroadcastPicker');
  static Future<void> stopBroadcast() => _ch.invokeMethod('stopBroadcast');

  /// Extension status codes (see SharedConfig.swift CastStatus) plus live stats.
  static Stream<BroadcastStatus> broadcastStatus() => _status.receiveBroadcastStream().map((e) {
        final m = e as Map<dynamic, dynamic>;
        return BroadcastStatus((m['status'] as num).toInt(), (m['fps'] as num).toInt(), (m['kbps'] as num).toInt());
      });

  static Future<void> requestKeyFrame() => _ch.invokeMethod('requestKeyFrame');
  static Future<void> stopCapture() => _ch.invokeMethod('stopCapture');
  static Future<String> deviceName() async => await _ch.invokeMethod<String>('deviceName') ?? 'Android';

  /// Encoded frames, plus a terminal error event when capture stops by itself
  /// (user revoked it from the notification, etc.).
  static Stream<EncodedFrame> frames() => _frames.receiveBroadcastStream().map((e) {
        final m = e as Map<dynamic, dynamic>;
        return EncodedFrame(m['data'] as Uint8List, m['key'] as bool);
      });
}
