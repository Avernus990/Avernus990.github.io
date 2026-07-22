import { env } from "cloudflare:workers";

export const accessCookieName = "lr_wordbook_access";

function getConfiguredPassword() {
  const password = (env as unknown as { SITE_PASSWORD?: string }).SITE_PASSWORD?.trim();
  if (!password) throw new Error("SITE_PASSWORD is not configured");
  return password;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAccessToken(password = getConfiguredPassword()) {
  return sha256(`${password}|lr-wordbook-shared-access`);
}

export async function passwordIsValid(candidate: string) {
  const [candidateToken, expectedToken] = await Promise.all([
    createAccessToken(candidate),
    createAccessToken(),
  ]);
  return candidateToken === expectedToken;
}

export async function requestHasAccess(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearerToken) return bearerToken === await createAccessToken();

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieValue = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${accessCookieName}=`))
    ?.slice(accessCookieName.length + 1);
  if (!cookieValue) return false;
  return cookieValue === await createAccessToken();
}

export function unauthorizedResponse() {
  return Response.json({ error: "需要共享访问密码" }, { status: 401 });
}
