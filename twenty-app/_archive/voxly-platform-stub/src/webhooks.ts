// Voxly Platform — Webhook handlers for Twenty CRM
// These functions are triggered by Twenty when records are created/updated

export const webhooks = [
  {
    id: 'onSubscriberCreated',
    event: 'botSubscriber.created',
    handler: async (payload: any, context: any) => {
      // Sync subscriber to Voxly Control Plane
      const { voxlyApiUrl, voxlyTenantId } = context.settings;
      const response = await fetch(`${voxlyApiUrl}/webhooks/twenty/subscriber-created`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: voxlyTenantId,
          subscriber: payload.record,
        }),
      });
      return { synced: response.ok };
    },
  },
  {
    id: 'onConversationStatusChanged',
    event: 'conversation.updated',
    handler: async (payload: any, context: any) => {
      // Notify Voxly when conversation status changes (e.g., operator picks up)
      const { voxlyApiUrl, voxlyTenantId } = context.settings;
      if (payload.changes.status) {
        await fetch(`${voxlyApiUrl}/webhooks/twenty/conversation-updated`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: voxlyTenantId,
            conversationId: payload.record.id,
            changes: payload.changes,
          }),
        });
      }
      return { notified: true };
    },
  },
];
