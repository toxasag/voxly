import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  widgetLocaleSchema,
  WIDGET_DEFAULT_STRINGS,
  cloneChannelAccountSchema,
} from "../dist/modules/channels/channels.types.js";

describe("Webchat Locale & Internationalization (i18n)", () => {
  it("validates widgetLocaleSchema values", () => {
    assert.equal(widgetLocaleSchema.parse("ru"), "ru");
    assert.equal(widgetLocaleSchema.parse("en"), "en");
    assert.throws(() => widgetLocaleSchema.parse("de"));
    assert.throws(() => widgetLocaleSchema.parse("fr"));
  });

  it("provides comprehensive default strings for both ru and en locales", () => {
    assert.ok(WIDGET_DEFAULT_STRINGS.ru);
    assert.ok(WIDGET_DEFAULT_STRINGS.en);

    assert.equal(WIDGET_DEFAULT_STRINGS.ru.title, "Онлайн-консультант");
    assert.equal(WIDGET_DEFAULT_STRINGS.en.title, "Chat with us");

    assert.equal(WIDGET_DEFAULT_STRINGS.ru.statusText, "Онлайн");
    assert.equal(WIDGET_DEFAULT_STRINGS.en.statusText, "Online");

    assert.equal(WIDGET_DEFAULT_STRINGS.ru.badgeText, "Задайте вопрос");
    assert.equal(WIDGET_DEFAULT_STRINGS.en.badgeText, "Ask a question");

    assert.ok(WIDGET_DEFAULT_STRINGS.en.greeting.includes("Hello! How can we help you today?"));
    assert.equal(WIDGET_DEFAULT_STRINGS.en.placeholder, "Type your message...");
  });

  it("supports locale parameter in cloneChannelAccountSchema", () => {
    const parsedEn = cloneChannelAccountSchema.parse({
      external_id: "globalshop.com",
      label: "Global Store",
      locale: "en",
    });
    assert.equal(parsedEn.locale, "en");

    const parsedRu = cloneChannelAccountSchema.parse({
      domain: "myshop.ru",
      locale: "ru",
    });
    assert.equal(parsedRu.locale, "ru");
  });
});
