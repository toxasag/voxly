import { query, runWithPlatformScope, runWithTenantContext } from "../db/client.js";
import { MaxBridgeService } from "../modules/channels/max-bridge.service.js";
import { ChatMediaService } from "../modules/crm/chat/media.service.js";

async function main() {
  const dealId = "bfb028d5-ef14-46a4-9c3e-388ff2cde74a";
  const messages = await runWithPlatformScope(() =>
    query<{
      id: string;
      tenant_id: string;
      channel_account_id: string;
      content: string;
      attachment: string | null;
    }>(
      `SELECT id, tenant_id, channel_account_id, content, attachment
       FROM deal_messages
       WHERE deal_id = $1 AND content LIKE '[файл: %]'
       ORDER BY created_at ASC`,
      [dealId],
    ),
  );

  console.log(`Found ${messages.length} messages to check for deal ${dealId}`);
  const bridge = new MaxBridgeService();
  const mediaService = new ChatMediaService();

  for (const msg of messages) {
    if (msg.attachment) {
      console.log(`Message ${msg.id} already has attachment: ${msg.attachment}`);
      continue;
    }

    const match = msg.content.match(/\[файл:\s*([^\]]+)\]/i);
    const fileName = match && match[1] ? match[1].trim() : null;
    if (!fileName) continue;

    console.log(`Processing message ${msg.id} with file ${fileName}`);

    // Fetch dialogs from max-bridge
    const resp = await bridge.getPrivateDialogs({
      botId: msg.channel_account_id,
      dialogLimit: 30,
      messageLimit: 50,
    });

    if (!resp.ok || !resp.dialogs) {
      console.error(`Failed to get dialogs for bot ${msg.channel_account_id}`);
      continue;
    }

    let foundAttach: { fileId?: string; fileName?: string; mimeType?: string } | null = null;
    for (const d of resp.dialogs) {
      for (const m of d.messages) {
        if (Array.isArray(m.attachments)) {
          for (const a of m.attachments) {
            if (a.fileName && a.fileName.trim().toLowerCase() === fileName.toLowerCase()) {
              foundAttach = a;
              break;
            }
          }
        }
        if (foundAttach) break;
      }
      if (foundAttach) break;
    }

    if (!foundAttach || !foundAttach.fileId) {
      console.warn(`Could not find attachment for file ${fileName} in max dialogs`);
      continue;
    }

    console.log(`Downloading media for ${fileName} (fileId: ${foundAttach.fileId})...`);
    const downloaded = await bridge.downloadMedia({
      botId: msg.channel_account_id,
      fileId: foundAttach.fileId,
    });

    if (!downloaded.ok || !downloaded.buffer) {
      console.error(`Failed to download ${fileName}: ${downloaded.error}`);
      continue;
    }

    const ext = fileName.split(".").pop()?.toLowerCase();
    const mime = ext === "pdf" ? "application/pdf" : ext === "wav" ? "audio/wav" : (downloaded.mimeType || "application/octet-stream");

    const stored = await mediaService.storeBuffer({
      buffer: downloaded.buffer,
      originalName: fileName,
      mimeType: mime,
      tenantId: msg.tenant_id,
    });

    await runWithTenantContext(msg.tenant_id, () =>
      query(
        `UPDATE deal_messages
         SET attachment = $1, attachment_type = $2
         WHERE id = $3 AND tenant_id = $4`,
        [stored.url, stored.mimeType, msg.id, msg.tenant_id],
      ),
    );

    console.log(`SUCCESS: Message ${msg.id} updated with attachment ${stored.url} (${stored.mimeType}, ${downloaded.buffer.length} bytes)`);
  }

  console.log("Done repair!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
