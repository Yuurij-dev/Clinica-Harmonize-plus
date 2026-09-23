import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set({ name: sessionCookieName, value: "", maxAge: 0, path: "/" });
  return response;
}
