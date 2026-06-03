package today.mindlog.id.feature.call

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * Rend un [VideoTrack] WebRTC dans un SurfaceViewRenderer via AndroidView.
 * Attache/détache le sink proprement au cycle de vie de la composition.
 */
@Composable
fun VideoRenderer(
    track: VideoTrack,
    eglContext: EglBase.Context,
    modifier: Modifier = Modifier,
    mirror: Boolean = false,
) {
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                init(eglContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setMirror(mirror)
                setEnableHardwareScaler(true)
            }
        },
        update = { view -> track.addSink(view) },
        onRelease = { view ->
            runCatching { track.removeSink(view) }
            view.release()
        },
    )
}
