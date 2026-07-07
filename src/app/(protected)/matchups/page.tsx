import { redirect } from "next/navigation";

// Merged into the Matches board.
export default function MatchupsRedirect() {
  redirect("/matches");
}
