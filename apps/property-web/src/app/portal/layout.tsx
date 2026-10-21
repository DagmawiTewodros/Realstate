"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import { PortalShell } from "@/components/PortalShell";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider require={["LANDLORD", "TENANT"]}>
      <PortalShell>{children}</PortalShell>
    </SessionProvider>
  );
}
