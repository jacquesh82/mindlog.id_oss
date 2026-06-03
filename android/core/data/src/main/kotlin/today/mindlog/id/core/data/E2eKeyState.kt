package today.mindlog.id.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.KeyPair
import javax.inject.Inject
import javax.inject.Singleton

/** État mutable partagé entre tous les managers E2E. Injectable en Singleton. */
@Singleton
class E2eKeyState @Inject constructor() {
    var pair: KeyPair? = null
    var handle: String? = null
    var pubStr: String? = null
    var privJwk: String? = null

    private val _needsRestore = MutableStateFlow(false)
    val needsRestore: StateFlow<Boolean> = _needsRestore.asStateFlow()

    private val _needsBackup = MutableStateFlow(false)
    val needsBackup: StateFlow<Boolean> = _needsBackup.asStateFlow()

    fun setNeedsRestore(v: Boolean) { _needsRestore.value = v }
    fun setNeedsBackup(v: Boolean) { _needsBackup.value = v }

    val isReady: Boolean get() = pair != null
}
