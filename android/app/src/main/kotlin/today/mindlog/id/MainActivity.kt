package today.mindlog.id

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.AndroidEntryPoint
import today.mindlog.id.core.data.AuthState
import today.mindlog.id.core.data.NavigationBus
import androidx.compose.foundation.isSystemInDarkTheme
import today.mindlog.id.core.designsystem.theme.DefaultAccent
import today.mindlog.id.core.designsystem.theme.MindlogAccents
import today.mindlog.id.core.designsystem.theme.MindlogTheme
import today.mindlog.id.core.designsystem.theme.ThemeMode
import today.mindlog.id.core.designsystem.theme.accentFromHex
import today.mindlog.id.core.designsystem.theme.toHex
import today.mindlog.id.feature.call.CallHost
import today.mindlog.id.feature.onboarding.OnboardingRoute
import javax.inject.Inject

// BiometricPrompt exige une FragmentActivity (il s'appuie sur les fragments).
@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    @Inject lateinit var navigationBus: NavigationBus
    @Inject lateinit var accentRepository: today.mindlog.id.core.data.AccentRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Première ouverture : on choisit une couleur d'accent au hasard.
        // (après super.onCreate : l'injection Hilt des champs est faite à ce moment).
        if (accentRepository.current() == null) {
            accentRepository.set(MindlogAccents.random().color.toHex())
        }
        handleIntent(intent)
        setContent {
            val accentHex by accentRepository.accent.collectAsState()
            val accent = accentFromHex(accentHex) ?: DefaultAccent
            val modeRaw by accentRepository.themeMode.collectAsState()
            val mode = ThemeMode.fromString(modeRaw)
            val systemDark = isSystemInDarkTheme()
            val isDark = when (mode) {
                ThemeMode.LIGHT -> false
                ThemeMode.DARK -> true
                ThemeMode.SYSTEM -> systemDark
            }
            MindlogTheme(accent = accent, isDark = isDark) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MindlogApp(
                        biometricAvailable = canUseBiometric(),
                        onBiometricAuth = ::authenticateBiometric,
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /** Vrai si l'appareil dispose d'une biométrie forte exploitable et enrôlée. */
    private fun canUseBiometric(): Boolean =
        BiometricManager.from(this).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    /** Affiche l'invite biométrique ; relaie le résultat à l'UI Compose. */
    private fun authenticateBiometric(onSuccess: () -> Unit, onError: (String) -> Unit) {
        if (!canUseBiometric()) {
            onError("Biométrie indisponible sur cet appareil.")
            return
        }
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Annulation utilisateur : silence ; sinon on remonte l'erreur.
                    if (errorCode != BiometricPrompt.ERROR_USER_CANCELED &&
                        errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON
                    ) onError(errString.toString())
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Protéger votre clé")
            .setSubtitle("Confirmez avec votre empreinte ou votre visage")
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .setNegativeButtonText("Annuler")
            .build()
        prompt.authenticate(info)
    }

    /** Route un tap de notification vers une conversation ou un profil. */
    private fun handleIntent(intent: Intent?) {
        intent?.getStringExtra(RealtimeService.EXTRA_OPEN_CHAT)?.let { navigationBus.requestChat(it) }
        intent?.getStringExtra(RealtimeService.EXTRA_OPEN_PROFILE)?.let { navigationBus.requestProfile(it) }
    }
}

@Composable
private fun MindlogApp(
    biometricAvailable: Boolean,
    onBiometricAuth: (onSuccess: () -> Unit, onError: (String) -> Unit) -> Unit,
    viewModel: AppViewModel = hiltViewModel(),
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val needsBackup by viewModel.needsBackup.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current

    // Permission notifications (Android 13+), demandée une fois connecté.
    val notifPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* résultat ignoré : les notifications restent best-effort */ }

    // Démarre/arrête le service temps réel selon l'état d'authentification.
    LaunchedEffect(authState) {
        when (authState) {
            is AuthState.LoggedIn -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
                RealtimeService.start(context)
                requestIgnoreBatteryOptimizations(context) // Voie A : éviter que Doze tue le service
            }
            is AuthState.LoggedOut -> RealtimeService.stop(context)
            else -> {}
        }
    }

    Box(Modifier.fillMaxSize()) {
        when (authState) {
            is AuthState.Unknown -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is AuthState.LoggedOut -> OnboardingRoute()
            is AuthState.LoggedIn -> MainScreen(onSignedOut = { /* authState bascule sur LoggedOut */ })
        }
        // Surimpression d'appel (entrant/sortant), au-dessus de toute l'app.
        if (authState is AuthState.LoggedIn) {
            CallHost()
        }
        // Popup d'approbation d'un nouvel appareil (une fois la clé sauvegardée pour
        // ne pas empiler deux overlays bloquants).
        if (authState is AuthState.LoggedIn && !needsBackup) {
            DeviceApprovalHost()
        }
        // Invite de sauvegarde de clé au démarrage, BLOQUANTE tant que la clé E2E
        // locale n'est pas dans le coffre serveur : sans coffre, perte d'appareil =
        // messages illisibles. Parité avec la modale obligatoire du web.
        if (authState is AuthState.LoggedIn && needsBackup) {
            KeyBackupPrompt(
                biometricAvailable = biometricAvailable,
                onBiometric = {
                    onBiometricAuth(
                        { viewModel.backupWithBiometric { /* needsBackup repasse à false via le flux */ } },
                        { /* erreur biométrie : l'utilisateur peut réessayer ou choisir une passphrase */ },
                    )
                },
                onPassphrase = { pass, done -> viewModel.backupWithPassphrase(pass, done) },
                onPin = { pin, done -> viewModel.backupWithPin(pin, done) },
                mandatory = true,
            )
        }

        // Visite guidée Milo (one-shot, après backup obligatoire pour ne pas
        // empiler deux overlays). Le drapeau est persistant.
        val tourSeen by viewModel.miloTourSeen.collectAsStateWithLifecycle()
        if (authState is AuthState.LoggedIn && !needsBackup && !tourSeen) {
            MiloTour(onDismiss = { viewModel.setMiloTourSeen(true) })
        }
    }
}

/** Demande l'exemption d'optimisation batterie (une fois), pour fiabiliser le service. */
private fun requestIgnoreBatteryOptimizations(context: android.content.Context) {
    val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
    if (pm.isIgnoringBatteryOptimizations(context.packageName)) return
    runCatching {
        @android.annotation.SuppressLint("BatteryLife")
        val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = android.net.Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
