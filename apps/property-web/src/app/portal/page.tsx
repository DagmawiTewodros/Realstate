"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homeFor, useSession } from "@/lib/session";

/** /portal sends each person to their own portal. */
export default function PortalIndex() {
  const { user } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace(homeFor(user.role));
  }, [user, router]);
  return null;
}
