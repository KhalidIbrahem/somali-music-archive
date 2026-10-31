/**
 * POST /api/study — one listening-study response (components/study/ListeningStudy.tsx).
 * Zod-validated (lib/study/design.ts), at most 64 KB, stored by lib/study/store.ts.
 */

import { NextResponse } from 'next/server';
import { responseSchema } from '@/lib/study/design';
import { saveResponse } from '@/lib/study/store';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const result = await saveResponse({
    receivedAt: new Date().toISOString(),
    response: parsed.data,
  });
  if (!result.ok) {
    const status = result.reason === 'not_configured' ? 503 : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ ok: true });
}
