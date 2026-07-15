// Voxly SaaS API — Analytics routes
// Manage analytics integrations (Metrika, GA4, Facebook, VK)
// Track clicks, attribution sessions, fire goals

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { encryptCredentials } from '@voxly/analytics-dispatchers';
import { prisma } from '@voxly/db';
import { nanoid } from 'nanoid';

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // =====================================
  // List analytics integrations for tenant
  // =====================================
  fastify.get('/', {
    preHandler: [(fastify as any).authenticate],
  }, async (request: any, reply) => {
    const tenantId = request.user.tenantId;
    const integrations = await prisma.analyticsIntegration.findMany({
      where: { tenantId },
      include: { addon: { select: { status: true, activeUntil: true } } },
    });
    return { integrations };
  });

  // =====================================
  // Create/update analytics integration
  // =====================================
  fastify.post('/:platform', {
    preHandler: [(fastify as any).authenticate],
  }, async (request: any, reply) => {
    const tenantId = request.user.tenantId;
    const { platform } = request.params as { platform: string };
    const { credentials, goalMappings } = request.body as any;

    if (!['metrika', 'ga4', 'facebook', 'vk'].includes(platform)) {
      return reply.code(400).send({ error: 'Invalid platform' });
    }

    // Check if tenant has active addon for this platform
    const addon = await prisma.addon.findFirst({
      where: {
        tenantId,
        type: `analytics_${platform}`,
        status: 'active',
      },
    });

    if (!addon) {
      return reply.code(403).send({
        error: 'Analytics add-on not active. Please purchase it first.',
        platform,
        priceRub: 500,
      });
    }

    const encrypted = encryptCredentials({ ...credentials, ...goalMappings });

    const integration = await prisma.analyticsIntegration.upsert({
      where: {
        tenantId_platform: { tenantId, platform: platform as any },
      },
      create: {
        tenantId,
        platform: platform as any,
        credentialsEncrypted: encrypted,
        addonId: addon.id,
        isActive: true,
      },
      update: {
        credentialsEncrypted: encrypted,
        isActive: true,
      },
    });

    return { integration };
  });

  // =====================================
  // Deactivate integration
  // =====================================
  fastify.delete('/:platform', {
    preHandler: [(fastify as any).authenticate],
  }, async (request: any, reply) => {
    const tenantId = request.user.tenantId;
    const { platform } = request.params as { platform: string };

    await prisma.analyticsIntegration.updateMany({
      where: { tenantId, platform: platform as any },
      data: { isActive: false },
    });

    return { success: true };
  });

  // =====================================
  // Public: Track click (attribution session)
  // URL: /api/analytics/click?ref=CODE&utm_source=...
  // =====================================
  fastify.get('/click/:code', async (request: any, reply) => {
    const { code } = request.params as { code: string };
    const query = request.query as any;

    const refCode = await prisma.referralCode.findUnique({
      where: { code },
      include: { tenant: true },
    });

    if (!refCode) {
      return reply.code(404).send({ error: 'Invalid referral code' });
    }

    // Create attribution session
    const clickId = `tr_${nanoid(16)}`;
    await prisma.attributionSession.create({
      data: {
        tenantId: refCode.tenantId,
        clickId,
        utmSource: query.utm_source,
        utmMedium: query.utm_medium,
        utmCampaign: query.utm_campaign,
        utmContent: query.utm_content,
        utmTerm: query.utm_term,
        yclid: query.yclid,
        gclid: query.gclid,
        fbp: query.fbp,
        fbc: query.fbclid,
      },
    });

    // Increment referral clicks
    await prisma.referralCode.update({
      where: { id: refCode.id },
      data: { clicksCount: { increment: 1 } },
    });

    return { clickId, redirectUrl: query.redirect || `https://getvoxly.ru/register?ref=${code}&click_id=${clickId}` };
  });

  // =====================================
  // Public: Track event (for bot workers to fire goals)
  // =====================================
  fastify.post('/fire', {
    preHandler: [(fastify as any).authenticate],
  }, async (request: any, reply) => {
    const tenantId = request.user.tenantId;
    const { goalName, subscriberId, clickId, value, currency } = request.body as any;

    // Look up attribution session if clickId provided
    let attribution: any = {};
    if (clickId) {
      const session = await prisma.attributionSession.findUnique({
        where: { clickId },
      });
      if (session) {
        attribution = {
          yclid: session.yclid || undefined,
          gclid: session.gclid || undefined,
          utmSource: session.utmSource || undefined,
          utmMedium: session.utmMedium || undefined,
          utmCampaign: session.utmCampaign || undefined,
        };
      }
    }

    // Fire goal to all active integrations
    const { fireGoal } = await import('@voxly/analytics-dispatchers');
    const results = await fireGoal({
      tenantId,
      goalName,
      subscriberId,
      attribution,
      value,
      currency,
    });

    return { results };
  });

  // =====================================
  // List conversion events for tenant
  // =====================================
  fastify.get('/conversions', {
    preHandler: [(fastify as any).authenticate],
  }, async (request: any, reply) => {
    const tenantId = request.user.tenantId;
    const { limit = 50, offset = 0 } = request.query as any;

    const [events, total] = await Promise.all([
      prisma.conversionEvent.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit, 10),
        skip: parseInt(offset, 10),
      }),
      prisma.conversionEvent.count({ where: { tenantId } }),
    ]);

    return { events, total };
  });

  // =====================================
  // Admin: Get analytics stats for all tenants
  // =====================================
  fastify.get('/admin/stats', {
    preHandler: [(fastify as any).requireSuperadmin],
  }, async (request: any, reply) => {
    const [totalEvents, eventsByPlatform, eventsByGoal] = await Promise.all([
      prisma.conversionEvent.count(),
      prisma.conversionEvent.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.conversionEvent.groupBy({
        by: ['goalName'],
        _count: true,
        orderBy: { _count: { goalName: 'desc' } },
        take: 20,
      }),
    ]);

    return { totalEvents, eventsByPlatform, eventsByGoal };
  });
};
