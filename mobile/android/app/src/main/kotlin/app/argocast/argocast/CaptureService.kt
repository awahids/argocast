package app.argocast.argocast

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import android.view.WindowManager
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Foreground service (type mediaProjection) that mirrors the screen into a
 * hardware H.264 encoder and hands each access unit to Dart via FrameBus.
 * SPS/PPS (codec-config) are prepended to every key frame so the panel can
 * join at any IDR, like x264 repeat-headers on the desktop sender.
 */
class CaptureService : Service() {
    data class Config(val maxSize: Int, val fps: Int, val bitrate: Int)

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var codec: MediaCodec? = null
    private var thread: HandlerThread? = null
    private var codecConfig: ByteArray? = null
    @Volatile private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        startInForeground()
        try {
            val resultCode = intent!!.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            @Suppress("DEPRECATION")
            val data = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_DATA, Intent::class.java)
            else intent.getParcelableExtra(EXTRA_DATA)
            val cfg = Config(
                intent.getIntExtra(EXTRA_MAX, 1920),
                intent.getIntExtra(EXTRA_FPS, 30),
                intent.getIntExtra(EXTRA_BITRATE, 5_000_000),
            )
            val size = start(resultCode, data!!, cfg)
            instance = this
            onStarted?.invoke(size, null)
        } catch (e: Exception) {
            Log.e(TAG, "capture start failed", e)
            onStarted?.invoke(null, e.message ?: e.toString())
            stopSelf()
        }
        onStarted = null
        return START_NOT_STICKY
    }

    private fun start(resultCode: Int, data: Intent, cfg: Config): Pair<Int, Int> {
        val (w, h, dpi) = targetSize(cfg.maxSize)
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val mp = mpm.getMediaProjection(resultCode, data) ?: error("MediaProjection tidak tersedia")
        projection = mp
        val t = HandlerThread("argocast-encoder").also { it.start() }
        thread = t
        val handler = Handler(t.looper)
        // Android 14+ requires a callback before createVirtualDisplay.
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (running) FrameBus.error("Perekaman layar dihentikan oleh sistem.")
                stopSelf()
            }
        }, handler)

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, cfg.bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, cfg.fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 3)
            setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
            setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel41)
            setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)
            // Re-send the last frame when the screen is static so the panel keeps receiving data.
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L / cfg.fps)
        }
        val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec = enc
        enc.setCallback(object : MediaCodec.Callback() {
            override fun onInputBufferAvailable(codec: MediaCodec, index: Int) = Unit
            override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
                val sps = format.getByteBuffer("csd-0")
                val pps = format.getByteBuffer("csd-1")
                if (sps != null && pps != null) {
                    codecConfig = ByteArray(sps.remaining() + pps.remaining()).also {
                        sps.get(it, 0, sps.remaining()); pps.get(it, it.size - pps.remaining(), pps.remaining())
                    }
                }
            }
            override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
                try {
                    val buf = codec.getOutputBuffer(index)
                    if (buf != null && info.size > 0 && running) {
                        buf.position(info.offset).limit(info.offset + info.size)
                        val bytes = ByteArray(info.size).also { buf.get(it) }
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                            codecConfig = bytes
                        } else {
                            val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
                            val cfgBytes = codecConfig
                            FrameBus.frame(if (key && cfgBytes != null) cfgBytes + bytes else bytes, key)
                        }
                    }
                    codec.releaseOutputBuffer(index, false)
                } catch (e: IllegalStateException) {
                    // codec released while stopping
                }
            }
            override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
                Log.e(TAG, "encoder error", e)
                FrameBus.error("Encoder error: ${e.diagnosticInfo}")
                stopSelf()
            }
        }, handler)
        enc.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = enc.createInputSurface()
        enc.start()
        running = true
        display = mp.createVirtualDisplay(
            "argocast", w, h, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, handler,
        )
        return w to h
    }

    /** Scales the real screen so its longest side is <= maxSize; both sides even (multiple of 16 when possible). */
    private fun targetSize(maxSize: Int): Triple<Int, Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val (sw, sh) = if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.maximumWindowMetrics.bounds; b.width() to b.height()
        } else {
            val m = android.util.DisplayMetrics()
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(m); m.widthPixels to m.heightPixels
        }
        val scale = minOf(1.0, maxSize.toDouble() / max(sw, sh))
        fun align(v: Double) = max(16, (v / 16).roundToInt() * 16)
        val dpi = resources.displayMetrics.densityDpi
        return Triple(align(sw * scale), align(sh * scale), dpi)
    }

    fun requestKeyFrame() {
        try {
            codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (_: IllegalStateException) { }
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Cast layar", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, CaptureService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        val n = builder
            .setSmallIcon(android.R.drawable.ic_menu_upload)
            .setContentTitle("argocast sedang cast layar")
            .setContentText("Ketuk untuk membuka aplikasi")
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Hentikan", stop).build())
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    override fun onDestroy() {
        val wasRunning = running
        running = false
        instance = null
        try { display?.release() } catch (_: Exception) { }
        try { codec?.stop() } catch (_: Exception) { }
        try { codec?.release() } catch (_: Exception) { }
        try { projection?.stop() } catch (_: Exception) { }
        thread?.quitSafely()
        display = null; codec = null; projection = null; thread = null
        if (wasRunning) FrameBus.error("Cast dihentikan.")
        super.onDestroy()
    }

    companion object {
        private const val TAG = "argocast"
        private const val CHANNEL = "cast"
        private const val NOTIF_ID = 7
        const val ACTION_STOP = "app.argocast.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        const val EXTRA_MAX = "maxSize"
        const val EXTRA_FPS = "fps"
        const val EXTRA_BITRATE = "bitrate"

        @Volatile var instance: CaptureService? = null
        @Volatile var onStarted: ((Pair<Int, Int>?, String?) -> Unit)? = null
    }
}
