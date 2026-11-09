package ru.getvoxly.companion

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService
import android.util.Log
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

@RequiresApi(Build.VERSION_CODES.Q)
class VoxlyCallScreeningService : CallScreeningService() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    companion object {
        private const val TAG = "VoxlyCallScreening"
    }

    override fun onScreenCall(callDetails: Call.Details) {
        // Обрабатываем только входящие звонки
        if (callDetails.callDirection != Call.Details.DIRECTION_INCOMING) {
            respondToCall(callDetails, CallResponse.Builder().build())
            return
        }

        val rawNumber = callDetails.handle?.schemeSpecificPart
        if (rawNumber.isNullOrBlank()) {
            respondToCall(callDetails, CallResponse.Builder().build())
            return
        }

        Log.d(TAG, "Входящий вызов с номера: $rawNumber")

        // 1. Немедленно разрешаем прохождение звонка, чтобы телефон звонил без задержки
        val response = CallResponse.Builder()
            .setDisallowCall(false)
            .setRejectCall(false)
            .setSkipCallLog(false)
            .setSkipNotification(false)
            .build()
        respondToCall(callDetails, response)

        // 2. В параллельной корутине опрашиваем API GETVOXLY (< 50 мс) и выводим оверлей
        serviceScope.launch {
            try {
                val callerInfo = VoxlyApiClient.lookupCaller(applicationContext, rawNumber)
                if (callerInfo != null && callerInfo.found) {
                    Log.i(TAG, "Контакт найден: ${callerInfo.contact?.fullName} (${callerInfo.contact?.companyName})")
                    VoxlyOverlayManager.show(applicationContext, callerInfo)
                } else {
                    Log.d(TAG, "Контакт в CRM не найден для номера: $rawNumber")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Ошибка при выполнении Caller ID lookup: ${e.message}", e)
            }
        }
    }
}
