plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "today.mindlog.id.core.datastore"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
        // Serveur par défaut : prod en release. Override debug → dev local ci-dessous.
        buildConfigField("String", "DEFAULT_SERVER", "\"https://id.mindlog.today/\"")
    }
    buildFeatures {
        buildConfig = true
    }
    buildTypes {
        debug {
            // En debug, l'app pointe par défaut sur le serveur de dev local
            // (id.mindlog.localhost → IP LAN via MindlogDns). Évite de devoir
            // « Changer de serveur » après chaque install/clear.
            buildConfigField("String", "DEFAULT_SERVER", "\"https://id.mindlog.localhost/\"")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.security.crypto)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
}
