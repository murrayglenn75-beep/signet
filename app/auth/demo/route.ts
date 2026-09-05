import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const demoEmail = process.env.DEMO_EMAIL;
  const demoPassword = process.env.DEMO_PASSWORD;

  if (!demoEmail || !demoPassword) {
    return NextResponse.redirect(
      new URL("/login?demo_error=unavailable", request.url)
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: demoEmail,
    password: demoPassword,
  });

  if (error) {
    return NextResponse.redirect(
      new URL("/login?demo_error=signin_failed", request.url)
    );
  }

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  const claims = claimsData?.claims;

  const isDemoSession =
    !claimsError &&
    claims &&
    claims.demo_mode === true &&
    claims.org_id ===
      "d0000000-0000-0000-0000-000000000001";

  if (!isDemoSession) {
    await supabase.auth.signOut();

    return NextResponse.redirect(
      new URL("/login?demo_error=invalid_demo_identity", request.url)
    );
  }

  return NextResponse.redirect(
    new URL(
      safeNext(request.nextUrl.searchParams.get("next")),
      request.url
    )
  );
}