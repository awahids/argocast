package app.argocast.argocast

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.os.Build
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent

/**
 * Touchback on Android: replays the panel's touches as accessibility gestures.
 *
 * The accessibility API cannot hold a finger down open-ended, so each finger's
 * path is recorded from down to up (with real timing) and the whole gesture is
 * dispatched once every finger is lifted: taps and long presses are exact,
 * swipes/scrolls play back right after release with their original speed.
 *
 * Remote keys map to global actions (back/home/recents; D-pad on Android 13+).
 */
class TouchService : AccessibilityService() {

    private class Stroke(val start: Long) {
        val xs = ArrayList<Float>()
        val ys = ArrayList<Float>()
        var end = 0L
        fun add(x: Float, y: Float) {
            val n = xs.size
            if (n > 0 && xs[n - 1] == x && ys[n - 1] == y) return
            if (n >= MAX_POINTS) { xs[n - 1] = x; ys[n - 1] = y; return }
            xs += x; ys += y
        }
    }

    private val live = HashMap<Int, Stroke>()
    private val finished = ArrayList<Stroke>()

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onDestroy() { instance = null; super.onDestroy() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    /** [points] = id, action (0 down, 1 up, 2 move), x, y (0..65535) repeated. Main thread. */
    fun touch(points: IntArray) {
        val now = SystemClock.uptimeMillis()
        val (w, h) = screenSize()
        var i = 0
        while (i + 3 < points.size) {
            val id = points[i]
            val action = points[i + 1]
            val x = points[i + 2] / 65535f * (w - 1)
            val y = points[i + 3] / 65535f * (h - 1)
            i += 4
            when (action) {
                ACTION_DOWN -> {
                    live.remove(id)?.let { it.end = now; finished += it } // missed up: close it
                    live[id] = Stroke(now).also { it.add(x, y) }
                }
                ACTION_MOVE -> live[id]?.add(x, y)
                ACTION_UP -> live.remove(id)?.let { it.add(x, y); it.end = now; finished += it }
            }
        }
        if (live.isEmpty() && finished.isNotEmpty()) dispatch()
    }

    private fun dispatch() {
        val strokes = finished.take(GestureDescription.getMaxStrokeCount())
        finished.clear()
        val t0 = strokes.minOf { it.start }
        val maxDur = GestureDescription.getMaxGestureDuration() - 1
        val b = GestureDescription.Builder()
        for (s in strokes) {
            val path = Path().apply {
                moveTo(s.xs[0], s.ys[0])
                for (k in 1 until s.xs.size) lineTo(s.xs[k], s.ys[k])
            }
            val start = (s.start - t0).coerceIn(0, maxDur - 1)
            val dur = (s.end - s.start).coerceIn(1, maxDur - start)
            b.addStroke(GestureDescription.StrokeDescription(path, start, dur))
        }
        try {
            dispatchGesture(b.build(), null, null)
        } catch (_: IllegalArgumentException) {
            // e.g. a path outside the screen after a rotation; drop it
        }
    }

    fun key(code: Int): Boolean {
        val action = when (code) {
            KEY_BACK -> GLOBAL_ACTION_BACK
            KEY_HOME -> GLOBAL_ACTION_HOME
            KEY_APP_SWITCH -> GLOBAL_ACTION_RECENTS
            else -> if (Build.VERSION.SDK_INT >= 33) when (code) {
                KEY_UP -> GLOBAL_ACTION_DPAD_UP
                KEY_DOWN -> GLOBAL_ACTION_DPAD_DOWN
                KEY_LEFT -> GLOBAL_ACTION_DPAD_LEFT
                KEY_RIGHT -> GLOBAL_ACTION_DPAD_RIGHT
                KEY_CENTER, KEY_ENTER -> GLOBAL_ACTION_DPAD_CENTER
                else -> return false
            } else return false
        }
        return performGlobalAction(action)
    }

    fun reset() { live.clear(); finished.clear() }

    private fun screenSize(): Pair<Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.currentWindowMetrics.bounds; b.width() to b.height()
        } else {
            val m = DisplayMetrics()
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(m); m.widthPixels to m.heightPixels
        }
    }

    companion object {
        @Volatile var instance: TouchService? = null

        private const val ACTION_DOWN = 0
        private const val ACTION_UP = 1
        private const val ACTION_MOVE = 2
        private const val MAX_POINTS = 600

        // Android keycodes as sent by the panel
        private const val KEY_HOME = 3
        private const val KEY_BACK = 4
        private const val KEY_UP = 19
        private const val KEY_DOWN = 20
        private const val KEY_LEFT = 21
        private const val KEY_RIGHT = 22
        private const val KEY_CENTER = 23
        private const val KEY_ENTER = 66
        private const val KEY_APP_SWITCH = 187
    }
}
