// App <-> broadcast-extension IPC without App Groups (free Apple IDs cannot use
// them). Values are packed into the 64-bit state of Darwin notifications
// (notify_set_state / notify_get_state), which both processes can read.
import Darwin
import Foundation
import notify

public struct CastConfig: Equatable {
    public var ipv4: String
    public var port: UInt16
    public var pin: String       // digits only, up to 15
    public var maxSize: Int      // longest side in pixels
    public var fps: Int
    public var bitrateKbps: Int

    public init(ipv4: String, port: UInt16, pin: String, maxSize: Int, fps: Int, bitrateKbps: Int) {
        self.ipv4 = ipv4; self.port = port; self.pin = pin
        self.maxSize = maxSize; self.fps = fps; self.bitrateKbps = bitrateKbps
    }
}

/// Status published by the extension (state of `SharedConfig.statusName`).
public enum CastStatus: UInt64 {
    case idle = 0, waiting = 1, connecting = 2, authenticating = 3, starting = 4, casting = 5
    case errWrongPin = 100, errBusy = 101, errUnauthorized = 102, errUnreachable = 103, errProtocol = 104, errStopped = 105
}

public enum SharedConfig {
    public static let addrName = "app.argocast.cfg.addr"
    public static let pinName = "app.argocast.cfg.pin"
    public static let videoName = "app.argocast.cfg.video"
    public static let statusName = "app.argocast.status"
    public static let statsName = "app.argocast.stats"
    public static let stopName = "app.argocast.stop"

    // MARK: packing (pure, unit-tested)

    public static func packAddr(ipv4: String, port: UInt16) -> UInt64? {
        let parts = ipv4.split(separator: ".").compactMap { UInt8($0) }
        guard parts.count == 4 else { return nil }
        let ip = parts.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        return (ip << 16) | UInt64(port)
    }

    public static func unpackAddr(_ v: UInt64) -> (String, UInt16)? {
        guard v != 0 else { return nil }
        let ip = (v >> 16) & 0xFFFF_FFFF
        let s = (0..<4).map { String((ip >> (8 * (3 - UInt64($0)))) & 0xFF) }.joined(separator: ".")
        return (s, UInt16(v & 0xFFFF))
    }

    /// bits 56..59 = length (so leading zeros survive), 0..55 = numeric value.
    public static func packPin(_ pin: String) -> UInt64? {
        guard pin.count <= 15, pin.allSatisfy(\.isNumber) else { return nil }
        let value = UInt64(pin) ?? 0
        return (UInt64(pin.count) << 56) | (value & 0x00FF_FFFF_FFFF_FFFF)
    }

    public static func unpackPin(_ v: UInt64) -> String {
        let len = Int((v >> 56) & 0x0F)
        guard len > 0 else { return "" }
        let digits = String(v & 0x00FF_FFFF_FFFF_FFFF)
        return String(repeating: "0", count: max(0, len - digits.count)) + digits
    }

    /// bit 63 = valid, 0..15 maxSize, 16..23 fps, 24..39 bitrate kbps.
    public static func packVideo(maxSize: Int, fps: Int, bitrateKbps: Int) -> UInt64 {
        (1 << 63) | UInt64(maxSize & 0xFFFF) | (UInt64(fps & 0xFF) << 16) | (UInt64(bitrateKbps & 0xFFFF) << 24)
    }

    public static func unpackVideo(_ v: UInt64) -> (maxSize: Int, fps: Int, bitrateKbps: Int)? {
        guard v >> 63 == 1 else { return nil }
        return (Int(v & 0xFFFF), Int((v >> 16) & 0xFF), Int((v >> 24) & 0xFFFF))
    }

    // MARK: notify state

    public static func set(_ name: String, _ value: UInt64, post: Bool = false) {
        var token: Int32 = 0
        guard notify_register_check(name, &token) == UInt32(NOTIFY_STATUS_OK) else { return }
        notify_set_state(token, value)
        notify_cancel(token)
        if post { notify_post(name) }
    }

    public static func get(_ name: String) -> UInt64 {
        var token: Int32 = 0
        var value: UInt64 = 0
        guard notify_register_check(name, &token) == UInt32(NOTIFY_STATUS_OK) else { return 0 }
        notify_get_state(token, &value)
        notify_cancel(token)
        return value
    }

    public static func write(_ c: CastConfig) -> Bool {
        guard let addr = packAddr(ipv4: c.ipv4, port: c.port), let pin = packPin(c.pin) else { return false }
        set(addrName, addr)
        set(pinName, pin)
        set(videoName, packVideo(maxSize: c.maxSize, fps: c.fps, bitrateKbps: c.bitrateKbps))
        set(statusName, CastStatus.waiting.rawValue, post: true)
        return true
    }

    /// Reads the config and wipes the PIN so it does not linger in system state.
    public static func readAndConsume() -> CastConfig? {
        guard let (ip, port) = unpackAddr(get(addrName)), let video = unpackVideo(get(videoName)) else { return nil }
        let pin = unpackPin(get(pinName))
        set(pinName, 0)
        return CastConfig(ipv4: ip, port: port, pin: pin, maxSize: video.maxSize, fps: video.fps, bitrateKbps: video.bitrateKbps)
    }

    public static func publish(_ status: CastStatus) { set(statusName, status.rawValue, post: true) }
    public static func publishStats(fps: Int, kbps: Int) { set(statsName, (UInt64(fps) << 32) | UInt64(kbps), post: true) }
    public static var status: CastStatus { CastStatus(rawValue: get(statusName)) ?? .idle }

    /// Calls `handler` on the main queue whenever `name` is posted. Returns the token for notify_cancel.
    @discardableResult
    public static func observe(_ name: String, _ handler: @escaping (UInt64) -> Void) -> Int32 {
        var token: Int32 = 0
        notify_register_dispatch(name, &token, DispatchQueue.main) { t in
            var v: UInt64 = 0
            notify_get_state(t, &v)
            handler(v)
        }
        return token
    }
}
