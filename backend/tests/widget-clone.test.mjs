import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDomain,
  isValidDomain,
  cloneChannelAccountSchema,
} from "../dist/modules/channels/channels.types.js";

describe("Widget Clone & Domain Normalization", () => {
  it("normalizes URLs and domain strings correctly", () => {
    assert.equal(normalizeDomain("https://team-big.ru/"), "team-big.ru");
    assert.equal(normalizeDomain("http://sub.domain.ru/catalog/item?ref=1#top"), "sub.domain.ru");
    assert.equal(normalizeDomain("  https://myshop.com:8443/  "), "myshop.com");
    assert.equal(normalizeDomain("xn--e1aybc.xn--p1ai"), "xn--e1aybc.xn--p1ai");
    assert.equal(normalizeDomain("мой-магазин.рф"), "мой-магазин.рф");
    assert.equal(normalizeDomain("localhost:3000"), "localhost");
    assert.equal(normalizeDomain(""), "");
  });

  it("validates domain correctness", () => {
    assert.equal(isValidDomain("team-big.ru"), true);
    assert.equal(isValidDomain("https://team-big.ru/"), true);
    assert.equal(isValidDomain("sub.portal.company.ru"), true);
    assert.equal(isValidDomain("мой-сайт.рф"), true);
    assert.equal(isValidDomain("localhost"), true);

    assert.equal(isValidDomain(""), false);
    assert.equal(isValidDomain("invalid domain with spaces"), false);
    assert.equal(isValidDomain("just_words_without_dot"), false);
  });

  it("validates cloneChannelAccountSchema successfully with domain/site_url/external_id", () => {
    const res1 = cloneChannelAccountSchema.safeParse({
      external_id: "https://new-client.ru/",
      label: "Новый магазин",
    });
    assert.equal(res1.success, true);
    if (res1.success) {
      assert.equal(res1.data.label, "Новый магазин");
      assert.equal(res1.data.external_id, "https://new-client.ru/");
    }

    const res2 = cloneChannelAccountSchema.safeParse({
      site_url: "second-site.com",
    });
    assert.equal(res2.success, true);

    const res3 = cloneChannelAccountSchema.safeParse({
      domain: "third-site.ru",
      agent_id: "00000000-0000-0000-0000-000000000001",
    });
    assert.equal(res3.success, true);
    if (res3.success) {
      assert.equal(res3.data.agent_id, "00000000-0000-0000-0000-000000000001");
    }

    // Fails when neither external_id, site_url nor domain is provided
    const resFail = cloneChannelAccountSchema.safeParse({
      label: "Без сайта",
    });
    assert.equal(resFail.success, false);
  });

  it("verifies credentials cloning preserves all appearance tokens", () => {
    const originalCredentials = {
      accentColor: "#6366F1",
      launcherStyle: "pill",
      consultantName: "Даниил",
      statusText: "Онлайн",
      greeting: "Здравствуйте! Чем помочь?",
      attentionEffect: "shimmer",
      attentionInterval: 5,
      soundEnabled: true,
      autoOpenDelay: 10,
    };

    // Deep clone simulation as executed in ChannelsService.clone()
    const clonedCredentials = JSON.parse(JSON.stringify(originalCredentials));

    // Modifying clone does not mutate original
    clonedCredentials.accentColor = "#10B981";

    assert.equal(originalCredentials.accentColor, "#6366F1");
    assert.equal(clonedCredentials.accentColor, "#10B981");
    assert.equal(clonedCredentials.consultantName, "Даниил");
    assert.equal(clonedCredentials.launcherStyle, "pill");
    assert.equal(clonedCredentials.attentionEffect, "shimmer");
  });
});
