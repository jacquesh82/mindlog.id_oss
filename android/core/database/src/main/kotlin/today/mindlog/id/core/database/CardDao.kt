package today.mindlog.id.core.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow
import today.mindlog.id.core.database.entity.AgendaEventEntity
import today.mindlog.id.core.database.entity.CardFieldEntity
import today.mindlog.id.core.database.entity.ProfileEntity

@Dao
interface CardDao {

    @Query("SELECT * FROM profile WHERE id = 0")
    fun profile(): Flow<ProfileEntity?>

    @Query("SELECT * FROM card_field ORDER BY position, key")
    fun fields(): Flow<List<CardFieldEntity>>

    @Query("SELECT * FROM agenda_event ORDER BY startsAt")
    fun events(): Flow<List<AgendaEventEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertProfile(profile: ProfileEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFields(fields: List<CardFieldEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEvents(events: List<AgendaEventEntity>)

    @Query("DELETE FROM card_field")
    suspend fun clearFields()

    @Query("DELETE FROM agenda_event")
    suspend fun clearEvents()

    @Query("DELETE FROM profile")
    suspend fun clearProfile()

    /** Remplace atomiquement tout le contenu de la carte avec la réponse réseau. */
    @Transaction
    suspend fun replaceAll(
        profile: ProfileEntity,
        fields: List<CardFieldEntity>,
        events: List<AgendaEventEntity>,
    ) {
        upsertProfile(profile)
        clearFields()
        insertFields(fields)
        clearEvents()
        insertEvents(events)
    }

    /** Purge totale (déconnexion). */
    @Transaction
    suspend fun clearAll() {
        clearProfile()
        clearFields()
        clearEvents()
    }
}
