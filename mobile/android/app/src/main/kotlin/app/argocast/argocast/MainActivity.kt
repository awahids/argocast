package app.argocast.argocast

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * Flutter bridge:
 *  - MethodChannel "argocast/native": discover, startCapture, requestKeyFrame, stopCapture, deviceName
 *  - EventChannel  "argocast/frames": { data: ByteArray, key: Boolean } per encoded access unit
 */
class MainActivity : FlutterActivity() {
    private var pendingStart: MethodChannel.Result? = null
    private var pendingArgs: CaptureService.Config? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger

        EventChannel(messenger, "argocast/frames").setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink) { FrameBus.sink = events }
            override fun onCancel(arguments: Any?) { FrameBus.sink = null }
        })

        MethodChannel(messenger, "argocast/native").setMethodCallHandler { call, result ->
            when (call.method) {
                "discover" -> Discovery(applicationContext).discover(
                    (call.argument<Int>("timeoutMs") ?: 3000).toLong(),
                ) { panels -> result.success(panels) }

                "startCapture" -> {
                    if (pendingStart != null) { result.error("busy", "Capture request already pending", null); return@setMethodCallHandler }
                    pendingStart = result
                    pendingArgs = CaptureService.Config(
                        maxSize = call.argument<Int>("maxSize") ?: 1920,
                        fps = call.argument<Int>("fps") ?: 30,
                        bitrate = call.argument<Int>("bitrate") ?: 5_000_000,
                    )
                    requestNotificationPermission()
                    val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                    @Suppress("DEPRECATION")
                    startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE)
                }

                "requestKeyFrame" -> { CaptureService.instance?.requestKeyFrame(); result.success(null) }

                "stopCapture" -> {
                    stopService(Intent(this, CaptureService::class.java))
                    result.success(null)
                }

                "deviceName" -> result.success(
                    Settings.Global.getString(contentResolver, "device_name") ?: "${Build.MANUFACTURER} ${Build.MODEL}",
                )

                else -> result.notImplemented()
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_CAPTURE) return
        val result = pendingStart ?: return
        val cfg = pendingArgs!!
        pendingStart = null
        pendingArgs = null
        if (resultCode != Activity.RESULT_OK || data == null) {
            result.error("denied", "Izin merekam layar ditolak.", null)
            return
        }
        // The service must be in the foreground (type mediaProjection) before the projection is created.
        CaptureService.onStarted = { size, error ->
            runOnUiThread {
                if (error != null) result.error("capture", error, null)
                else result.success(mapOf("width" to size!!.first, "height" to size.second))
            }
        }
        val intent = Intent(this, CaptureService::class.java)
            .putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(CaptureService.EXTRA_DATA, data)
            .putExtra(CaptureService.EXTRA_MAX, cfg.maxSize)
            .putExtra(CaptureService.EXTRA_FPS, cfg.fps)
            .putExtra(CaptureService.EXTRA_BITRATE, cfg.bitrate)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
    }

    companion object {
        private const val REQ_CAPTURE = 4101
        private const val REQ_NOTIF = 4102
    }
}
