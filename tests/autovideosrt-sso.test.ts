import { describe, expect, test, mock } from "bun:test";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";

const secret = "test-sso-secret-for-unit-tests";
process.env.DRAWING_STUDIO_SSO_SECRET = secret;

const dbCalls: { kind: string; args: unknown[] }[] = [];
function record<TArgs extends unknown[], TResult>(kind: string, fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult {
  return (...args: TArgs) => {
    dbCalls.push({ kind, args });
    return fn(...args);
  };
}

const dbGetUserByEmail = record("getUserByEmail", () => null);
const dbCreateUser = record("createUser", (input: Record<string, unknown>) => ({
  id: `usr-test-${String(input.email).replace(/[^a-z0-9]/g, "-")}`,
  email: input.email,
  name: input.name,
  password_hash: String(input.passwordHash ?? ""),
  role: input.role ?? "member",
  group_id: input.groupId ?? null,
  monthly_quota: input.monthlyQuota ?? null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));
const dbUpdateUser = record("updateUser", () => ({}));
const dbGetDefaultGroup = () => ({ id: "grp_default", name: "默认", monthly_quota: 100 });
const dbGetRegistrationSettings = () => ({
  registrationEnabled: true,
  registrationDefaultGroupId: "grp_default",
  registrationDefaultQuota: 100,
});

mock.module("@/lib/db", () => ({
  getUserByEmail: dbGetUserByEmail,
  createUser: dbCreateUser,
  updateUser: dbUpdateUser,
  getDefaultGroup: dbGetDefaultGroup,
  getRegistrationSettings: dbGetRegistrationSettings,
}));

mock.module("@/lib/auth", () => ({
  createUserSession: () => ({ token: "test-session-token" }),
  setSessionCookie: (response: Response, _token: string) => {
    response.headers.set("set-cookie", `image_gen_session=${_token}; HttpOnly; Path=/`);
  },
}));

let _GET: ((request: NextRequest) => Promise<Response>) | null = null;

async function callSSO(params: Record<string, string>): Promise<Response> {
  if (!_GET) {
    _GET = (await import("@/app/api/auth/autovideosrt-sso/route")).GET;
  }
  const { NextRequest: NR } = await import("next/server");
  const url = new URL("http://localhost/api/auth/autovideosrt-sso");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return _GET(new NR(url));
}

function buildSig(params: Record<string, string>): string {
  const payload = new URLSearchParams(
    Object.entries(params)
      .filter(([key]) => key !== "sig")
      .sort(([left], [right]) => left.localeCompare(right)),
  ).toString();
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function lastCall(kind: string): unknown[] | undefined {
  for (let i = dbCalls.length - 1; i >= 0; i--) {
    if (dbCalls[i].kind === kind) return dbCalls[i].args;
  }
  return undefined;
}

function callCount(kind: string): number {
  return dbCalls.filter((c) => c.kind === kind).length;
}

describe("AutoVideoSrt SSO", () => {
  test("valid signature returns 302 with session cookie", async () => {
    const base = {
      avs_user_id: "test-user-1",
      avs_username: "测试用户",
      avs_role: "member",
      exp: String(Math.floor(Date.now() / 1000) + 300),
      nonce: "abc123",
    };
    const sig = buildSig(base);
    const response = await callSSO({ ...base, sig });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie") ?? "").toContain("image_gen_session=");
    expect(callCount("createUser")).toBeGreaterThan(0);
  });

  test("expired token returns 401", async () => {
    const base = {
      avs_user_id: "expired-user",
      avs_username: "expired",
      avs_role: "member",
      exp: String(Math.floor(Date.now() / 1000) - 60),
      nonce: "old-nonce",
    };
    const sig = buildSig(base);
    const response = await callSSO({ ...base, sig });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain("过期");
  });

  test("wrong signature returns 403", async () => {
    const base = {
      avs_user_id: "bad-sig-user",
      avs_username: "bad-sig",
      avs_role: "member",
      exp: String(Math.floor(Date.now() / 1000) + 300),
      nonce: "xyz",
    };
    const response = await callSSO({ ...base, sig: "deadbeef" });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("签名");
  });

  test("role mapping: admin -> admin", async () => {
    const base = {
      avs_user_id: "admin-role-user",
      avs_username: "Admin",
      avs_role: "admin",
      exp: String(Math.floor(Date.now() / 1000) + 300),
      nonce: "ar-nonce",
    };
    const sig = buildSig(base);
    const response = await callSSO({ ...base, sig });
    expect(response.status).toBe(302);

    const args = lastCall("createUser");
    expect((args![0] as Record<string, unknown>).role).toBe("admin");
  });

  test("role mapping: superadmin -> admin", async () => {
    const base = {
      avs_user_id: "superadmin-role-user",
      avs_username: "SuperAdmin",
      avs_role: "superadmin",
      exp: String(Math.floor(Date.now() / 1000) + 300),
      nonce: "sar-nonce",
    };
    const sig = buildSig(base);
    const response = await callSSO({ ...base, sig });
    expect(response.status).toBe(302);

    const args = lastCall("createUser");
    expect((args![0] as Record<string, unknown>).role).toBe("admin");
  });

  test("role mapping: unknown -> member", async () => {
    const base = {
      avs_user_id: "random-role-user",
      avs_username: "Random",
      avs_role: "unknown_role_xyz",
      exp: String(Math.floor(Date.now() / 1000) + 300),
      nonce: "rrr-nonce",
    };
    const sig = buildSig(base);
    const response = await callSSO({ ...base, sig });
    expect(response.status).toBe(302);

    const args = lastCall("createUser");
    expect((args![0] as Record<string, unknown>).role).toBe("member");
  });

  test("missing params returns 400", async () => {
    const response = await callSSO({ avs_user_id: "only-one" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("缺少参数");
  });
});
