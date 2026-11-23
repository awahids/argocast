// Broadcast Upload Extension: iOS hands us every screen frame while the user
// broadcasts. The whole panel session runs here, because the main app is
// suspended as soon as the user switches to another app.
import Foundation
import ReplayKit
import UIKit

final class SampleHandler: RPBroadcastSampleHandler {
    private var session: LrtspSession?
    private var encoder: H264Encoder?
    private var config: CastConfig?
    private var startingEncoder = false
    private var mediaReady = false
    private var statsTimer: DispatchSourceTimer?
    private var stopToken: Int32 = 0
    private var authenticated = false
    // Recursive: fail() may run while processSampleBuffer holds the lock.
    private let lock = NSRecursiveLock()

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard let cfg = SharedConfig.readAndConsume() else {
            fail(LrtspError("Pilih panel di aplikasi argocast terlebih dahulu, lalu mulai siaran dari sana."), .errProtocol)
            return
        }
        config = cfg
        // The app's "Hentikan cast" button posts this.
        stopToken = SharedConfig.observe(SharedConfig.stopName) { [weak self] _ in
            self?.fail(LrtspError("Cast dihentikan."), .idle)
        }

        let s = LrtspSession(host: cfg.ipv4, port: cfg.port, deviceName: Self.deviceName, uuid: Self.uuid)
        session = s
        s.onClose = { [weak self] err in
            self?.fail(LrtspError(err.map { "Koneksi ke panel terputus: \($0.localizedDescription)" } ?? "Panel menutup koneksi."), .errUnreachable)
        }
        Task {
            do {
                SharedConfig.publish(.connecting)
                try await s.connect()
                SharedConfig.publish(.authenticating)
                try await s.authenticate(pin: cfg.pin.isEmpty ? nil : cfg.pin)
                SharedConfig.publish(.starting)
                lock.lock(); authenticated = true; lock.unlock()
                // ANNOUNCE needs the encoded size, known once the first frame arrives (processSampleBuffer).
            } catch {
                fail(error, Self.status(for: error))
            }
        }
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video, let cfg = config, let session else { return }
        lock.lock(); defer { lock.unlock() }

        if encoder == nil, !startingEncoder, authenticated {
            guard let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
            startingEncoder = true
            let (w, h) = H264Encoder.targetSize(sourceWidth: CVPixelBufferGetWidth(px), sourceHeight: CVPixelBufferGetHeight(px),
                                                maxSize: cfg.maxSize)
            do {
                encoder = try H264Encoder(width: w, height: h, fps: cfg.fps, bitrate: cfg.bitrateKbps * 1000) { data, isKey in
                    session.sendAccessUnit(data, isKey: isKey)
                }
            } catch {
                fail(LrtspError("Encoder video gagal dibuat."), .errProtocol)
                return
            }
            Task {
                do {
                    try await session.startCast(width: Int(w), height: Int(h), framerate: cfg.fps)
                    lock.lock(); mediaReady = true; encoder?.requestKeyFrame(); lock.unlock()
                    SharedConfig.publish(.casting)
                    startStats()
                } catch {
                    fail(error, Self.status(for: error))
                }
            }
        }
        if mediaReady { encoder?.encode(sampleBuffer) }
    }

    private func startStats() {
        let t = DispatchSource.makeTimerSource(queue: .global())
        var lastFrames = 0, lastBytes = 0
        t.schedule(deadline: .now() + 1, repeating: 1)
        t.setEventHandler { [weak self] in
            guard let s = self?.session else { return }
            let frames = s.framesSent, bytes = s.bytesSent
            SharedConfig.publishStats(fps: frames - lastFrames, kbps: (bytes - lastBytes) * 8 / 1000)
            lastFrames = frames; lastBytes = bytes
        }
        t.resume()
        statsTimer = t
    }

    override func broadcastFinished() { cleanup(status: .idle) }
    override func broadcastPaused() {}
    override func broadcastResumed() { lock.lock(); encoder?.requestKeyFrame(); lock.unlock() }

    private var finished = false

    /// Ends the broadcast with a message iOS shows to the user.
    private func fail(_ error: Error, _ status: CastStatus) {
        lock.lock()
        if finished { lock.unlock(); return }
        finished = true
        lock.unlock()
        cleanup(status: status)
        finishBroadcastWithError(NSError(domain: "argocast", code: Int(status.rawValue),
                                         userInfo: [NSLocalizedDescriptionKey: error.localizedDescription]))
    }

    private func cleanup(status: CastStatus) {
        statsTimer?.cancel()
        statsTimer = nil
        lock.lock()
        encoder?.invalidate()
        encoder = nil
        mediaReady = false
        lock.unlock()
        if stopToken != 0 { notify_cancel(stopToken); stopToken = 0 }
        let s = session
        session = nil
        s?.onClose = nil
        let sem = DispatchSemaphore(value: 0)
        Task { await s?.stop(); sem.signal() }
        _ = sem.wait(timeout: .now() + 2)
        SharedConfig.publish(status)
    }

    private static func status(for error: Error) -> CastStatus {
        switch (error as? LrtspError)?.status {
        case LrtspStatus.codeUnavailable?: return .errWrongPin
        case LrtspStatus.busy?: return .errBusy
        case LrtspStatus.unauthorized?: return .errUnauthorized
        case nil where !(error is LrtspError): return .errUnreachable
        default: return .errProtocol
        }
    }

    private static var deviceName: String { UIDevice.current.name }

    /// Stable per-install id shared with the app (same vendor).
    private static var uuid: String { UIDevice.current.identifierForVendor?.uuidString.lowercased() ?? UUID().uuidString.lowercased() }
}
