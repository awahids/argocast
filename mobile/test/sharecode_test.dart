import 'package:argocast/protocol/sharecode.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('6-digit code from the infographic ("834 109") -> x.y.136.2', () {
    expect(decodeSix('834109'), [136, 2]);
    final r = resolveTarget('834 109', ['192.168.1.20'])!;
    expect(r.candidates, ['192.168.136.2']);
    expect(r.port, 3056);
    expect(r.pin, '834109');
  });

  test('8-digit and 8-letter codes', () {
    expect(decodeEightDigits('20145027'), [136, 2]);
    String encode(String ip) {
      var n = ip.split('.').fold<int>(0, (a, o) => a * 256 + int.parse(o));
      final sb = StringBuffer();
      for (var k = 0; k < 8; k++) {
        sb.writeCharCode(65 + n % 25);
        n ~/= 25;
      }
      return sb.toString();
    }

    expect(decodeEightLetters(encode('172.20.10.5')), '172.20.10.5');
    expect(resolveTarget(encode('10.1.2.3'), const [])!.candidates, ['10.1.2.3']);
  });

  test('IP passthrough, one candidate per /16, invalid input', () {
    expect(resolveTarget('192.168.1.50:7000', const [])!.port, 7000);
    expect(resolveTarget('834109', ['10.1.106.19', '172.28.0.1'])!.candidates, ['10.1.136.2', '172.28.136.2']);
    expect(resolveTarget('hello', const []), isNull);
  });

  test('QR / NFC links', () {
    final r = resolveTarget('airgocast://?pinCode=834109&ipGroup=192.168.136.2&deviceName=iTBoard', const [])!;
    expect(r.candidates, ['192.168.136.2']);
    expect(r.pin, '834109');
    expect(r.name, 'iTBoard');
    expect(resolveTarget('https://www.airgo.link?pinCode=834109', ['192.168.1.2'])!.candidates, ['192.168.136.2']);
  });
}
