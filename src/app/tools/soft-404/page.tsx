export const dynamic = "force-dynamic";

import { Unlink } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Soft404Form } from "./form";

export default function Soft404Page() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Soft 404 catcher"
        description="Crawl a site, flag pages that return 200 but smell like 404s — thin content (<100 visible words), '404'/'page not found' text patterns, generic error titles. Google labels these soft-404 in GSC and won't index them; most teams never check."
        icon={Unlink}
        accent="rose"
      />
      <Soft404Form />
    </div>
  );
}
