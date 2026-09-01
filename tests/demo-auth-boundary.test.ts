import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("demo authentication boundary", () => {
  const routePath = path.join(
    process.cwd(),
    "app",
    "auth",
    "demo",
    "route.ts"
  );

  const source = fs.readFileSync(routePath, "utf8");

  it("blocks demo authentication in production", () => {
    expect(source).toContain('process.env.NODE_ENV === "production"');
    expect(source).toContain("Demo authentication is disabled.");
  });

  it("does not expose demo authentication through a service-role client", () => {
    expect(source).not.toMatch(/SERVICE_ROLE/i);
    expect(source).not.toMatch(/service_role/i);
  });

  it("uses claims rather than trusting a raw session", () => {
    expect(source).toContain("auth.getClaims()");
    expect(source).not.toContain("auth.getSession()");
  });
});
