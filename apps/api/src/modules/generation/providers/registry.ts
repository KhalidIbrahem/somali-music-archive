/**
 * Provider registry — per-provider real/fake/unavailable selection.
 *
 * Selection rule (user decision, diverging deliberately from stripeGateway's
 * single prod/dev switch):
 *   • key configured        → real client (any environment)
 *   • no key, NOT production → FakeMusicProvider (keyless E2E demo works)
 *   • no key, production     → UnavailableProvider (503 at POST, no job made)
 *   • local                  → always real; the gated ai-service reports its
 *                              own status honestly per job.
 *
 * `lyria` has TWO transports for the same provider name: OpenRouter (spends
 * existing openrouter.ai credits) wins whenever OPENROUTER_API_KEY is set;
 * otherwise GEMINI_API_KEY goes direct to Google. Same wire contract either
 * way — the apps cannot tell the difference.
 */

import type { MusicProvider } from '@sma/constants';
import type { GenerateRequestInput } from '@sma/validators';
import { env, isProduction } from '@/config/env';
import type { MusicProviderClient, PollResult, SubmitResult } from './provider';
import { FakeMusicProvider } from './fake';
import { LyriaProvider } from './lyria';
import { OpenRouterLyriaProvider } from './openrouterLyria';
import { SunoProvider } from './suno';
import { LocalProvider } from './local';

/** Placeholder for a keyless provider in production — gated before submit. */
class UnavailableProvider implements MusicProviderClient {
  constructor(readonly name: MusicProvider) {}

  isConfigured(): boolean {
    return false;
  }

  async submit(_input: GenerateRequestInput): Promise<SubmitResult> {
    throw new Error(`Provider ${this.name} is not configured`);
  }

  async poll(_externalId: string): Promise<PollResult> {
    return { state: 'failed', error: `Provider ${this.name} is not configured` };
  }
}

export interface ProviderRegistryConfig {
  readonly sunoApiKey: string;
  readonly sunoBaseUrl: string;
  readonly sunoModel: string;
  readonly geminiApiKey: string;
  readonly lyriaModel: string;
  readonly openRouterApiKey: string;
  readonly openRouterBaseUrl: string;
  readonly openRouterLyriaModel: string;
  readonly aiServiceUrl: string;
  readonly aiServiceApiKey: string;
  readonly callbackUrl: string;
  readonly timeoutMs: number;
  readonly production: boolean;
}

export function buildProviderRegistry(
  cfg: ProviderRegistryConfig,
): Record<MusicProvider, MusicProviderClient> {
  const fakeOr = (name: MusicProvider, real: MusicProviderClient | null): MusicProviderClient => {
    if (real) return real;
    return cfg.production ? new UnavailableProvider(name) : new FakeMusicProvider(name);
  };

  return {
    suno: fakeOr(
      'suno',
      cfg.sunoApiKey
        ? new SunoProvider({
            apiKey: cfg.sunoApiKey,
            baseUrl: cfg.sunoBaseUrl,
            model: cfg.sunoModel,
            callbackUrl: cfg.callbackUrl,
            timeoutMs: cfg.timeoutMs,
          })
        : null,
    ),
    lyria: fakeOr(
      'lyria',
      cfg.openRouterApiKey
        ? new OpenRouterLyriaProvider({
            apiKey: cfg.openRouterApiKey,
            baseUrl: cfg.openRouterBaseUrl,
            model: cfg.openRouterLyriaModel,
            timeoutMs: cfg.timeoutMs,
          })
        : cfg.geminiApiKey
          ? new LyriaProvider({
              apiKey: cfg.geminiApiKey,
              model: cfg.lyriaModel,
              timeoutMs: cfg.timeoutMs,
            })
          : null,
    ),
    local: new LocalProvider({
      baseUrl: cfg.aiServiceUrl,
      apiKey: cfg.aiServiceApiKey,
      timeoutMs: cfg.timeoutMs,
    }),
  };
}

/** The wired singleton used by the service (tests build their own registries). */
export const providerRegistry: Record<MusicProvider, MusicProviderClient> = buildProviderRegistry({
  sunoApiKey: env.SUNO_API_KEY,
  sunoBaseUrl: env.SUNO_API_BASE_URL,
  sunoModel: env.SUNO_MODEL,
  geminiApiKey: env.GEMINI_API_KEY,
  lyriaModel: env.LYRIA_MODEL,
  openRouterApiKey: env.OPENROUTER_API_KEY,
  openRouterBaseUrl: env.OPENROUTER_BASE_URL,
  openRouterLyriaModel: env.OPENROUTER_LYRIA_MODEL,
  aiServiceUrl: env.AI_SERVICE_URL,
  aiServiceApiKey: env.AI_SERVICE_API_KEY,
  callbackUrl: env.GENERATION_CALLBACK_URL || `${env.API_URL}/api/v1/generate/callback`,
  timeoutMs: env.GENERATION_PROVIDER_TIMEOUT_MS,
  production: isProduction,
});
