// Persistent settings (shared_preferences).
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'native.dart';

enum Quality { weak, standard, enhanced }

const qualityKbps = {Quality.weak: 2500, Quality.standard: 5000, Quality.enhanced: 8000};
const qualityLabel = {Quality.weak: 'Jaringan lemah', Quality.standard: 'Standar', Quality.enhanced: 'Tinggi'};

class Settings extends ChangeNotifier {
  Settings._(this._prefs);
  final SharedPreferences _prefs;

  static Future<Settings> load() async {
    final s = Settings._(await SharedPreferences.getInstance());
    if (s._prefs.getString('uuid') == null) {
      await s._prefs.setString('uuid', _uuid());
    }
    if (s._prefs.getString('deviceName') == null) {
      try {
        await s._prefs.setString('deviceName', await NativeBridge.deviceName());
      } catch (_) {}
    }
    return s;
  }

  String get uuid => _prefs.getString('uuid')!;
  String get deviceName => _prefs.getString('deviceName') ?? 'Android';
  int get maxSize => _prefs.getInt('maxSize') ?? 1920; // longest side
  int get fps => _prefs.getInt('fps') ?? 30;
  Quality get quality => Quality.values[_prefs.getInt('quality') ?? Quality.standard.index];
  int get bitrateKbps => qualityKbps[quality]!;

  /// Android: panel touches drive this phone (needs the accessibility service).
  bool get touchback => _prefs.getBool('touchback') ?? true;

  List<Panel> get recent {
    final raw = _prefs.getString('recent');
    if (raw == null) return const [];
    return (jsonDecode(raw) as List).map((e) => Panel.fromJson(e as Map)).toList();
  }

  Future<void> update({String? deviceName, int? maxSize, int? fps, Quality? quality, bool? touchback}) async {
    if (deviceName != null && deviceName.trim().isNotEmpty) await _prefs.setString('deviceName', deviceName.trim());
    if (maxSize != null) await _prefs.setInt('maxSize', maxSize);
    if (fps != null) await _prefs.setInt('fps', fps);
    if (quality != null) await _prefs.setInt('quality', quality.index);
    if (touchback != null) await _prefs.setBool('touchback', touchback);
    notifyListeners();
  }

  Future<void> addRecent(Panel p) async {
    final list = [p, ...recent.where((r) => !(r.host == p.host && r.port == p.port))].take(5).toList();
    await _prefs.setString('recent', jsonEncode(list.map((e) => e.toJson()).toList()));
    notifyListeners();
  }

  static String _uuid() {
    final r = Random.secure();
    final b = List<int>.generate(16, (_) => r.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
    final s = List.generate(16, h).join();
    return '${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}';
  }
}
