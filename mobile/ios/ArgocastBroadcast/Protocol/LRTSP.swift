// LRTSP/2.0 request builders and response parser.
// Swift port of src/lrtsp.js / mobile/lib/protocol/lrtsp.dart; layout mirrors
// com.xbh.client.rtsp.Request (docs/02-lango-protocol-spec.md §3).
import Foundation

public let lrtspVersion = "LRTSP/2.0"
private let crlf = "\r\n"
private let terminator = "\r\n\r"

public enum LrtspStatus {
    public static let ok = "200"
    public static let unauthorized = "401"
    public static let codeUnavailable = "406" // wrong PIN
    public static let internalError = "500"
    public static let busy = "501"
}

public final class RequestBuilder {
    public let serverIp: String
    public let deviceName: String
    public let uuid: String
    public let os: String
    public let version: String
    public var seq = 1
    public var ssrc = ""

    public init(serverIp: String, deviceName: String, uuid: String, os: String = "iOS", version: String = "sender v20210311") {
        self.serverIp = serverIp
        self.deviceName = deviceName
        self.uuid = uuid
        self.os = os
        self.version = version
    }

    private func head(_ method: String) -> String {
        defer { seq += 1 }
        return "\(method) lrtsp://\(serverIp) \(lrtspVersion)\(crlf)Cseq: \(seq)\(crlf)"
    }

    public func options(pin: String?) -> String {
        let body = "Version: \(version)\(crlf)Os: \(os)\(crlf)Model: \(deviceName)\(crlf)uuid: \(uuid)\(crlf)Code: \(pin ?? "")\(terminator)"
        var msg = head("OPTIONS")
        if !ssrc.isEmpty { msg += "SSRC: \(ssrc)\(crlf)" }
        msg += "Content-Length: \(body.utf16.count)\(crlf)Content-Type: application/sdp\(crlf)"
        return msg + body
    }

    public func announce(width: Int, height: Int, framerate: Int = 30, audio: Bool = false) -> String {
        let sdp = "m=video 0 LRTP/AVP 116\(crlf)"
            + "Width=integer:\(width)\(crlf)"
            + "Height=integer:\(height)\(crlf)"
            + "Mimetype=string:\"video/avc\"\(crlf)"
            + "Framerate=integer:\(framerate)\(crlf)"
            + "AudioOn=integer:\(audio ? 1 : 0)"
        return head("ANNOUNCE")
            + "SSRC: \(ssrc)\(crlf)"
            + "Content-Length: \(sdp.utf16.count)\(crlf)"
            + "Content-Type: application/sdp\(crlf)"
            + sdp + terminator
    }

    private func simple(_ method: String) -> String { head(method) + "SSRC: \(ssrc)\(terminator)" }
    public func setup() -> String { simple("SETUP") }
    public func play() -> String { simple("PLAY") }
    public func active() -> String { simple("ACTIVE") }
    public func teardown() -> String { simple("TEARDOWN") }
}

public struct Transport: Equatable {
    public var rtpPort: Int?
    public var rtcpPort: Int?
    public var controlPort: Int?

    public init(rtpPort: Int? = nil, rtcpPort: Int? = nil, controlPort: Int? = nil) {
        self.rtpPort = rtpPort
        self.rtcpPort = rtcpPort
        self.controlPort = controlPort
    }

    public static func parse(_ value: String) -> Transport {
        var t = Transport()
        for part in value.split(separator: ";") {
            let kv = part.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard kv.count == 2, let n = Int(kv[1]) else { continue }
            switch kv[0] {
            case "rtp_port": t.rtpPort = n
            case "rtcp_port": t.rtcpPort = n
            case "control_port": t.controlPort = n
            default: break
            }
        }
        return t
    }

    public func merged(with o: Transport) -> Transport {
        Transport(rtpPort: o.rtpPort ?? rtpPort, rtcpPort: o.rtcpPort ?? rtcpPort, controlPort: o.controlPort ?? controlPort)
    }
}

public struct LrtspResponse {
    public let status: String
    public let reason: String
    public let headers: [String: String]

    public var ssrc: String { headers["ssrc"] ?? "" }
    public var session: String { headers["session"] ?? "" }
    public var aeskey: String { headers["a=aeskey:string"] ?? "" }
    public var cseq: String? { headers["cseq"] }
    public var capabilities: [String] {
        (headers["public"] ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
    public var transport: Transport { Transport.parse(headers["transport"] ?? "") }

    public static func parse(_ raw: String) -> LrtspResponse? {
        let lines = raw.components(separatedBy: crlf)
        guard let first = lines.first?.trimmingCharacters(in: .whitespaces), first.hasPrefix(lrtspVersion) else { return nil }
        let rest = first.dropFirst(lrtspVersion.count).trimmingCharacters(in: .whitespaces)
        let status = String(rest.prefix(3))
        guard status.count == 3, Int(status) != nil else { return nil }
        let reason = rest.dropFirst(3).trimmingCharacters(in: .whitespaces)
        var headers: [String: String] = [:]
        for line in lines.dropFirst() where !line.trimmingCharacters(in: .whitespaces).isEmpty {
            let key: Substring, value: Substring
            if line.hasPrefix("a="), let j = line.lastIndex(of: ":") {
                key = line[..<j]; value = line[line.index(after: j)...]
            } else if let i = line.firstIndex(of: ":"), i != line.startIndex {
                key = line[..<i]; value = line[line.index(after: i)...]
            } else { continue }
            headers[key.trimmingCharacters(in: .whitespaces).lowercased()] = value.trimmingCharacters(in: .whitespaces)
        }
        return LrtspResponse(status: status, reason: reason, headers: headers)
    }
}

public enum LrtspMessage: Equatable {
    case keepAlive
    case raw(String)
}

/// One TCP read may hold several replies plus bare "ACTIVE\r\n" keep-alives.
public func splitMessages(_ text: String) -> [LrtspMessage] {
    var out: [LrtspMessage] = []
    var rest = Substring(text)
    while rest.hasPrefix("ACTIVE\r\n") {
        out.append(.keepAlive)
        rest = rest.dropFirst("ACTIVE\r\n".count)
    }
    var start = rest.range(of: lrtspVersion)?.lowerBound
    while let s = start {
        let after = rest.index(after: s)
        let next = rest[after...].range(of: lrtspVersion)?.lowerBound
        out.append(.raw(String(rest[s..<(next ?? rest.endIndex)])))
        start = next
    }
    return out
}
