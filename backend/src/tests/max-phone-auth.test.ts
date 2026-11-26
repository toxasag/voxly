import { describe, expect, it, vi } from "vitest";
import { AppError } from "../plugins/errorHandler.js";
import { MaxOpcode } from "../modules/messaging/adapters/max/max-protocol.js";
import { MaxNativeAuthService } from "../modules/channels/max-native-auth.service.js";

describe("MaxNativeAuthService.startPhoneAuth", () => {
  it("maps MAX captcha.validation-failed to MAX_CAPTCHA_REQUIRED and closes socket", async () => {
    const svc = new MaxNativeAuthService();
    const closeMock = vi.fn();
    const rpcMock = vi.fn().mockRejectedValue(
      new AppError(400, "CAPTCHA_VALIDATION_FAILED", "Проверка не пройдена, попробуйте ещё раз"),
    );

    vi.spyOn(
      svc as unknown as {
        resolveDeviceId: () => Promise<string>;
        openInitializedSocket: () => Promise<{
          rpc: typeof rpcMock;
          close: typeof closeMock;
        }>;
      },
      "resolveDeviceId",
    ).mockResolvedValue("11111111-1111-4111-8111-111111111111");

    vi.spyOn(
      svc as unknown as {
        openInitializedSocket: () => Promise<{
          rpc: typeof rpcMock;
          close: typeof closeMock;
        }>;
      },
      "openInitializedSocket",
    ).mockResolvedValue({ rpc: rpcMock, close: closeMock });

    await expect(
      svc.startPhoneAuth({
        tenantId: "b9ea05c5-a1af-4ecd-86a6-ad75db68fe58",
        phone: "+79660634489",
        name: "Основной",
      }),
    ).rejects.toMatchObject({
      code: "MAX_CAPTCHA_REQUIRED",
      statusCode: 400,
    });

    expect(rpcMock).toHaveBeenCalledWith(MaxOpcode.AUTH_REQUEST, {
      phone: "+79660634489",
      type: "START_AUTH",
      language: "ru",
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("reads trackId from callOutParams when top-level trackId is absent", async () => {
    const svc = new MaxNativeAuthService();
    const closeMock = vi.fn();
    const rpcMock = vi.fn().mockResolvedValue({
      token: "auth-tok-123",
      codeLength: 6,
      requestMaxDuration: 60,
      altActionDuration: 30,
      callOutParams: { trackId: "call-track-456" },
    });

    vi.spyOn(
      svc as unknown as { resolveDeviceId: () => Promise<string> },
      "resolveDeviceId",
    ).mockResolvedValue("11111111-1111-4111-8111-111111111111");
    vi.spyOn(
      svc as unknown as { openInitializedSocket: () => Promise<{ rpc: typeof rpcMock; close: typeof closeMock }> },
      "openInitializedSocket",
    ).mockResolvedValue({ rpc: rpcMock, close: closeMock });

    const started = await svc.startPhoneAuth({
      tenantId: "b9ea05c5-a1af-4ecd-86a6-ad75db68fe58",
      phone: "89660634489",
      name: "Основной",
    });

    expect(started.hasCallTrack).toBe(true);
    expect(started.codeLength).toBe(6);
    expect(closeMock).not.toHaveBeenCalled();
  });
});
