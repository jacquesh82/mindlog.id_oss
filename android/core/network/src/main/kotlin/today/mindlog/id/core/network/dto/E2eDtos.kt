package today.mindlog.id.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class PubkeyBody(val pubkey: String)

/** GET /api/e2e/vault → { vault: string|null } (JSON opaque côté serveur). */
@Serializable
data class VaultDto(val vault: String? = null)

@Serializable
data class VaultBody(val vault: String)

/** GET /api/e2e/cache → cache ratchet chiffré côté client avec l'IK. */
@Serializable
data class RatchetCacheDto(val cache: String? = null)

@Serializable
data class RatchetCacheBody(val cache: String)

/* --------------------------- Prekeys X3DH (v2) --------------------------- */

@Serializable
data class OpkBody(val opkId: Int, val opkPub: String)

/** Publie/réapprovisionne mon bundle de prekeys (SPK + lot d'OPK). */
@Serializable
data class PrekeyBundleBody(val spkPub: String, val spkId: Int, val opks: List<OpkBody> = emptyList())

/** Bundle d'un contact (clés publiques) ; une OPK consommée côté serveur. */
@Serializable
data class PrekeyBundleDto(
    val ik: String = "",
    val spkPub: String = "",
    val spkId: Int = 0,
    val spkSig: String = "",
    val opkPub: String? = null,
    val opkId: Int? = null,
)

@Serializable
data class PrekeyCountDto(val available: Int = 0)

/* --------------------------- Multi-appareils ----------------------------- */

@Serializable
data class RegisterDeviceBody(val deviceId: String, val e2ePubkey: String, val name: String = "")

@Serializable
data class RegisterDeviceDto(
    val id: Long = 0,
    val deviceId: String = "",
    val approved: Boolean = false,
    val pending: Boolean = false,
)

@Serializable
data class DeviceDto(
    val id: Long = 0,
    val deviceId: String = "",
    val e2ePubkey: String = "",
    val name: String = "",
    val approved: Boolean = false,
    val createdAt: String? = null,
)

@Serializable
data class DevicesDto(val devices: List<DeviceDto> = emptyList())

/** Bundle de prekeys d'UN appareil (fan-out X3DH ; une OPK consommée serveur). */
@Serializable
data class DeviceBundleDto(
    val deviceId: String = "",
    val ik: String = "",
    val spkPub: String = "",
    val spkId: Int = 0,
    val spkSig: String = "",
    val opkPub: String? = null,
    val opkId: Int? = null,
)

@Serializable
data class DeviceBundlesDto(val devices: List<DeviceBundleDto> = emptyList())

/* ---------------- Vérification d'identité (anti-MITM) -------------------- */

@Serializable
data class VerifyBody(val safety: String)

@Serializable
data class VerifyDto(val safety: String? = null, val verifiedAt: String? = null)
