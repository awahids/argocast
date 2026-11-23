import Foundation
import XCTest
@testable import ArgocastProtocol

final class ProtocolTests: XCTestCase {
    private func rb() -> RequestBuilder {
        RequestBuilder(serverIp: "192.168.1.50", deviceName: "IPHONE", uuid: "u-1", os: "iOS")
    }

    func testOptionsLayoutMatchesOtherSenders() {
        let body = "Version: sender v20210311\r\nOs: iOS\r\nModel: IPHONE\r\nuuid: u-1\r\nCode: 1234\r\n\r"
        XCTAssertEqual(rb().options(pin: "1234"),
                       "OPTIONS lrtsp://192.168.1.50 LRTSP/2.0\r\nCseq: 1\r\n"
                       + "Content-Length: \(body.utf16.count)\r\nContent-Type: application/sdp\r\n" + body)
    }

    func testCseqAndSsrc() {
        let r = rb()
        _ = r.options(pin: nil)
        r.ssrc = "55667788"
        XCTAssertEqual(r.setup(), "SETUP lrtsp://192.168.1.50 LRTSP/2.0\r\nCseq: 2\r\nSSRC: 55667788\r\n\r")
        XCTAssertTrue(r.active().hasPrefix("ACTIVE lrtsp://192.168.1.50 LRTSP/2.0\r\nCseq: 3\r\n"))
    }

    func testAnnounce() {
        let r = rb(); r.ssrc = "1"
        let msg = r.announce(width: 880, height: 1920)
        XCTAssertTrue(msg.contains("Width=integer:880\r\nHeight=integer:1920\r\nMimetype=string:\"video/avc\"\r\n"))
        XCTAssertTrue(msg.hasSuffix("AudioOn=integer:0\r\n\r"))
    }

    func testParseResponse() throws {
        let res = try XCTUnwrap(LrtspResponse.parse(
            "LRTSP/2.0 200 OK\r\nCseq: 3\r\nSSRC: 42\r\nPublic: ACTIVE,ANNOUNCE\r\na=aeskey:string:abc\r\n"
            + "Transport: RTP/TCP/unicast;rtp_port=9000;rtcp_port=9001;control_port=9002\r\n\r\n"))
        XCTAssertEqual(res.status, "200")
        XCTAssertEqual(res.ssrc, "42")
        XCTAssertEqual(res.aeskey, "abc")
        XCTAssertEqual(res.capabilities, ["ACTIVE", "ANNOUNCE"])
        XCTAssertEqual(res.transport, Transport(rtpPort: 9000, rtcpPort: 9001, controlPort: 9002))
    }

    func testSplitMessages() {
        let parts = splitMessages("ACTIVE\r\nLRTSP/2.0 200 OK\r\n\r\nLRTSP/2.0 406 Code Unavailable\r\n\r\n")
        XCTAssertEqual(parts.count, 3)
        XCTAssertEqual(parts[0], .keepAlive)
        guard case .raw(let raw) = parts[2] else { return XCTFail() }
        XCTAssertEqual(LrtspResponse.parse(raw)?.status, "406")
    }

    func testFrameHeader() {
        let enc = FrameEncoder(ssrc: "305419896")
        let f = enc.encode(Data([0xAA, 0xBB, 0xCC]), isKey: true, nowMs: 0x01_0203_0405)
        XCTAssertEqual([UInt8](f), [0xE8, 1, 0, 0, 2, 3, 4, 5, 0x12, 0x34, 0x56, 0x78, 0, 0, 0, 3, 0xAA, 0xBB, 0xCC])
        XCTAssertEqual(enc.encode(Data([0]), isKey: false)[1], 2)
    }

    func testSharedConfigPacking() throws {
        let addr = try XCTUnwrap(SharedConfig.packAddr(ipv4: "192.168.1.50", port: 7000))
        let (ip, port) = try XCTUnwrap(SharedConfig.unpackAddr(addr))
        XCTAssertEqual(ip, "192.168.1.50"); XCTAssertEqual(port, 7000)
        XCTAssertEqual(SharedConfig.unpackPin(try XCTUnwrap(SharedConfig.packPin("004821"))), "004821")
        XCTAssertEqual(SharedConfig.unpackPin(try XCTUnwrap(SharedConfig.packPin(""))), "")
        XCTAssertNil(SharedConfig.packPin("12a4"))
        let v = try XCTUnwrap(SharedConfig.unpackVideo(SharedConfig.packVideo(maxSize: 1920, fps: 30, bitrateKbps: 8000)))
        XCTAssertEqual(v.maxSize, 1920); XCTAssertEqual(v.fps, 30); XCTAssertEqual(v.bitrateKbps, 8000)
    }

    func testSharedConfigRoundTripThroughNotifyState() throws {
        let cfg = CastConfig(ipv4: "10.0.0.7", port: 8554, pin: "0420", maxSize: 1280, fps: 24, bitrateKbps: 2500)
        XCTAssertTrue(SharedConfig.write(cfg))
        XCTAssertEqual(SharedConfig.status, .waiting)
        XCTAssertEqual(SharedConfig.readAndConsume(), cfg)
        XCTAssertEqual(SharedConfig.readAndConsume()?.pin, "", "PIN must be wiped after reading")
    }
}

/// End-to-end against mock/panel.js (the same mock the desktop and Android tests use).
final class MockPanelTests: XCTestCase {
    private static var panel: Process?
    private static let port: UInt16 = 58554, mediaPort = 58555

    override class func setUp() {
        let repo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent() // Tests -> ArgocastBroadcast
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() // ios -> mobile -> repo
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", "mock/panel.js", "--port", "\(port)", "--media-port", "\(mediaPort)", "--pin", "2468", "--no-mdns"]
        p.currentDirectoryURL = repo
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        let ready = DispatchSemaphore(value: 0)
        var signalled = false
        out.fileHandleForReading.readabilityHandler = { h in
            let s = String(decoding: h.availableData, as: UTF8.self)
            if !signalled, s.contains("listening") { signalled = true; ready.signal() } // keep draining afterwards
        }
        do { try p.run() } catch { return }
        _ = ready.wait(timeout: .now() + 10)
        panel = p
    }

    override class func tearDown() { panel?.terminate() }

    func testWrongPinIsRejected() async throws {
        try XCTSkipIf(Self.panel == nil, "node not available")
        let s = LrtspSession(host: "127.0.0.1", port: Self.port, deviceName: "t", uuid: "u")
        try await s.connect()
        do {
            try await s.authenticate(pin: "0000")
            XCTFail("expected 406")
        } catch let e as LrtspError {
            XCTAssertEqual(e.status, "406")
        }
        await s.stop()
    }

    func testFullSessionDeliversFrames() async throws {
        try XCTSkipIf(Self.panel == nil, "node not available")
        let s = LrtspSession(host: "127.0.0.1", port: Self.port, deviceName: "t", uuid: "u")
        try await s.connect()
        let opt = try await s.authenticate(pin: "2468")
        XCTAssertFalse(opt.ssrc.isEmpty)
        let t = try await s.startCast(width: 880, height: 1920)
        XCTAssertEqual(t.rtpPort, Int(Self.mediaPort))
        for i in 0..<20 {
            s.sendAccessUnit(Data([0, 0, 0, 1, i == 0 ? 0x65 : 0x41, 0x80, UInt8(i)]), isKey: i == 0)
        }
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(s.framesSent, 20)
        await s.stop()
    }
}
