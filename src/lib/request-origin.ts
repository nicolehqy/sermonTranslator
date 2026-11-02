export function isRequestOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");

  // Some non-browser clients do not send Origin. Preserve that behavior for
  // local development tools while browser requests still receive a strict check.
  if (!origin) return true;

  try {
    const browserOrigin = new URL(origin);
    const internalUrl = new URL(request.url);
    const browserFacingHost = request.headers.get("host") ?? internalUrl.host;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      .trim();
    const browserFacingProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : internalUrl.protocol;

    return (
      browserOrigin.host === browserFacingHost &&
      browserOrigin.protocol === browserFacingProtocol
    );
  } catch {
    return false;
  }
}
