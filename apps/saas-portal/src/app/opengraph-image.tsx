import { ImageResponse } from 'next/og';

export const alt = 'Voxly';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Link-preview image for messengers — wordmark only, no mascot. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse 70% 55% at 20% 0%, rgba(37,99,235,0.14), transparent 55%), radial-gradient(ellipse 55% 45% at 90% 100%, rgba(16,185,129,0.08), transparent 50%)',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 96,
            height: 96,
            borderRadius: 24,
            background: '#2563EB',
            color: '#ffffff',
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: '-0.04em',
          }}
        >
          V
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: '-0.04em',
            color: '#0F172A',
          }}
        >
          Voxly
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 28,
            color: '#64748B',
            letterSpacing: '-0.01em',
          }}
        >
          CRM · WhatsApp · Telegram · Max
        </div>
      </div>
    ),
    { ...size },
  );
}
