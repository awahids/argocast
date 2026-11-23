package app.argocast.argocast

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.net.Inet4Address

/**
 * Browses `_airgo._tcp` with NsdManager for [timeoutMs], resolving each panel
 * (one resolve at a time, as older Android versions require), and returns
 * [{ name, host, port }].
 */
class Discovery(private val context: Context) {
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private val pending = ArrayDeque<NsdServiceInfo>()
    private val found = LinkedHashMap<String, Map<String, Any>>()
    private var resolving = false
    private var finished = false

    fun discover(timeoutMs: Long, done: (List<Map<String, Any>>) -> Unit) {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val lock = wifi.createMulticastLock("argocast-mdns").apply { setReferenceCounted(false); acquire() }

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(TAG, "discovery failed: $errorCode")
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            override fun onServiceLost(info: NsdServiceInfo) = Unit
            override fun onServiceFound(info: NsdServiceInfo) {
                main.post { pending.addLast(info); resolveNext() }
            }
        }
        nsd.discoverServices(SERVICE, NsdManager.PROTOCOL_DNS_SD, listener)

        main.postDelayed({
            finished = true
            try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) { }
            lock.release()
            done(found.values.toList())
        }, timeoutMs)
    }

    @Suppress("DEPRECATION")
    private fun resolveNext() {
        if (resolving || finished) return
        val info = pending.removeFirstOrNull() ?: return
        resolving = true
        nsd.resolveService(info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                main.post { resolving = false; resolveNext() }
            }
            override fun onServiceResolved(s: NsdServiceInfo) {
                val host = s.host
                main.post {
                    if (host != null) {
                        val ip = if (host is Inet4Address) host.hostAddress else host.hostAddress
                        found["$ip:${s.port}"] = mapOf("name" to s.serviceName, "host" to (ip ?: ""), "port" to s.port)
                    }
                    resolving = false
                    resolveNext()
                }
            }
        })
    }

    companion object {
        private const val TAG = "argocast"
        private const val SERVICE = "_airgo._tcp."
    }
}
