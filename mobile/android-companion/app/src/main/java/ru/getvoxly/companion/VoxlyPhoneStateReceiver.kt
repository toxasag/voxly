package ru.getvoxly.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class VoxlyPhoneStateReceiver : BroadcastReceiver() {

    private val receiverScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    companion object {
        private const val TAG = "VoxlyPhoneReceiver"
        private var lastState = TelephonyManager.EXTRA_STATE_IDLE
        private var currentIncomingNumber: String? = null
        private var callStartTime: Long = 0
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

        Log.d(TAG, "Смена состояния звонка: $state, номер: $incomingNumber")

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                if (!incomingNumber.isNullOrBlank()) {
                    currentIncomingNumber = incomingNumber
                    callStartTime = System.currentTimeMillis()

                    receiverScope.launch {
                        val result = VoxlyApiClient.lookupCaller(context, incomingNumber)
                        if (result != null && result.found) {
                            VoxlyOverlayManager.show(context, result)
                        }
                    }
                }
            }

            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                // Трубка снята, разговор начался
                lastState = state
            }

            TelephonyManager.EXTRA_STATE_IDLE -> {
                // Разговор завершен или вызов сброшен
                VoxlyOverlayManager.dismiss()

                val phone = currentIncomingNumber
                if (!phone.isNullOrBlank()) {
                    val wasAnswered = lastState == TelephonyManager.EXTRA_STATE_OFFHOOK
                    val durationSeconds = if (wasAnswered && callStartTime > 0) {
                        ((System.currentTimeMillis() - callStartTime) / 1000).toInt()
                    } else {
                        0
                    }

                    receiverScope.launch {
                        VoxlyApiClient.logCall(
                            context = context,
                            phone = phone,
                            direction = "inbound",
                            status = if (wasAnswered) "answered" else "missed",
                            durationSeconds = durationSeconds
                        )
                    }
                }

                currentIncomingNumber = null
                callStartTime = 0
                lastState = state
            }
        }
    }
}
