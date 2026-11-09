package ru.getvoxly.companion

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var etServerUrl: EditText
    private lateinit var etApiToken: EditText
    private lateinit var tvStatus: TextView
    private lateinit var btnSave: Button
    private lateinit var btnGrantOverlay: Button
    private lateinit var btnGrantScreening: Button
    private lateinit var btnGrantBattery: Button
    private lateinit var btnTestOverlay: Button

    companion object {
        private const val REQUEST_CODE_PERMISSIONS = 1001
        private const val REQUEST_CODE_ROLE = 1002
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        etServerUrl = findViewById(R.id.etServerUrl)
        etApiToken = findViewById(R.id.etApiToken)
        tvStatus = findViewById(R.id.tvConnectionStatus)
        btnSave = findViewById(R.id.btnSaveConfig)
        btnGrantOverlay = findViewById(R.id.btnGrantOverlay)
        btnGrantScreening = findViewById(R.id.btnGrantScreening)
        btnGrantBattery = findViewById(R.id.btnGrantBattery)
        btnTestOverlay = findViewById(R.id.btnTestOverlay)

        // Загрузка текущих настроек
        etServerUrl.setText(VoxlyApiClient.getBaseUrl(this))
        etApiToken.setText(VoxlyApiClient.getToken(this))

        btnSave.setOnClickListener {
            val url = etServerUrl.text.toString().trim()
            val token = etApiToken.text.toString().trim()

            if (token.isEmpty()) {
                Toast.makeText(this, "Введите API токен сотрудника", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            VoxlyApiClient.saveConfig(this, url, token)
            checkConnection(url, token)
        }

        btnGrantOverlay.setOnClickListener {
            if (!Settings.canDrawOverlays(this)) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            } else {
                Toast.makeText(this, "Разрешение уже предоставлено", Toast.LENGTH_SHORT).show()
            }
        }

        btnGrantScreening.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val roleManager = getSystemService(Context.ROLE_SERVICE) as? RoleManager
                if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
                    val intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)
                    startActivityForResult(intent, REQUEST_CODE_ROLE)
                }
            } else {
                Toast.makeText(this, "Для Android 9 и ниже используется PhoneStateListener", Toast.LENGTH_SHORT).show()
            }
        }

        btnGrantBattery.setOnClickListener {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            } else {
                Toast.makeText(this, "Оптимизация батареи уже отключена", Toast.LENGTH_SHORT).show()
            }
        }

        btnTestOverlay.setOnClickListener {
            // Тестовый показ карточки Caller ID
            val mockResult = CallerIdResult(
                found = true,
                phone = "+7 (999) 123-45-67",
                normalizedPhone = "+79991234567",
                contact = CallerIdContact(
                    id = "test-contact-id",
                    fullName = "Александр Смирнов",
                    firstName = "Александр",
                    lastName = "Смирнов",
                    middleName = "Петрович",
                    phone = "+7 (999) 123-45-67",
                    jobTitle = "Технический директор",
                    companyName = "ООО «Техносервис Групп»",
                    crmUrl = "https://voxly.getvoxly.ru/dashboard",
                    activeDeal = CallerIdActiveDeal(
                        id = "test-deal-id",
                        title = "Ремонт оборудования промышленного цеха",
                        budget = 240000.0,
                        currency = "RUB",
                        stageName = "Согласование договора"
                    )
                )
            )
            VoxlyOverlayManager.show(this, mockResult)
        }

        requestRuntimePermissions()
        updatePermissionButtonsState()
    }

    override fun onResume() {
        super.onResume()
        updatePermissionButtonsState()
    }

    private fun updatePermissionButtonsState() {
        val hasOverlay = Settings.canDrawOverlays(this)
        btnGrantOverlay.text = if (hasOverlay) "✓ Оверлей: Разрешено" else "Включить показ поверх окон"
        btnGrantOverlay.isEnabled = !hasOverlay

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val isIgnoringBattery = powerManager.isIgnoringBatteryOptimizations(packageName)
        btnGrantBattery.text = if (isIgnoringBattery) "✓ Батарея: Без ограничений" else "Отключить оптимизацию батареи"
        btnGrantBattery.isEnabled = !isIgnoringBattery
    }

    private fun requestRuntimePermissions() {
        val permissions = mutableListOf(
            android.Manifest.permission.READ_PHONE_STATE,
            android.Manifest.permission.READ_CALL_LOG
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(android.Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), REQUEST_CODE_PERMISSIONS)
        }
    }

    private fun checkConnection(url: String, token: String) {
        tvStatus.text = "Проверка подключения..."
        CoroutineScope(Dispatchers.IO).launch {
            val result = VoxlyApiClient.lookupCaller(this@MainActivity, "+79991234567")
            withContext(Dispatchers.Main) {
                if (result != null) {
                    tvStatus.text = "✓ Подключение к GETVOXLY успешно установлено"
                    tvStatus.setTextColor(getColor(android.R.color.holo_green_dark))
                } else {
                    tvStatus.text = "⚠ Ошибка авторизации. Проверьте адрес сервера и API токен."
                    tvStatus.setTextColor(getColor(android.R.color.holo_red_dark))
                }
            }
        }
    }
}
