export const dynamic = "force-dynamic";

import { Mail } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { buildWeeklyDigest } from "@/lib/weekly-digest";
import { DigestView } from "./view";
import { loadDigestSettings } from "./actions";

export default async function DigestPage() {
  const [digest, settings] = await Promise.all([
    buildWeeklyDigest(),
    loadDigestSettings(),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Weekly digest"
        description="The Monday-morning agency-owner one-pager. Per-client wins/concerns, week-over-week aggregate, algorithm-update overlap. Copy text or HTML to email/Slack — or auto-send every Monday via SMTP."
        icon={Mail}
        accent="cyan"
      />
      <DigestView
        digest={digest}
        initialEmail={settings.recipientEmail}
        autoSendEnabled={settings.autoSendEnabled}
        lastSentAt={settings.lastSentAt}
      />
    </div>
  );
}
