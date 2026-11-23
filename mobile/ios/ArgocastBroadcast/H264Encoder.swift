// Hardware H.264 encoder (VideoToolbox) producing Annex-B access units.
// Matches the other senders: Baseline, real-time, no B-frames, key frame every
// 3 s, SPS/PPS prepended to every key frame so the panel can join at any IDR.
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

final class H264Encoder {
    typealias Output = (_ annexB: Data, _ isKey: Bool) -> Void

    let width: Int32
    let height: Int32
    private var session: VTCompressionSession?
    private var transfer: VTPixelTransferSession?
    private let output: Output
    private let minFrameInterval: CMTime
    private var lastPts = CMTime.invalid
    private var forceKey = false

    init(width: Int32, height: Int32, fps: Int, bitrate: Int, output: @escaping Output) throws {
        self.width = width
        self.height = height
        self.output = output
        // ReplayKit may deliver up to 60 fps; keep only what we promised in ANNOUNCE.
        minFrameInterval = CMTime(value: 1, timescale: CMTimeScale(max(1, fps)))

        var s: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: nil, width: width, height: height, codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &s)
        guard status == noErr, let s else { throw NSError(domain: "H264Encoder", code: Int(status)) }
        session = s
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Baseline_AutoLevel)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AverageBitRate, value: bitrate as CFNumber)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_DataRateLimits,
                             value: [Double(bitrate) * 1.6 / 8, 1.0] as CFArray) // bytes per second
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: fps as CFNumber)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 3 as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(s)

        var t: VTPixelTransferSession?
        if VTPixelTransferSessionCreate(allocator: nil, pixelTransferSessionOut: &t) == noErr { transfer = t }
    }

    func requestKeyFrame() { forceKey = true }

    func encode(_ sampleBuffer: CMSampleBuffer) {
        guard let session, let source = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if lastPts.isValid, CMTimeSubtract(pts, lastPts) < minFrameInterval { return }
        lastPts = pts

        // Scale down to the announced size with the encoder's own pool (keeps memory low).
        var frame = source
        if CVPixelBufferGetWidth(source) != Int(width) || CVPixelBufferGetHeight(source) != Int(height),
           let pool = VTCompressionSessionGetPixelBufferPool(session), let transfer {
            var scaled: CVPixelBuffer?
            if CVPixelBufferPoolCreatePixelBuffer(nil, pool, &scaled) == kCVReturnSuccess, let scaled,
               VTPixelTransferSessionTransferImage(transfer, from: source, to: scaled) == noErr {
                frame = scaled
            }
        }

        var props: CFDictionary?
        if forceKey {
            forceKey = false
            props = [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary
        }
        VTCompressionSessionEncodeFrame(session, imageBuffer: frame, presentationTimeStamp: pts, duration: .invalid,
                                        frameProperties: props, infoFlagsOut: nil) { [weak self] status, _, encoded in
            guard status == noErr, let encoded, let self else { return }
            self.emit(encoded)
        }
    }

    private func emit(_ sample: CMSampleBuffer) {
        guard let block = CMSampleBufferGetDataBuffer(sample) else { return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
        let notSync = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false
        let isKey = !notSync

        var out = Data()
        let startCode: [UInt8] = [0, 0, 0, 1]
        if isKey, let fmt = CMSampleBufferGetFormatDescription(sample) {
            var count = 0
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0, parameterSetPointerOut: nil,
                                                               parameterSetSizeOut: nil, parameterSetCountOut: &count,
                                                               nalUnitHeaderLengthOut: nil)
            for i in 0..<count {
                var ptr: UnsafePointer<UInt8>?
                var size = 0
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i, parameterSetPointerOut: &ptr,
                                                                      parameterSetSizeOut: &size, parameterSetCountOut: nil,
                                                                      nalUnitHeaderLengthOut: nil) == noErr, let ptr {
                    out.append(contentsOf: startCode)
                    out.append(ptr, count: size)
                }
            }
        }

        // AVCC (4-byte big-endian lengths) -> Annex-B start codes.
        var total = 0
        var dataPtr: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &total,
                                          dataPointerOut: &dataPtr) == kCMBlockBufferNoErr, let dataPtr else { return }
        let bytes = UnsafeRawPointer(dataPtr)
        var offset = 0
        while offset + 4 <= total {
            let len = Int(bytes.load(fromByteOffset: offset, as: UInt32.self).bigEndian)
            offset += 4
            guard len > 0, offset + len <= total else { break }
            out.append(contentsOf: startCode)
            out.append(bytes.advanced(by: offset).assumingMemoryBound(to: UInt8.self), count: len)
            offset += len
        }
        output(out, isKey)
    }

    func invalidate() {
        if let session {
            VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
            VTCompressionSessionInvalidate(session)
        }
        session = nil
        if let transfer { VTPixelTransferSessionInvalidate(transfer) }
        transfer = nil
    }

    /// Longest side <= maxSize, both sides multiples of 16, aspect ratio kept.
    static func targetSize(sourceWidth: Int, sourceHeight: Int, maxSize: Int) -> (Int32, Int32) {
        let scale = min(1.0, Double(maxSize) / Double(max(sourceWidth, sourceHeight)))
        func align(_ v: Double) -> Int32 { Int32(max(16, Int((v / 16).rounded()) * 16)) }
        return (align(Double(sourceWidth) * scale), align(Double(sourceHeight) * scale))
    }
}
