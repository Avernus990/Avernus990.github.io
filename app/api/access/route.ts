import {
  accessCookieName,
  createAccessToken,
  passwordIsValid,
  requestHasAccess,
} from "../../shared-auth";

export async function GET(request: Request) {
  try {
    return Response.json({ authenticated: await requestHasAccess(request) });
  } catch {
    return Response.json({ authenticated: false, error: "共享密码尚未配置" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { password?: string };
    if (!body.password || !(await passwordIsValid(body.password))) {
      return Response.json({ error: "访问密码不正确" }, { status: 401 });
    }

    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return new Response(JSON.stringify({ authenticated: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${accessCookieName}=${await createAccessToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}`,
      },
    });
  } catch {
    return Response.json({ error: "共享密码尚未配置" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ authenticated: false }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${accessCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    },
  });
}
