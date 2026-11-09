package ru.getvoxly.companion

import org.json.JSONObject

data class CallerIdActiveDeal(
    val id: String,
    val title: String,
    val budget: Double,
    val currency: String,
    val stageName: String
)

data class CallerIdContact(
    val id: String,
    val fullName: String,
    val firstName: String,
    val lastName: String,
    val middleName: String?,
    val phone: String,
    val jobTitle: String?,
    val companyName: String?,
    val crmUrl: String,
    val activeDeal: CallerIdActiveDeal?
)

data class CallerIdResult(
    val found: Boolean,
    val phone: String,
    val normalizedPhone: String,
    val contact: CallerIdContact?
) {
    companion object {
        fun fromJson(jsonStr: String): CallerIdResult {
            val root = JSONObject(jsonStr)
            val data = root.optJSONObject("data") ?: root

            val found = data.optBoolean("found", false)
            val phone = data.optString("phone", "")
            val normalizedPhone = data.optString("normalizedPhone", phone)

            val contactObj = data.optJSONObject("contact") ?: return CallerIdResult(
                found = false,
                phone = phone,
                normalizedPhone = normalizedPhone,
                contact = null
            )

            val dealObj = contactObj.optJSONObject("activeDeal")
            val activeDeal = if (dealObj != null) {
                CallerIdActiveDeal(
                    id = dealObj.optString("id", ""),
                    title = dealObj.optString("title", "Сделка"),
                    budget = dealObj.optDouble("budget", 0.0),
                    currency = dealObj.optString("currency", "RUB"),
                    stageName = dealObj.optString("stageName", "В работе")
                )
            } else null

            val contact = CallerIdContact(
                id = contactObj.optString("id", ""),
                fullName = contactObj.optString("fullName", "Клиент CRM"),
                firstName = contactObj.optString("firstName", ""),
                lastName = contactObj.optString("lastName", ""),
                middleName = contactObj.optString("middleName").takeIf { !it.isNullOrBlank() },
                phone = contactObj.optString("phone", phone),
                jobTitle = contactObj.optString("jobTitle").takeIf { !it.isNullOrBlank() },
                companyName = contactObj.optString("companyName").takeIf { !it.isNullOrBlank() },
                crmUrl = contactObj.optString("crmUrl", "https://voxly.getvoxly.ru/dashboard"),
                activeDeal = activeDeal
            )

            return CallerIdResult(
                found = true,
                phone = phone,
                normalizedPhone = normalizedPhone,
                contact = contact
            )
        }
    }
}
