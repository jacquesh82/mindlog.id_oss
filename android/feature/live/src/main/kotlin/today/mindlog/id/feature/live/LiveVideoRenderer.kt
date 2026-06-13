package today.mindlog.id.feature.live

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * Rend un [VideoTrack] WebRTC dans un SurfaceViewRenderer (broadcaster preview
 * ou viewer remote track). Miroir de feature:call/VideoRenderer — dupliqué pour
 * ne pas créer une dépendance feature:live → feature:call.
 */
@Composable
internal fun LiveVideoRenderer(
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
