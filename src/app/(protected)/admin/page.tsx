import { redirect } from "next/navigation";

// The old Admin index is now the Menu (clubhouse pages for everyone,
// commissioner tools for admins). Admin subpages keep their /admin/* URLs.
export default function AdminIndexRedirect() {
  redirect("/menu");
}
