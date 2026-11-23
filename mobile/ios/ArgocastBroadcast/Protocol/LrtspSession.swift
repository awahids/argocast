// LRTSP control session over Network.framework: OPTIONS -> ANNOUNCE -> SETUP -> PLAY,
// 5 s ACTIVE heartbeat, TEARDOWN on stop; media over a second TCP connection.
// Swift port of src/session.js / mobile/lib/protocol/session.dart.
import Foundation
import Network

public struct LrtspError: LocalizedError {
    public let message: String
    public let status: String?
    public init(_ message: String, status: String? = nil) { self.message = message; self.status = status }
    public var errorDescription: String? { message }
}

public final class LrtspSession {
    public let host: String
    public let port: UInt16
    public let request: RequestBuilder
    public var log: ((String) -> Void)?
    /// Called once when the control connection closes unexpectedly.
    public var onClose: ((Error?) -> Void)?

    public private(set) var capabilities: [String] = []
    public private(set) var transport = Transport()
    public private(set) var aeskey = ""
    public private(set) var framesSent = 0
    public private(set) var framesDropped = 0
    public private(set) var bytesSent = 0

    private let queue = DispatchQueue(label: "argocast.lrtsp")
    private var control: NWConnection?
    private var media: NWConnection?
    private var encoder: FrameEncoder?
    private var waiters: [(cseq: String?, cont: CheckedContinuation<LrtspResponse, Error>)] = []
    private var heartbeat: DispatchSourceTimer?
    private var inFlightBytes = 0
    private var pendingKey: Data?
    private var closed = false
    private let timeout: TimeInterval

    /// Drop delta frames while this much media is still queued in the socket.
    private let maxInFlight = 512 * 1024

    public init(host: String, port: UInt16, deviceName: String, uuid: String, timeout: TimeInterval = 8) {
        self.host = host
        self.port = port
        self.timeout = timeout
        self.request = RequestBuilder(serverIp: host, deviceName: deviceName, uuid: uuid)
    }

    // MARK: connection

    public func connect() async throws {
        let conn = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: Self.tcp())
        control = conn
        try await start(conn)
        receive(on: conn)
    }

    private static func tcp() -> NWParameters {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        tcp.connectionTimeout = 8
        return NWParameters(tls: nil, tcp: tcp)
    }

    private func start(_ conn: NWConnection) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            var resumed = false
            conn.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    if !resumed { resumed = true; cont.resume() }
                case .failed(let e), .waiting(let e):
                    if !resumed { resumed = true; conn.cancel(); cont.resume(throwing: e) }
                    else if conn === self?.control { self?.handleClose(e) }
                case .cancelled:
                    if !resumed { resumed = true; cont.resume(throwing: LrtspError("Koneksi dibatalkan.")) }
                    else if conn === self?.control { self?.handleClose(nil) }
                default: break
                }
            }
            conn.start(queue: queue)
        }
    }

    private func receive(on conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty, let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) {
                self.log?("<< \(text.debugDescription)")
                self.handle(text)
            }
            if isComplete || error != nil { self.handleClose(error); return }
            self.receive(on: conn)
        }
    }

    private func handle(_ text: String) {
        for msg in splitMessages(text) {
            guard case .raw(let raw) = msg, let res = LrtspResponse.parse(raw) else { continue }
            let idx: Int?
            if let c = res.cseq { idx = waiters.firstIndex { $0.cseq == c } } else { idx = waiters.isEmpty ? nil : 0 }
            guard let i = idx else { continue } // unsolicited, e.g. heartbeat reply
            waiters.remove(at: i).cont.resume(returning: res)
        }
    }

    private func handleClose(_ error: Error?) {
        queue.async { [self] in
            guard !closed else { return }
            closed = true
            heartbeat?.cancel()
            let pending = waiters
            waiters.removeAll()
            pending.forEach { $0.cont.resume(throwing: error ?? LrtspError("Koneksi kontrol tertutup.")) }
            onClose?(error)
        }
    }

    // MARK: requests

    private func send(_ text: String) async throws -> LrtspResponse {
        log?(">> \(text.debugDescription)")
        let cseq = text.range(of: #"Cseq: (\d+)"#, options: .regularExpression)
            .map { String(text[$0].dropFirst("Cseq: ".count)) }
        return try await withCheckedThrowingContinuation { cont in
            queue.async { [self] in
                guard let control, !closed else { cont.resume(throwing: LrtspError("Tidak terhubung ke panel.")); return }
                waiters.append((cseq, cont))
                control.send(content: text.data(using: .utf8), completion: .contentProcessed { _ in })
                queue.asyncAfter(deadline: .now() + timeout) { [self] in
                    if let i = waiters.firstIndex(where: { $0.cseq == cseq }) {
                        waiters.remove(at: i).cont.resume(throwing: LrtspError("Panel tidak menjawab \(text.split(separator: " ").first ?? "")."))
                    }
                }
            }
        }
    }

    private static let statusText = [
        LrtspStatus.unauthorized: "Panel menolak (tidak diizinkan).",
        LrtspStatus.codeUnavailable: "PIN salah.",
        LrtspStatus.busy: "Panel sedang sibuk atau koneksi penuh.",
        LrtspStatus.internalError: "Panel mengalami kesalahan internal.",
    ]

    private func expectOk(_ text: String) async throws -> LrtspResponse {
        let res = try await send(text)
        guard res.status == LrtspStatus.ok else {
            throw LrtspError(Self.statusText[res.status] ?? "Panel menjawab status \(res.status).", status: res.status)
        }
        return res
    }

    /// OPTIONS with PIN; keeps the SSRC and starts the 5 s heartbeat.
    @discardableResult
    public func authenticate(pin: String?) async throws -> LrtspResponse {
        let res = try await expectOk(request.options(pin: pin))
        if !res.ssrc.isEmpty { request.ssrc = res.ssrc }
        capabilities = res.capabilities
        queue.async { [self] in
            let t = DispatchSource.makeTimerSource(queue: queue)
            t.schedule(deadline: .now() + 5, repeating: 5)
            t.setEventHandler { [weak self] in
                guard let self, self.waiters.isEmpty, !self.closed else { return }
                self.control?.send(content: self.request.active().data(using: .utf8), completion: .contentProcessed { _ in })
            }
            t.resume()
            heartbeat = t
        }
        return res
    }

    /// ANNOUNCE -> SETUP -> PLAY, then opens the media connection to rtp_port.
    @discardableResult
    public func startCast(width: Int, height: Int, framerate: Int = 30) async throws -> Transport {
        let ann = try await expectOk(request.announce(width: width, height: height, framerate: framerate))
        aeskey = ann.aeskey
        let setup = try await expectOk(request.setup())
        transport = ann.transport.merged(with: setup.transport)
        _ = try await expectOk(request.play())
        guard let rtp = transport.rtpPort, let p = NWEndpoint.Port(rawValue: UInt16(rtp)) else {
            throw LrtspError("Panel tidak mengirim rtp_port.")
        }
        let m = NWConnection(host: NWEndpoint.Host(host), port: p, using: Self.tcp())
        try await start(m)
        queue.sync {
            media = m
            encoder = FrameEncoder(ssrc: request.ssrc)
        }
        return transport
    }

    /// Thread-safe. Drops delta frames while the socket is backed up; keeps the newest key frame.
    public func sendAccessUnit(_ data: Data, isKey: Bool) {
        queue.async { [self] in
            guard media != nil else { return }
            if inFlightBytes > maxInFlight {
                framesDropped += 1
                if isKey { pendingKey = data }
                return
            }
            write(data, isKey: isKey)
        }
    }

    private func write(_ data: Data, isKey: Bool) {
        guard let media, let encoder else { return }
        let frame = encoder.encode(data, isKey: isKey)
        inFlightBytes += frame.count
        framesSent += 1
        bytesSent += data.count
        media.send(content: frame, completion: .contentProcessed { [weak self] _ in
            guard let self else { return }
            self.inFlightBytes -= frame.count
            if self.inFlightBytes <= self.maxInFlight, let k = self.pendingKey {
                self.pendingKey = nil
                self.write(k, isKey: true)
            }
        })
    }

    public func stop() async {
        queue.sync { heartbeat?.cancel(); media?.cancel(); media = nil }
        if !closed { _ = try? await send(request.teardown()) }
        queue.sync { closed = true; control?.cancel() }
    }
}
