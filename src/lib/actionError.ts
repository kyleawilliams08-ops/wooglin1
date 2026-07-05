import { redirect } from "next/navigation";

/**
 * Server-action helper: when a Supabase write fails, bounce back to the page
 * with ?error= so the ErrorBanner shows it instead of failing silently.
 */
export function failTo(path: string, error: { message: string } | null): void {
  if (error) {
    redirect(`${path}?error=${encodeURIComponent(error.message)}`);
  }
}
