package ru.getvoxly.companion

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageButton
import android.widget.TextView

object VoxlyOverlayManager {
    private const val TAG = "VoxlyOverlayManager"
    private var overlayView: View? = null
    private var windowManager: WindowManager? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var autoDismissRunnable: Runnable? = null

    @SuppressLint("InflateParams")
    fun show(context: Context, info: CallerIdResult) {
        if (!Settings.canDrawOverlays(context)) {
            Log.w(TAG, "Разрешение на отображение поверх других окон не предоставлено")
            return
        }

        // Если оверлей уже показан, убираем старый
        dismiss()

        mainHandler.post {
            try {
                windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

                val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                } else {
                    @Suppress("DEPRECATION")
                    WindowManager.LayoutParams.TYPE_PHONE
                }

                val params = WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    layoutFlag,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                    PixelFormat.TRANSLUCENT
                ).apply {
                    gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                    y = 120 // отступ от верхнего края шторки One UI
                }

                val inflater = LayoutInflater.from(context)
                val view = inflater.inflate(R.layout.overlay_caller_id, null)
                overlayView = view

                val contact = info.contact
                val tvName = view.findViewById<TextView>(R.id.tvCallerName)
                val tvCompany = view.findViewById<TextView>(R.id.tvCallerCompany)
                val tvDeal = view.findViewById<TextView>(R.id.tvCallerDeal)
                val btnOpen = view.findViewById<Button>(R.id.btnOpenCrm)
                val btnClose = view.findViewById<ImageButton>(R.id.btnCloseOverlay)

                tvName.text = contact?.fullName ?: "Входящий вызов"
                tvCompany.text = contact?.companyName ?: contact?.jobTitle ?: info.normalizedPhone

                val deal = contact?.activeDeal
                if (deal != null) {
                    val budgetFormatted = String.format("%,.0f ₽", deal.budget)
                    tvDeal.text = "Сделка: ${deal.title} (${budgetFormatted}) • ${deal.stageName}"
                    tvDeal.visibility = View.VISIBLE
                } else {
                    tvDeal.visibility = View.GONE
                }

                val crmUrl = contact?.crmUrl ?: "https://voxly.getvoxly.ru/dashboard"

                btnOpen.setOnClickListener {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(crmUrl)).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        context.startActivity(intent)
                    } catch (e: Exception) {
                        Log.e(TAG, "Не удалось открыть CRM: ${e.message}")
                    }
                    dismiss()
                }

                btnClose.setOnClickListener {
                    dismiss()
                }

                windowManager?.addView(view, params)

                // Автоматическое скрытие через 45 секунд
                autoDismissRunnable = Runnable { dismiss() }
                autoDismissRunnable?.let { mainHandler.postDelayed(it, 45_000) }

            } catch (e: Exception) {
                Log.e(TAG, "Ошибка при отображении оверлея Caller ID: ${e.message}", e)
            }
        }
    }

    fun dismiss() {
        mainHandler.post {
            autoDismissRunnable?.let { mainHandler.removeCallbacks(it) }
            autoDismissRunnable = null

            if (overlayView != null && windowManager != null) {
                try {
                    windowManager?.removeView(overlayView)
                } catch (e: Exception) {
                    Log.w(TAG, "Ошибка при удалении оверлея: ${e.message}")
                }
                overlayView = null
            }
        }
    }
}
