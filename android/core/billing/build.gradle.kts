plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "today.mindlog.id.core.billing"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
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
    api(libs.play.billing) // ProductDetails/Purchase fuient dans l'API publique
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
}
