"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Browser print → "Save as PDF". No server-side PDF dep needed. */
export function PrintButton({ label = "Print / Save PDF" }: { label?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer data-icon="inline-start" />
      {label}
    </Button>
  );
}
