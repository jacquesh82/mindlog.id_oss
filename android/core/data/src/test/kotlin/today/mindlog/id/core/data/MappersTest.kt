package today.mindlog.id.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import today.mindlog.id.core.model.RequestStatus
import today.mindlog.id.core.model.Visibility
import today.mindlog.id.core.network.dto.FieldDto
import today.mindlog.id.core.network.dto.MeDto
import today.mindlog.id.core.network.dto.NotificationDto
import today.mindlog.id.core.network.dto.RelationDto
import today.mindlog.id.core.network.dto.RequestDto
import today.mindlog.id.core.network.dto.SearchResultDto

class MappersTest {

    @Test
    fun fieldDto_maps_visibility_and_blank_value() {
        val priv = FieldDto(key = "phone", label = "Téléphone", value = "", visibility = "private").toModel()
        assertEquals(Visibility.PRIVATE, priv.visibility)
        assertNull(priv.value)

        val pub = FieldDto(key = "bio", label = "Bio", value = "Salut", visibility = "public").toModel()
        assertEquals(Visibility.PUBLIC, pub.visibility)
        assertEquals("Salut", pub.value)

        val contact = FieldDto(key = "x", label = "X", value = "v", visibility = "contact").toModel()
        assertEquals(Visibility.CONTACT, contact.visibility)
    }

    @Test
    fun requestDto_maps_status() {
        fun status(s: String) = RequestDto(id = 1, name = "A", status = s).toModel().status
        assertEquals(RequestStatus.ACCEPTED, status("accepted"))
        assertEquals(RequestStatus.DECLINED, status("declined"))
        assertEquals(RequestStatus.PENDING, status("pending"))
        assertEquals(RequestStatus.PENDING, status("inconnu"))
    }

    @Test
    fun relationDto_roundtrips_via_entity() {
        val dto = RelationDto(handle = "bob", displayName = "Bob", hasPhoto = true, type = "amis", mutual = true)
        val model = dto.toEntity("direct").toModel()
        assertEquals("bob", model.handle)
        assertEquals("Bob", model.displayName)
        assertTrue(model.hasPhoto)
        assertEquals("amis", model.type)
        assertTrue(model.mutual)
    }

    @Test
    fun searchResult_blank_fields_become_null() {
        val m = SearchResultDto(handle = "x", displayName = "", title = "", hasPhoto = false).toModel()
        assertNull(m.displayName)
        assertNull(m.title)
    }

    @Test
    fun meDto_extracts_display_name_for_profile_entity() {
        val me = MeDto(
            handle = "alice",
            fields = listOf(FieldDto(key = "display_name", label = "Nom", value = "Alice")),
            hasPhoto = true,
        )
        val profile = me.toProfileEntity()
        assertEquals("alice", profile.handle)
        assertEquals("Alice", profile.displayName)
        assertTrue(profile.hasPhoto)
    }

    @Test
    fun notificationDto_maps_read_flag() {
        assertTrue(NotificationDto(id = 1, read = 1).toModel().read)
        assertEquals(false, NotificationDto(id = 2, read = 0).toModel().read)
    }
}
