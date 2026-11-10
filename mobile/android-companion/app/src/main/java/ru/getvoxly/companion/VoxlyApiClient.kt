package ru.getvoxly.companion

import android.content.Context
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

object VoxlyApiClient {
    private const val TAG = "VoxlyApiClient"
    private const val PREFS_NAME = "voxly_companion_prefs"
    private const val KEY_BASE_URL = "base_url"
    private const val KEY_TOKEN = "api_token"
    private const val DEFAULT_BASE_URL = "https://api.getvoxly.ru"

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .writeTimeout(2, TimeUnit.SECONDS)
        .build()

    fun getBaseUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
    }

    fun saveConfig(context: Context, baseUrl: String, token: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_BASE_URL, baseUrl.trim().trimEnd('/'))
            .putString(KEY_TOKEN, token.trim())
            .apply()
    }

    fun getToken(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_TOKEN, "") ?: ""
    }

    /**
     * Сверхбыстрый запрос Caller ID по номеру входящего абонента (< 50 мс)
     */
    fun lookupCaller(context: Context, rawPhone: String): CallerIdResult? {
        val token = getToken(context)
        if (token.isBlank()) {
            Log.w(TAG, "API токен не задан. Настройте подключение в приложении GETVOXLY Companion.")
            return null
        }

        val baseUrl = getBaseUrl(context)
        val encodedPhone = URLEncoder.encode(rawPhone, "UTF-8")
        val url = "$baseUrl/api/v1/crm/contacts/caller-id-lookup?phone=$encodedPhone"

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .get()
            .build()

        return try {
            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) {
                Log.w(TAG, "Lookup failed with code ${response.code}")
                return null
            }
            val bodyStr = response.body?.string() ?: return null
            CallerIdResult.fromJson(bodyStr)
        } catch (e: Exception) {
            Log.e(TAG, "Error looking up caller: ${e.message}", e)
            null
        }
    }

    /**
     * Фиксация звонка в таймлайне CRM и отправка SSE-события в браузер
     */
    fun logCall(
        context: Context,
        phone: String,
        direction: String = "inbound",
        status: String = "answered",
        durationSeconds: Int = 0
    ): Boolean {
        val token = getToken(context)
        if (token.isBlank()) return false

        val baseUrl = getBaseUrl(context)
        val url = "$baseUrl/api/v1/crm/contacts/caller-id-log"

        val json = JSONObject().apply {
            put("phone", phone)
            put("direction", direction)
            put("status", status)
            put("duration_seconds", durationSeconds)
        }

        val mediaType = "application/json; charset=utf-8".toMediaType()
        val body = json.toString().toRequestBody(mediaType)

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .post(body)
            .build()

        return try {
            val response = httpClient.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            Log.e(TAG, "Error logging call: ${e.message}", e)
            false
        }
    }
}
