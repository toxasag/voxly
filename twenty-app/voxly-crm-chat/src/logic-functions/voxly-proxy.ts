import { Response, type RoutePayload } from 'twenty-sdk/logic-function';
import jpeg from 'jpeg-js';

type JwtPayload = {
  workspaceId?: string;
};

/**
 * Twenty Apps HTTP `/s/*` silently returns empty 200 when logic JSON body is too large
 * (~180KB photo → ~240KB base64 fails; ~14KB doc OK). Keep previews under this ceiling.
 */
const MAX_PREVIEW_RAW_BYTES = 48_000;

function isJpegBuffer(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function resizeRgbaNearest(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

/** Shrink JPEG (and mislabeled octet-stream photos) for Remote DOM base64 preview. */
function maybeCompressImagePreview(
  buf: Buffer,
  contentType: string,
): { buf: Buffer; contentType: string } {
  const ct = (contentType || '').toLowerCase();
  const jpegLike =
    isJpegBuffer(buf) || ct.includes('jpeg') || ct.includes('jpg');
  if (!jpegLike) {
    return { buf, contentType };
  }
  if (buf.length <= MAX_PREVIEW_RAW_BYTES && ct.startsWith('image/')) {
    return { buf, contentType: ct.includes('jpeg') || ct.includes('jpg') ? 'image/jpeg' : contentType };
  }
  try {
    const decoded = jpeg.decode(buf, {
      maxMemoryUsageInMB: 128,
      useTArray: true,
    });
    if (!decoded?.width || !decoded?.height || !decoded.data) {
      return { buf, contentType: 'image/jpeg' };
    }
    const maxEdge = 480;
    const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    const rgba =
      scale < 1
        ? resizeRgbaNearest(
            decoded.data as Uint8Array,
            decoded.width,
            decoded.height,
            w,
            h,
          )
        : Buffer.from(decoded.data);
    let quality = 55;
    let encoded = Buffer.from(
      jpeg.encode({ data: rgba, width: w, height: h }, quality).data,
    );
    while (encoded.length > MAX_PREVIEW_RAW_BYTES && quality > 28) {
      quality -= 8;
      encoded = Buffer.from(
        jpeg.encode({ data: rgba, width: w, height: h }, quality).data,
      );
    }
    if (encoded.length > MAX_PREVIEW_RAW_BYTES) {
      const tinyW = Math.max(1, Math.round(w * 0.55));
      const tinyH = Math.max(1, Math.round(h * 0.55));
      const tiny = resizeRgbaNearest(rgba, w, h, tinyW, tinyH);
      encoded = Buffer.from(
        jpeg.encode({ data: tiny, width: tinyW, height: tinyH }, 40).data,
      );
    }
    return { buf: encoded, contentType: 'image/jpeg' };
  } catch {
    return { buf, contentType: isJpegBuffer(buf) ? 'image/jpeg' : contentType };
  }
}

export function decodeWorkspaceIdFromAppToken(): string | null {
  const token = process.env.TWENTY_APP_ACCESS_TOKEN;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json) as JwtPayload;
    return typeof payload.workspaceId === 'string' ? payload.workspaceId : null;
  } catch {
    return null;
  }
}

export function voxlyApiBaseUrl(): string {
  return (process.env.VOXLY_API_URL || 'http://saas-api:3002').replace(/\/$/, '');
}

export function voxlyServiceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
}

export async function proxyToVoxlyApi(opts: {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  formData?: FormData;
  /** Non-JSON bodies → `{ dataBase64, contentType }` (CRM chat file preview). */
  binaryAsBase64?: boolean;
}): Promise<Response> {
  const token = voxlyServiceToken();
  const workspaceId = decodeWorkspaceIdFromAppToken();
  if (!token) {
    return new Response({ error: 'VOXLY_SERVICE_TOKEN is not configured' }, { status: 500 });
  }
  if (!workspaceId) {
    return new Response({ error: 'Could not resolve Twenty workspace id' }, { status: 500 });
  }

  const url = `${voxlyApiBaseUrl()}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Twenty-Workspace-Id': workspaceId,
  };
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  try {
    const res = await fetch(url, {
      method: opts.method,
      headers,
      body,
    });

    if (opts.binaryAsBase64) {
      const contentType =
        res.headers.get('content-type') || 'application/octet-stream';
      let buf = Buffer.from(await res.arrayBuffer());
      const isJson =
        contentType.includes('application/json') ||
        contentType.includes('text/json');
      if (!res.ok || isJson) {
        const text = buf.toString('utf8');
        let parsed: unknown = text ? { error: text } : {};
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { error: text };
          }
        }
        return new Response(parsed, { status: res.status });
      }
      const preview = maybeCompressImagePreview(buf, contentType);
      buf = preview.buf;
      // Oversized non-compressible payloads → explicit JSON error (not empty 200).
      if (buf.length > MAX_PREVIEW_RAW_BYTES * 2) {
        return new Response(
          {
            error: 'Attachment too large for in-app preview',
            contentType: preview.contentType,
            byteLength: buf.length,
          },
          { status: 413 },
        );
      }
      return new Response(
        {
          dataBase64: buf.toString('base64'),
          contentType: preview.contentType,
        },
        { status: res.status },
      );
    }

    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text };
      }
    } else {
      parsed = {};
    }
    return new Response(parsed, { status: res.status });
  } catch (error) {
    return new Response(
      {
        error: 'Failed to reach Voxly API',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export function recordIdFromEvent(event: RoutePayload): string | null {
  const raw = event.pathParameters?.recordId;
  return typeof raw === 'string' && raw.length >= 10 ? raw : null;
}

export function fileIdFromEvent(event: RoutePayload): string | null {
  const raw = event.pathParameters?.fileId;
  return typeof raw === 'string' && raw.length >= 10 ? raw : null;
}
