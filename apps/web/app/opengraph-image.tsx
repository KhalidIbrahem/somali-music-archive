import { ImageResponse } from 'next/og';

export const alt = 'QaraamiGenAI — Somali music preserved with AI';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The share preview (Open Graph / X) for every page. */
export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px',
        background: '#0C0B14',
        color: '#F2EEE6',
      }}
    >
      <div style={{ fontSize: 30, letterSpacing: 8, color: '#C89B5F' }}>QARAAMIGENAI</div>
      <div style={{ fontSize: 76, marginTop: 24, lineHeight: 1.1 }}>Somali music,</div>
      <div style={{ fontSize: 76, lineHeight: 1.1 }}>before the last tape fades.</div>
      <div style={{ fontSize: 30, marginTop: 36, color: '#A9A3B5' }}>
        AI-generated qaraami · sheet music from recordings · an online Somali music studio
      </div>
    </div>,
    size,
  );
}
