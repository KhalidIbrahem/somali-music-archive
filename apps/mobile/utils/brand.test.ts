import { brandMessage, brandProviderName } from './brand';

describe('brandProviderName', () => {
  it('maps wire ids to QaraamiGen tiers and never leaks ids', () => {
    expect(brandProviderName('lyria')).toBe('QaraamiGen Lite');
    expect(brandProviderName('suno')).toBe('QaraamiGen Pro');
    expect(brandProviderName('local')).toBe('QaraamiGen Base');
    expect(brandProviderName('anything-else')).toBe('QaraamiGen');
  });
});

describe('brandMessage', () => {
  it.each([
    ['Lyria returned no audio — model said: no', 'QaraamiGen returned no audio — model said: no'],
    ['Lyria request failed (HTTP 429)', 'QaraamiGen request failed (HTTP 429)'],
    [
      'Suno rejected the prompt (flagged content)',
      'QaraamiGen rejected the prompt (flagged content)',
    ],
    [
      'OpenRouter request failed (HTTP 502): model overloaded',
      'The generation service failed (HTTP 502): model overloaded',
    ],
    ['The lyria provider is not configured on this server', 'This model is not available yet'],
  ])('rebrands %s', (input, expected) => {
    expect(brandMessage(input)).toBe(expected);
  });

  it('scrubs credits message and external URLs', () => {
    const out = brandMessage('OpenRouter credits exhausted — top up at openrouter.ai/credits');
    expect(out).not.toMatch(/openrouter/i);
    expect(out).toContain('credits are exhausted');
  });

  it('never leaks any provider name', () => {
    const nasty = 'Google Lyria 3 via OpenRouter and Suno and Gemini';
    expect(brandMessage(nasty)).not.toMatch(/lyria|suno|openrouter|gemini/i);
  });
});
