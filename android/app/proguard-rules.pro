# kotlinx.serialization : conserve les serializers générés.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class today.mindlog.id.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# Tink / EncryptedSharedPreferences.
-keep class com.google.crypto.tink.** { *; }
