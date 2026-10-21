/** Read credentials from ISeating's page literals, never from surrounding JS code. */
export function parseLibrarySession(html: string): { token: string; userId: string } | null {
  const token =
    /(?:window\.)?ska\.access_token\s*=\s*["']([A-Za-z0-9._-]{16,})["']/.exec(html)?.[1] ??
    /["']access_token["']\s*:\s*["']([A-Za-z0-9._-]{16,})["']/.exec(html)?.[1] ??
    /(?:^|[{,])\s*access_token\s*:\s*["']([A-Za-z0-9._-]{16,})["']/.exec(html)?.[1] ??
    /\baccess_token\s*=\s*["']([A-Za-z0-9._-]{16,})["']/.exec(html)?.[1] ??
    /\baccess_token=([A-Za-z0-9._-]{16,})(?=[&"'#\s<]|$)/.exec(html)?.[1];
  if (!token) return null;
  const userId =
    /(?:window\.)?ska\.userid\s*=\s*["']([^"'\s]{1,128})["']/.exec(html)?.[1] ??
    /["']userid["']\s*:\s*["']([^"'\s]{1,128})["']/.exec(html)?.[1] ??
    /(?:^|[{,])\s*userid\s*:\s*["']([^"'\s]{1,128})["']/.exec(html)?.[1] ??
    "";
  return { token, userId };
}
