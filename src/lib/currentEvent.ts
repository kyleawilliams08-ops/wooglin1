// "Which event is the app showing?" — one answer for every page and writer.
//
// Normally that's the active event. An ADMIN in test mode (Test Lab) has a
// cookie pointing at a test copy instead, so they can run a full dress
// rehearsal on realistic data while everyone else keeps seeing the real cup.
// Test copies stay status 'draft', so nobody can land on one by accident.

import { cookies } from "next/headers";
import type { createClient } from "@/lib/supabase/server";
import { requireRealPlayer, isAdmin } from "@/lib/auth";

type Supa = ReturnType<typeof createClient>;

/** Cookie holding the test event id an admin is working in (see Test Lab). */
export const TEST_EVENT_COOKIE = "wc_test_event";

export interface CurrentEvent {
  id: string;
  name: string;
  year: number;
  location: string | null;
  status: string;
  is_test: boolean;
}

/**
 * The test event this browser is in, or null. Only honored for a REAL admin
 * (masquerading doesn't drop you out of test mode) and only for events
 * flagged is_test — the cookie can never point the app at some other real
 * event.
 */
export async function getTestModeEvent(supabase: Supa): Promise<CurrentEvent | null> {
  const id = cookies().get(TEST_EVENT_COOKIE)?.value;
  if (!id) return null;
  const real = await requireRealPlayer();
  if (!isAdmin(real)) return null;
  const { data } = await supabase
    .from("events").select("id, name, year, location, status, is_test")
    .eq("id", id).eq("is_test", true).maybeSingle();
  return (data as CurrentEvent | null) ?? null;
}

/** The event the app should show: the admin's test event, else the active one. */
export async function getCurrentEvent(supabase: Supa): Promise<CurrentEvent | null> {
  const test = await getTestModeEvent(supabase);
  if (test) return test;
  // select("*") so this keeps working before the is_test migration is run
  const { data } = await supabase
    .from("events").select("*")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  const e = data?.[0];
  return e ? { ...(e as CurrentEvent), is_test: !!(e as { is_test?: boolean }).is_test } : null;
}
