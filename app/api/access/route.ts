import {
  accessCookieName,
  createAccessToken,
  passwordIsValid,
  requestHasAccess,
} from "../../shared-auth";
import { corsPreflight, withCors } from "../../api-cors";

async function handleGet(request: Request) {
  try {
    return Response.json({ authenticated: await requestHasAccess(request) });
  } catch {
    return Response.json({ authenticated: false, error: "共享密码尚未配置" }, { status: 503 });
  }
}

async function handlePost(request: Request) {
  try {
    const body = await request.json() as { password?: string };
    if (!body.password || !(await passwordIsValid(body.password))) {
      return Response.json({ error: "访问密码不正确" }, { status: 401 });
    }

    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return new Response(JSON.stringify({ authenticated: true, accessToken: await createAccessToken() }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${accessCookieName}=${await createAccessToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}`,
      },
    });
  } catch {
    return Response.json({ error: "共享密码尚未配置" }, { status: 503 });
  }
}

async function handleDelete(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ authenticated: false }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${accessCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    },
  });
}

export const OPTIONS = corsPreflight;
export async function GET(request: Request) { return withCors(request, await handleGet(request)); }
export async function POST(request: Request) { return withCors(request, await handlePost(request)); }
export async function DELETE(request: Request) { return withCors(request, await handleDelete(request)); }
