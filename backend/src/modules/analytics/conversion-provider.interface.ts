import type {
  AnalyticsProvider,
  ConversionEventPayload,
  ConversionResult,
} from "./analytics.types.js";

export interface IConversionProvider {
  readonly provider: AnalyticsProvider;
  sendEvent(
    payload: ConversionEventPayload,
    config: Record<string, unknown>,
  ): Promise<ConversionResult>;
}
