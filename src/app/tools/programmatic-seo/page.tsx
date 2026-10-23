export const dynamic = "force-dynamic";

import { Layers } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { ProgramForm } from "./form";

export default function ProgrammaticPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Programmatic SEO toolkit"
        description="Paste a CSV (one row per page) + four templates (slug / title / meta / body) using {{column}} placeholders. We generate every page, validate uniqueness, build a sitemap, and emit a manifest you can ship to your static-site generator. Ideal for city × service, comparison, or category combinations."
        icon={Layers}
        accent="violet"
      />
      <ProgramForm />
    </div>
  );
}
