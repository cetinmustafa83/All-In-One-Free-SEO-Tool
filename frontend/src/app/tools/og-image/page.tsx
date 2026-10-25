export const dynamic = "force-dynamic";

import { Image as ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { OgForm } from "./form";

export default function OgImagePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="OG image generator"
        description="Generate a 1200×630 PNG cover image from a title + subtitle + brand. Four templates (minimal / gradient / card / magazine). Rendered server-side via headless Chrome — no paid AI image API."
        icon={ImageIcon}
        accent="rose"
      />
      <OgForm />
    </div>
  );
}
