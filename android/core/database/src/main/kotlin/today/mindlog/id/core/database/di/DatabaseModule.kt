package today.mindlog.id.core.database.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import today.mindlog.id.core.database.CardDao
import today.mindlog.id.core.database.MindlogDatabase
import today.mindlog.id.core.database.RelationDao
import today.mindlog.id.core.database.RequestDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): MindlogDatabase =
        Room.databaseBuilder(context, MindlogDatabase::class.java, "mindlog.db")
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun provideCardDao(database: MindlogDatabase): CardDao = database.cardDao()

    @Provides
    fun provideRelationDao(database: MindlogDatabase): RelationDao = database.relationDao()

    @Provides
    fun provideRequestDao(database: MindlogDatabase): RequestDao = database.requestDao()
}
