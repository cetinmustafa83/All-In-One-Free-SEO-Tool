import { SearchPalette } from "./search-palette";
import { NotificationsBell } from "./notifications-bell";
import { ModeToggle } from "./mode-toggle";
import { AddClientButton } from "./add-client-button";
import { MobileNav } from "./mobile-nav";
import { AiUsagePill } from "./ai-usage-pill";
import { ProfileMenu } from "./profile-menu";
import { NextStep } from "./next-step";
import { ThemeToggle } from "./theme-toggle";
import { getUiMode } from "@/app/settings/ui-actions";
import type { ThemePreference } from "@/app/settings/theme-actions";

export async function TopBar({
  unreadByHref,
  theme = "system",
}: {
  unreadByHref?: Record<string, number>;
  theme?: ThemePreference;
}) {
  const mode = await getUiMode();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <MobileNav unreadByHref={unreadByHref} />
      <SearchPalette />
      <NextStep />
      <div className="ml-auto flex items-center gap-1">
        {/* Desktop-only affordances: both are wide, non-critical, and were
            the reason the header overflowed a 390px viewport by ~111px.
            Phones get the core actions (add client, theme, bell, profile). */}
        <div className="hidden items-center gap-1 md:flex">
          <AiUsagePill />
          <ModeToggle mode={mode} />
        </div>
        <AddClientButton />
        <ThemeToggle theme={theme} />
        <NotificationsBell />
        <ProfileMenu />
      </div>
    </header>
  );
}
