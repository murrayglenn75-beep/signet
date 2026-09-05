import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const routePath = path.join(
  root,
  "app",
  "auth",
  "demo",
  "route.ts"
);

const source = fs.readFileSync(routePath, "utf8");

describe("demo authentication boundary", () => {
  it("uses server-side demo credentials", () => {
    expect(source).toContain("process.env.DEMO_EMAIL");
    expect(source).toContain("process.env.DEMO_PASSWORD");
    expect(source).toContain("signInWithPassword");
  });

  it("does not expose demo authentication through a service-role client", () => {
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("service_role");
  });

  it("verifies protected claims before accepting the demo session", () => {
    expect(source).toContain("getClaims");
    expect(source).toContain("claims.demo_mode === true");
    expect(source).toContain("claims.org_id ===");
    expect(source).toContain(
      '"d0000000-0000-0000-0000-000000000001"'
    );
    expect(source).toContain("await supabase.auth.signOut()");
  });
});