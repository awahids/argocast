// 16-byte media framing (docs/02-lango-protocol-spec.md §4), big-endian:
//   0 u8 0xE8 | 1 u8 1=key 2=delta | 2 u16 seq | 4 u32 ms | 8 u32 SSRC | 12 u32 len | 16.. H.264 Annex-B
import Foundation

public let frameMagic: UInt8 = 0xE8
public let frameHeaderSize = 16

public final class FrameEncoder {
    public let ssrc: UInt32
    public private(set) var seq: UInt16 = 0

    public init(ssrc: String) {
        self.ssrc = UInt32(truncatingIfNeeded: Int64(ssrc) ?? 0)
    }

    public func encode(_ payload: Data, isKey: Bool, nowMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000)) -> Data {
        var out = Data(capacity: frameHeaderSize + payload.count)
        out.append(frameMagic)
        out.append(isKey ? 1 : 2)
        out.appendBE(seq)
        out.appendBE(UInt32(truncatingIfNeeded: nowMs))
        out.appendBE(ssrc)
        out.appendBE(UInt32(payload.count))
        out.append(payload)
        seq &+= 1
        return out
    }
}

extension Data {
    mutating func appendBE<T: FixedWidthInteger>(_ v: T) {
        var be = v.bigEndian
        Swift.withUnsafeBytes(of: &be) { append(contentsOf: $0) }
    }
}
