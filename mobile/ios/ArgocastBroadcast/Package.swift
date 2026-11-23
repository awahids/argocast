// swift-tools-version:5.9
// Lets the protocol code shared by the broadcast extension be unit-tested on a
// Mac with `swift test` (CI), independent of Xcode and a device. The Xcode
// targets compile the same files from Protocol/ directly.
import PackageDescription

let package = Package(
    name: "ArgocastProtocol",
    platforms: [.macOS(.v12), .iOS(.v15)],
    products: [.library(name: "ArgocastProtocol", targets: ["ArgocastProtocol"])],
    targets: [
        .target(name: "ArgocastProtocol", path: "Protocol"),
        .testTarget(name: "ArgocastProtocolTests", dependencies: ["ArgocastProtocol"], path: "Tests"),
    ]
)
