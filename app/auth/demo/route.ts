import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims) {
    const { error } = await supabase.auth.signInAnonymously();

    if (error) {
      return NextResponse.json(
        { error: "Unable to create local demo session." },
        { status: 500 }
      );
    }
  }

  return NextResponse.redirect(
    new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url)
  );
}
