import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoriesService } from "../modules/stories/stories.service.js";
import * as dbClient from "../db/client.js";
import { registerStoryPublisher, clearOutboundSenders } from "../modules/channels/outbound-registry.js";

describe("StoriesService", () => {
  const service = new StoriesService();
  const tenantId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.restoreAllMocks();
    clearOutboundSenders();
  });

  it("успешно создает черновик сторис с дефолтным статусом", async () => {
    const mockRow = {
      id: "story-1",
      tenant_id: tenantId,
      channel_account_id: null,
      channel: "telegram",
      media_url: "https://storage.getvoxly.ru/stories/photo1.jpg",
      media_type: "photo",
      text: "Скидка на ремонт 20%!",
      link_url: "https://getvoxly.ru/promo",
      link_text: "Записаться",
      views_count: 0,
      reactions_count: 0,
      status: "published",
      scheduled_at: null,
      posted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    vi.spyOn(dbClient, "queryOne").mockResolvedValueOnce(mockRow);

    const created = await service.create(tenantId, {
      mediaUrl: "https://storage.getvoxly.ru/stories/photo1.jpg",
      text: "Скидка на ремонт 20%!",
      linkUrl: "https://getvoxly.ru/promo",
      linkText: "Записаться",
    });

    expect(created.id).toBe("story-1");
    expect(created.mediaUrl).toBe("https://storage.getvoxly.ru/stories/photo1.jpg");
    expect(created.channel).toBe("telegram");
    expect(created.status).toBe("published");
  });

  it("помечает сторис как scheduled при наличии даты отложенной публикации", async () => {
    const scheduledAt = new Date(Date.now() + 86400000).toISOString();
    const mockRow = {
      id: "story-scheduled",
      tenant_id: tenantId,
      channel_account_id: null,
      channel: "max",
      media_url: "https://storage.getvoxly.ru/stories/video1.mp4",
      media_type: "video",
      text: "Премьера новинок",
      link_url: null,
      link_text: null,
      views_count: 0,
      reactions_count: 0,
      status: "scheduled",
      scheduled_at: scheduledAt,
      posted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    vi.spyOn(dbClient, "queryOne").mockResolvedValueOnce(mockRow);

    const created = await service.create(tenantId, {
      channel: "max",
      mediaUrl: "https://storage.getvoxly.ru/stories/video1.mp4",
      mediaType: "video",
      text: "Премьера новинок",
      scheduledAt,
    });

    expect(created.status).toBe("scheduled");
    expect(created.scheduledAt).toBe(scheduledAt);
  });

  it("возвращает список сторис тенанта с пагинацией", async () => {
    vi.spyOn(dbClient, "queryOne").mockResolvedValueOnce({ total: "1" });
    vi.spyOn(dbClient, "query").mockResolvedValueOnce([
      {
        id: "story-1",
        tenant_id: tenantId,
        channel_account_id: null,
        channel: "telegram",
        media_url: "https://storage.getvoxly.ru/stories/photo1.jpg",
        media_type: "photo",
        text: "Скидка",
        link_url: null,
        link_text: null,
        views_count: 42,
        reactions_count: 5,
        status: "published",
        scheduled_at: null,
        posted_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const result = await service.list(tenantId, { limit: 10, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.viewsCount).toBe(42);
  });

  it("вызывает зарегистрированный издатель канала при вызове publish", async () => {
    const mockStory = {
      id: "story-publish-1",
      tenant_id: tenantId,
      channel_account_id: "acc-tg-1",
      channel: "telegram",
      media_url: "https://storage.getvoxly.ru/stories/story.jpg",
      media_type: "photo",
      text: "Горячее предложение!",
      link_url: "https://getvoxly.ru",
      link_text: "Подробнее",
      views_count: 0,
      reactions_count: 0,
      status: "scheduled",
      scheduled_at: null,
      posted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const publishedPayloads: unknown[] = [];
    registerStoryPublisher("telegram", async (payload) => {
      publishedPayloads.push(payload);
      return { ok: true, externalId: "12345" };
    });

    vi.spyOn(dbClient, "queryOne").mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM story_posts")) {
        return mockStory as unknown as never;
      }
      if (sql.includes("UPDATE story_posts") && sql.includes("status = 'published'")) {
        return { ...mockStory, status: "published" } as unknown as never;
      }
      return null as unknown as never;
    });

    const published = await service.publish(tenantId, "story-publish-1");
    expect(published.status).toBe("published");
    expect(publishedPayloads).toHaveLength(1);
    expect(publishedPayloads[0]).toMatchObject({
      tenantId,
      channelAccountId: "acc-tg-1",
      mediaUrl: "https://storage.getvoxly.ru/stories/story.jpg",
      caption: "Горячее предложение!",
    });
  });
});
