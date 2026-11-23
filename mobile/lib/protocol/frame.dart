// 16-byte media framing (docs/02-lango-protocol-spec.md §4), big-endian:
//   0 u8 0xE8 | 1 u8 1=key 2=delta | 2 u16 seq | 4 u32 ms | 8 u32 SSRC | 12 u32 len | 16.. H.264 Annex-B
import 'dart:typed_data';

const frameMagic = 0xE8;
const frameHeaderSize = 16;

class FrameEncoder {
  FrameEncoder(String ssrc) : ssrc = (int.tryParse(ssrc) ?? 0) & 0xFFFFFFFF;

  final int ssrc;
  int seq = 0;

  Uint8List encode(Uint8List payload, {required bool isKey, int? nowMs}) {
    final out = Uint8List(frameHeaderSize + payload.length);
    final bd = ByteData.view(out.buffer);
    bd.setUint8(0, frameMagic);
    bd.setUint8(1, isKey ? 1 : 2);
    bd.setUint16(2, seq & 0xFFFF);
    bd.setUint32(4, (nowMs ?? DateTime.now().millisecondsSinceEpoch) & 0xFFFFFFFF);
    bd.setUint32(8, ssrc);
    bd.setUint32(12, payload.length);
    out.setRange(frameHeaderSize, out.length, payload);
    seq = (seq + 1) & 0xFFFF;
    return out;
  }
}
