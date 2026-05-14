import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appConfig } from "@/lib/config";
import { createUserSession, setSessionCookie } from "@/lib/auth";
import { createUser, getDefaultGroup, getRegistrationSettings, getUserByEmail, updateUser } from "@/lib/db";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildCanonicalPayload(params: URLSearchParams): string {
  return new URLSearchParams(
    Array.from(params.entries())
      .filter(([key]) => key !== "sig")
      .sort(([left], [right]) => left.localeCompare(right)),
  ).toString();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = appConfig.drawingStudioSsoSecret;
  if (!secret) {
    return NextResponse.json({ error: "SSO 未配置" }, { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const avsUserId = params.get("avs_user_id");
  const avsUsername = params.get("avs_username");
  const avsRole = params.get("avs_role");
  const exp = params.get("exp");
  const nonce = params.get("nonce");
  const sig = params.get("sig");

  if (!avsUserId || !avsUsername || !avsRole || !exp || !nonce || !sig) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }

  const payload = buildCanonicalPayload(params);
  const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) {
    return NextResponse.json({ error: "签名验证失败" }, { status: 403 });
  }

  const age = Date.now() / 1000 - Number(exp);
  if (age > 0) {
    return NextResponse.json({ error: `链接已过期 (${age.toFixed(0)}s)` }, { status: 401 });
  }

  const email = `autovideosrt-${avsUserId}@internal.local`;
  const role: UserRole = ["admin", "superadmin"].includes(avsRole) ? "admin" : "member";

  let user = getUserByEmail(email);
  if (!user) {
    const groupId = getRegistrationSettings().registrationDefaultGroupId || getDefaultGroup().id;
    const monthlyQuota = getRegistrationSettings().registrationDefaultQuota;
    user = createUser({
      email,
      name: avsUsername,
      passwordHash: "",
      role,
      groupId,
      monthlyQuota,
    });
  } else if (user.role !== role) {
    updateUser(user.id, { role });
  }

  const { token } = createUserSession(user.id);
  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: "/" },
  });
  setSessionCookie(response, token);
  return response;
}
