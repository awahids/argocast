// Panel share code -> IP. Port of src/sharecode.js; algorithm from
// com.xbh.client.utils.d ("CryCodeUtils") in Airgo Cast Android v2.10.1.200.
//   6 digits  -> last two octets (first two from this device's IPv4)
//   8 digits  -> last two octets, XOR-obfuscated
//   8 letters -> full IPv4 (base 25, A..Y, first letter least significant)
// The code is also the PIN. LRTSP port is fixed: 3056.
import 'dart:async';
import 'dart:io';

const lrtspPort = 3056;

final _ipv4 = RegExp(r'^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$');
bool isIPv4(String s) => _ipv4.hasMatch(s);

List<int>? decodeSix(String code) {
  if (!RegExp(r'^\d{6}$').hasMatch(code)) return null;
  var i = int.parse(code);
  while (i <= 999999) {
    i += 65536;
  }
  final v = 999999 - (i - 65536);
  return [v >> 8, v & 255];
}

List<int>? decodeEightDigits(String code) {
  if (!RegExp(r'^\d{8}$').hasMatch(code)) return null;
  final key = int.parse(code.substring(0, 2)) ^ 13;
  final o3 = int.parse(code.substring(2, 5)) ^ key;
  final o4 = int.parse(code.substring(5, 8)) ^ key;
  return o3 <= 255 && o4 <= 255 ? [o3, o4] : null;
}

String? decodeEightLetters(String code) {
  if (code.length != 8) return null;
  final letters = code.toUpperCase().codeUnits.where((c) => c >= 65 && c < 90).toList();
  var n = BigInt.zero;
  for (var k = letters.length - 1; k >= 0; k--) {
    n = n * BigInt.from(25) + BigInt.from(letters[k] - 65);
  }
  final octets = <int>[];
  for (var k = 0; k < 4; k++) {
    octets.insert(0, (n & BigInt.from(255)).toInt());
    n = n >> 8;
  }
  return octets.join('.');
}

class ResolvedTarget {
  ResolvedTarget(this.candidates, this.port, this.pin, [this.name]);
  final List<String> candidates;
  final int port;
  final String pin;
  final String? name;
}

class PanelLink {
  PanelLink(this.pinCode, this.ipGroup, this.deviceName);
  final String pinCode, ipGroup, deviceName;
}

/// airgocast://?pinCode=…&ipGroup=…&deviceName=… (NFC tag / QR on the panel).
PanelLink? parseLink(String text) {
  if (!RegExp(r'^(airgocast://|https?://(www\.)?airgo\.link)', caseSensitive: false).hasMatch(text)) return null;
  final uri = Uri.tryParse(text.replaceFirst(RegExp(r'^airgocast:///?\??', caseSensitive: false), 'https://www.airgo.link?'));
  if (uri == null) return null;
  final q = uri.queryParameters;
  final pin = (q['pinCode'] ?? '').replaceAll(RegExp(r'\s'), '');
  if (pin.isEmpty && (q['ipGroup'] ?? '').isEmpty) return null;
  return PanelLink(pin, q['ipGroup'] ?? '', q['deviceName'] ?? '');
}

/// Code, IP[:port] or airgocast:// link -> connection candidates.
ResolvedTarget? resolveTarget(String input, List<String> localIPs) {
  final raw = input.trim();
  final link = parseLink(raw);
  if (link != null) {
    final base = resolveTarget(isIPv4(link.ipGroup) ? link.ipGroup : link.pinCode, localIPs);
    if (base == null) return null;
    return ResolvedTarget(base.candidates, base.port, link.pinCode, link.deviceName.isEmpty ? null : link.deviceName);
  }
  final parts = raw.split(':');
  if (isIPv4(parts[0])) {
    return ResolvedTarget([parts[0]], parts.length > 1 ? int.tryParse(parts[1]) ?? lrtspPort : lrtspPort, '');
  }
  final code = raw.replaceAll(RegExp(r'[\s-]'), '');
  List<int>? tail;
  if (RegExp(r'^\d{6}$').hasMatch(code)) {
    tail = decodeSix(code);
  } else if (RegExp(r'^\d{8}$').hasMatch(code)) {
    tail = decodeEightDigits(code);
  } else if (RegExp(r'^[A-Za-z]{8}$').hasMatch(code)) {
    return ResolvedTarget([decodeEightLetters(code)!], lrtspPort, code);
  }
  if (tail == null) return null;
  final prefixes = localIPs.map((ip) => ip.split('.').take(2).join('.')).toSet();
  return ResolvedTarget([for (final p in prefixes) '$p.${tail[0]}.${tail[1]}'], lrtspPort, code);
}

/// This device's IPv4s, Wi-Fi first, link-local excluded.
Future<List<String>> localIPv4s() async {
  final ifaces = await NetworkInterface.list(type: InternetAddressType.IPv4);
  int score(String name) => RegExp(r'wlan|wi-?fi|en0|eth', caseSensitive: false).hasMatch(name) ? 0 : 1;
  ifaces.sort((a, b) => score(a.name).compareTo(score(b.name)));
  return [
    for (final i in ifaces)
      for (final a in i.addresses)
        if (!a.isLoopback && !a.address.startsWith('169.254.')) a.address,
  ];
}

/// First candidate that accepts a TCP connection on [port], or null.
Future<String?> firstReachable(List<String> candidates, int port, {Duration timeout = const Duration(milliseconds: 2500)}) async {
  if (candidates.length == 1) return candidates.first;
  for (final host in candidates) {
    try {
      final s = await Socket.connect(host, port, timeout: timeout);
      s.destroy();
      return host;
    } catch (_) {}
  }
  return null;
}
