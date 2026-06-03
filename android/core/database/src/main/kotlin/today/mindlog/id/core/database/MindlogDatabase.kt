package today.mindlog.id.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import today.mindlog.id.core.database.entity.AgendaEventEntity
import today.mindlog.id.core.database.entity.CardFieldEntity
import today.mindlog.id.core.database.entity.MeetingRequestEntity
import today.mindlog.id.core.database.entity.ProfileEntity
import today.mindlog.id.core.database.entity.RelationEntity

@Database(
    entities = [
        ProfileEntity::class,
        CardFieldEntity::class,
        AgendaEventEntity::class,
        RelationEntity::class,
        MeetingRequestEntity::class,
    ],
    version = 2,
    exportSchema = false,
)
abstract class MindlogDatabase : RoomDatabase() {
    abstract fun cardDao(): CardDao
    abstract fun relationDao(): RelationDao
    abstract fun requestDao(): RequestDao
}
