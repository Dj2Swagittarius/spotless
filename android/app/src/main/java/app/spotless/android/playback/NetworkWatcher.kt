package app.spotless.android.playback

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/** Reports the default network the way adaptive.ts reads navigator.connection. Callbacks arrive off the main thread. */
class NetworkWatcher(context: Context, private val onChange: (NetworkInfo) -> Unit) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = onChange(read(caps))
        override fun onLost(network: Network) = onChange(NetworkInfo(supported = false, metered = false))
    }

    fun start() {
        cm.registerDefaultNetworkCallback(callback)
        cm.activeNetwork?.let(cm::getNetworkCapabilities)?.let { onChange(read(it)) }
    }

    fun stop() {
        runCatching { cm.unregisterNetworkCallback(callback) }
    }

    private fun read(caps: NetworkCapabilities) = NetworkInfo(
        supported = true,
        metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
        downlinkMbps = caps.linkDownstreamBandwidthKbps.takeIf { it > 0 }?.let { it / 1000.0 },
        saveData = cm.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED,
    )
}
