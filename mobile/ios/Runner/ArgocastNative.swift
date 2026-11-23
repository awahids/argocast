// Flutter bridge for iOS:
//  MethodChannel "argocast/native": discover, deviceName, prepareBroadcast, showBroadcastPicker, stopBroadcast
//  EventChannel  "argocast/status": { status: Int, fps: Int, kbps: Int } published by the broadcast extension
import Flutter
import notify
import ReplayKit
import UIKit

final class ArgocastNative: NSObject, FlutterStreamHandler {
    private var sink: FlutterEventSink?
    private var tokens: [Int32] = []
    private var lastStats: (Int, Int) = (0, 0)
    private var discovery: BonjourDiscovery?
    private var picker: RPSystemBroadcastPickerView?

    static func register(with registrar: FlutterPluginRegistrar) {
        let instance = ArgocastNative()
        let ch = FlutterMethodChannel(name: "argocast/native", binaryMessenger: registrar.messenger())
        ch.setMethodCallHandler(instance.handle)
        FlutterEventChannel(name: "argocast/status", binaryMessenger: registrar.messenger()).setStreamHandler(instance)
        objc_setAssociatedObject(registrar, "argocast", instance, .OBJC_ASSOCIATION_RETAIN)
    }

    private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        let args = call.arguments as? [String: Any] ?? [:]
        switch call.method {
        case "discover":
            let ms = args["timeoutMs"] as? Int ?? 3000
            let d = BonjourDiscovery()
            discovery = d
            d.run(timeout: Double(ms) / 1000) { [weak self] panels in
                self?.discovery = nil
                result(panels)
            }

        case "deviceName":
            result(UIDevice.current.name)

        case "prepareBroadcast":
            guard let host = args["host"] as? String, let port = args["port"] as? Int,
                  let ipv4 = Self.ipv4(host) else {
                result(FlutterError(code: "address", message: "Gunakan alamat IPv4 panel, mis. 192.168.1.50.", details: nil))
                return
            }
            let pin = (args["pin"] as? String ?? "").filter(\.isNumber)
            let cfg = CastConfig(ipv4: ipv4, port: UInt16(clamping: port), pin: pin,
                                 maxSize: args["maxSize"] as? Int ?? 1920, fps: args["fps"] as? Int ?? 30,
                                 bitrateKbps: args["bitrateKbps"] as? Int ?? 5000)
            result(SharedConfig.write(cfg) ? nil : FlutterError(code: "config", message: "PIN tidak valid.", details: nil))

        case "showBroadcastPicker":
            showPicker()
            result(nil)

        case "stopBroadcast":
            SharedConfig.set(SharedConfig.stopName, 1, post: true)
            result(nil)

        case "status":
            result(Int(SharedConfig.status.rawValue))

        default:
            result(FlutterMethodNotImplemented)
        }
    }

    /// Opens the system "Screen Broadcast" sheet preselected to our extension.
    private func showPicker() {
        let p = picker ?? RPSystemBroadcastPickerView(frame: CGRect(x: -100, y: -100, width: 44, height: 44))
        picker = p
        p.preferredExtension = (Bundle.main.bundleIdentifier ?? "app.argocast.argocast") + ".Broadcast"
        p.showsMicrophoneButton = false
        if p.superview == nil {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.addSubview(p)
        }
        for case let button as UIButton in p.subviews {
            button.sendActions(for: .touchUpInside)
        }
    }

    // MARK: status stream

    func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        sink = events
        tokens.append(SharedConfig.observe(SharedConfig.statusName) { [weak self] v in self?.emit(status: v) })
        tokens.append(SharedConfig.observe(SharedConfig.statsName) { [weak self] v in
            self?.lastStats = (Int(v >> 32), Int(v & 0xFFFF_FFFF))
            self?.emit(status: SharedConfig.get(SharedConfig.statusName))
        })
        emit(status: SharedConfig.get(SharedConfig.statusName))
        return nil
    }

    func onCancel(withArguments arguments: Any?) -> FlutterError? {
        tokens.forEach { notify_cancel($0) }
        tokens.removeAll()
        sink = nil
        return nil
    }

    private func emit(status: UInt64) {
        sink?(["status": Int(status), "fps": lastStats.0, "kbps": lastStats.1])
    }

    private static func ipv4(_ host: String) -> String? {
        let parts = host.split(separator: ".")
        return parts.count == 4 && parts.allSatisfy({ UInt8($0) != nil }) ? host : nil
    }
}

/// Bonjour browse + resolve of `_airgo._tcp` returning [{ name, host (IPv4), port }].
final class BonjourDiscovery: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let browser = NetServiceBrowser()
    private var services: [NetService] = []
    private var found: [String: [String: Any]] = [:]
    private var done: (([[String: Any]]) -> Void)?

    func run(timeout: TimeInterval, completion: @escaping ([[String: Any]]) -> Void) {
        done = completion
        browser.delegate = self
        browser.searchForServices(ofType: "_airgo._tcp.", inDomain: "local.")
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [self] in
            browser.stop()
            services.forEach { $0.stop() }
            done?(Array(found.values))
            done = nil
        }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: 2)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        for data in sender.addresses ?? [] {
            let ip: String? = data.withUnsafeBytes { raw in
                guard let sa = raw.baseAddress?.assumingMemoryBound(to: sockaddr.self), sa.pointee.sa_family == sa_family_t(AF_INET) else { return nil }
                var addr = raw.load(as: sockaddr_in.self).sin_addr
                var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                return inet_ntop(AF_INET, &addr, &buf, socklen_t(INET_ADDRSTRLEN)).map { _ in String(cString: buf) }
            }
            if let ip {
                found["\(ip):\(sender.port)"] = ["name": sender.name, "host": ip, "port": sender.port]
                break
            }
        }
    }
}
