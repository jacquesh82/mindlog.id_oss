package today.mindlog.id.core.network

/** Lien d'invitation de contact partageable (page web `/i/<token>`) sur `baseUrl`. */
fun inviteLink(baseUrl: String, token: String): String = baseUrl + "i/" + token

/** Extrait le jeton d'un lien d'invitation scanné (`…/i/<token>`), ou null. */
fun parseInviteToken(raw: String): String? {
    val idx = raw.indexOf("/i/")
    if (idx < 0) return null
    val token = raw.substring(idx + 3).substringBefore('?').substringBefore('#').trim('/')
    return token.ifBlank { null }
}
