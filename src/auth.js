import { timingSafeEqual } from "node:crypto";

export const AUTH_USER_ENV = "MARKET_VIEW_USER";
export const AUTH_PASSWORD_ENV = "MARKET_VIEW_PASSWORD";

export function isAuthConfigured() {
  return Boolean(process.env[AUTH_USER_ENV] && process.env[AUTH_PASSWORD_ENV]);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function parseBasicAuth(header) {
  if (!header?.startsWith("Basic ")) return null;

  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function isAuthorizedHeader(header) {
  if (!isAuthConfigured()) return false;

  const credentials = parseBasicAuth(header);
  if (!credentials) return false;

  return (
    safeEqual(credentials.user, process.env[AUTH_USER_ENV]) &&
    safeEqual(credentials.password, process.env[AUTH_PASSWORD_ENV])
  );
}

export function isAuthorizedSecret(value, expected) {
  const supplied = String(value || "");
  const configured = String(expected || "");
  return Boolean(configured) && safeEqual(supplied, configured);
}

export function isAuthorizedCronRequest(req) {
  const header = String(req?.headers?.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return isAuthorizedSecret(token, process.env.CRON_SECRET);
}

export function requireApiAuth(req, res) {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: "Market View auth is not configured." });
    return false;
  }

  if (isAuthorizedHeader(req.headers.authorization)) return true;

  res.setHeader("WWW-Authenticate", 'Basic realm="Market View", charset="UTF-8"');
  res.status(401).json({ error: "Authentication required." });
  return false;
}
