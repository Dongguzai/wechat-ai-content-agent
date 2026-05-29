import type { CoverImageProvider } from "../types/cover.js";

export function forceApimartImage(
  provider: string | null | undefined
): asserts provider is CoverImageProvider {
  if (!provider?.trim()) {
    throw new Error("Cover image provider is required and must be apimart.");
  }

  if (provider !== "apimart") {
    throw new Error(
      `Cover image provider must be apimart; received "${provider}". No fallback image provider is allowed.`
    );
  }
}
