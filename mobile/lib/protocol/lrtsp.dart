// LRTSP/2.0 request builders and response parser.
// Port of src/lrtsp.js; request layout mirrors com.xbh.client.rtsp.Request in
// Airgo Cast Android v2.10.1.200 (docs/02-lango-protocol-spec.md §3).

const lrtspVersion = 'LRTSP/2.0';
const _crlf = '\r\n';
const _terminator = '\r\n\r';

class LrtspStatus {
  static const ok = '200';
  static const badRequest = '400';
  static const unauthorized = '401';
  static const notFound = '404';
  static const codeUnavailable = '406'; // wrong PIN
  static const internalError = '500';
  static const busy = '501';
}

/// Panels show the PIN grouped ("834 109"); only the digits are sent.
String normalizePin(String? pin) => (pin ?? '').replaceAll(RegExp(r'\D'), '');

class RequestBuilder {
  RequestBuilder({
    required this.serverIp,
    required this.deviceName,
    required this.uuid,
    this.os = 'Android',
    this.version = 'sender v20210311',
  });

  final String serverIp;
  final String deviceName;
  final String uuid;
  final String os;
  final String version;
  int seq = 1;
  String ssrc = '';

  String _head(String method) =>
      '$method lrtsp://$serverIp $lrtspVersion$_crlf' 'Cseq: ${seq++}$_crlf';

  String options({String? pin}) {
    pin = normalizePin(pin);
    final body = StringBuffer()
      ..write('Version: $version$_crlf')
      ..write('Os: $os$_crlf')
      ..write('Model: $deviceName$_crlf')
      ..write('uuid: $uuid$_crlf')
      ..write('Code: ${pin ?? ''}$_terminator');
    final b = body.toString();
    final msg = StringBuffer(_head('OPTIONS'));
    if (ssrc.isNotEmpty) msg.write('SSRC: $ssrc$_crlf');
    msg
      ..write('Content-Length: ${b.length}$_crlf')
      ..write('Content-Type: application/sdp$_crlf')
      ..write(b);
    return msg.toString();
  }

  String announce({required int width, required int height, int framerate = 30, bool audio = false}) {
    final sdp = 'm=video 0 LRTP/AVP 116$_crlf'
        'Width=integer:$width$_crlf'
        'Height=integer:$height$_crlf'
        'Mimetype=string:"video/avc"$_crlf'
        'Framerate=integer:$framerate$_crlf'
        'AudioOn=integer:${audio ? 1 : 0}';
    return '${_head('ANNOUNCE')}'
        'SSRC: $ssrc$_crlf'
        'Content-Length: ${sdp.length}$_crlf'
        'Content-Type: application/sdp$_crlf'
        '$sdp$_terminator';
  }

  String _simple(String method) => '${_head(method)}SSRC: $ssrc$_terminator';
  String setup() => _simple('SETUP');
  String play() => _simple('PLAY');
  String active() => _simple('ACTIVE');
  String bye() => _simple('BYE');
  String teardown() => _simple('TEARDOWN');
}

class Transport {
  Transport({this.raw = '', this.rtpPort, this.rtcpPort, this.controlPort, this.quicPort});
  final String raw;
  final int? rtpPort, rtcpPort, controlPort, quicPort;

  static Transport parse(String value) {
    int? get(String key) {
      for (final part in value.split(';')) {
        final i = part.indexOf('=');
        if (i > 0 && part.substring(0, i).trim() == key) return int.tryParse(part.substring(i + 1).trim());
      }
      return null;
    }

    return Transport(
      raw: value,
      rtpPort: get('rtp_port'),
      rtcpPort: get('rtcp_port'),
      controlPort: get('control_port'),
      quicPort: get('quic_port'),
    );
  }

  Transport merge(Transport o) => Transport(
        raw: o.raw.isNotEmpty ? o.raw : raw,
        rtpPort: o.rtpPort ?? rtpPort,
        rtcpPort: o.rtcpPort ?? rtcpPort,
        controlPort: o.controlPort ?? controlPort,
        quicPort: o.quicPort ?? quicPort,
      );
}

class LrtspResponse {
  LrtspResponse(this.status, this.reason, this.headers);
  final String status;
  final String reason;
  final Map<String, String> headers;

  String get ssrc => headers['ssrc'] ?? '';
  String get session => headers['session'] ?? '';
  String get aeskey => headers['a=aeskey:string'] ?? '';
  String? get cseq => headers['cseq'];
  String get connection => headers['connection'] ?? '';
  List<String> get public =>
      (headers['public'] ?? '').split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
  Transport get transport => Transport.parse(headers['transport'] ?? '');
}

final _statusRe = RegExp(r'^LRTSP/2\.0\s+(\d{3})\s*(.*)$');

LrtspResponse? parseResponse(String raw) {
  final lines = raw.split(_crlf);
  final m = _statusRe.firstMatch(lines.first.trim());
  if (m == null) return null;
  final headers = <String, String>{};
  for (final line in lines.skip(1)) {
    if (line.trim().isEmpty) continue;
    String key, value;
    if (line.startsWith('a=')) {
      final j = line.lastIndexOf(':');
      key = line.substring(0, j);
      value = line.substring(j + 1);
    } else {
      final i = line.indexOf(':');
      if (i <= 0) continue;
      key = line.substring(0, i);
      value = line.substring(i + 1);
    }
    headers[key.trim().toLowerCase()] = value.trim();
  }
  return LrtspResponse(m.group(1)!, m.group(2) ?? '', headers);
}

/// One received chunk may hold several replies and bare "ACTIVE\r\n" keep-alives.
sealed class LrtspMessage {}

class KeepAlive extends LrtspMessage {}

class RawMessage extends LrtspMessage {
  RawMessage(this.raw);
  final String raw;
}

List<LrtspMessage> splitMessages(String text) {
  final out = <LrtspMessage>[];
  var rest = text;
  while (rest.startsWith('ACTIVE\r\n')) {
    out.add(KeepAlive());
    rest = rest.substring('ACTIVE\r\n'.length);
  }
  var idx = rest.indexOf(lrtspVersion);
  while (idx != -1) {
    final next = rest.indexOf(lrtspVersion, idx + 1);
    out.add(RawMessage(rest.substring(idx, next > 0 ? next : rest.length)));
    idx = next;
  }
  return out;
}
