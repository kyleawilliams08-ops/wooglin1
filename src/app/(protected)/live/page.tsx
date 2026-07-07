import { redirect } from "next/navigation";

// Live and Matchups merged into the Matches board. Match pages still
// live under /live/match/[id].
export default function LiveRedirect() {
  redirect("/matches");
}
