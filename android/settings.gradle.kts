pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "mindlog-id"

include(":app")
include(":core:model")
include(":core:datastore")
include(":core:network")
include(":core:database")
include(":core:data")
include(":core:crypto")
include(":core:designsystem")
include(":feature:onboarding")
include(":feature:home")
include(":feature:card")
include(":feature:agenda")
include(":feature:relations")
include(":feature:requests")
include(":feature:notifications")
include(":feature:chat")
include(":feature:call")
include(":feature:gallery")
include(":core:billing")
include(":feature:premium")
include(":feature:live")
// Étapes suivantes (découpage features) :
// include(":core:ui")         // composants Compose réutilisables
