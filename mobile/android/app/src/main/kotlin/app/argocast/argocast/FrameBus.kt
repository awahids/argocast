package app.argocast.argocast

import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.EventChannel

/** Delivers encoded frames from the encoder thread to Dart on the main thread. */
object FrameBus {
    @Volatile var sink: EventChannel.EventSink? = null
    private val main = Handler(Looper.getMainLooper())

    fun frame(data: ByteArray, key: Boolean) {
        main.post { sink?.success(mapOf("data" to data, "key" to key)) }
    }

    fun error(message: String) {
        main.post { sink?.error("capture_stopped", message, null) }
    }
}
