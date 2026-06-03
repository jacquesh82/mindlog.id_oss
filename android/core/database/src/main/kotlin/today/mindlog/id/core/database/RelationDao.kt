package today.mindlog.id.core.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow
import today.mindlog.id.core.database.entity.RelationEntity

@Dao
interface RelationDao {

    @Query("SELECT * FROM relation WHERE kind = :kind ORDER BY displayName, handle")
    fun byKind(kind: String): Flow<List<RelationEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(relations: List<RelationEntity>)

    @Query("DELETE FROM relation")
    suspend fun clearAll()

    /** Remplace atomiquement tout le cache des relations (directes + entrantes). */
    @Transaction
    suspend fun replaceAll(direct: List<RelationEntity>, incoming: List<RelationEntity>) {
        clearAll()
        insert(direct)
        insert(incoming)
    }
}
