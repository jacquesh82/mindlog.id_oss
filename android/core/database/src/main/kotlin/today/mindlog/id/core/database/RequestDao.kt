package today.mindlog.id.core.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow
import today.mindlog.id.core.database.entity.MeetingRequestEntity

@Dao
interface RequestDao {

    // En attente d'abord, puis les plus récentes (miroir du backend).
    @Query(
        "SELECT * FROM meeting_request ORDER BY (status = 'pending') DESC, createdAt DESC",
    )
    fun all(): Flow<List<MeetingRequestEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(requests: List<MeetingRequestEntity>)

    @Query("DELETE FROM meeting_request")
    suspend fun clearAll()

    @Transaction
    suspend fun replaceAll(requests: List<MeetingRequestEntity>) {
        clearAll()
        insert(requests)
    }
}
