"use client";

import { useActionState, useState } from "react";
import { saveOutreachTemplate, type SaveTemplateResult } from "../actions";

export function TemplateForm({
  clients,
}: {
  clients: { id: number; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<
    SaveTemplateResult | null,
    FormData
  >(saveOutreachTemplate, null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  return (
    <section className="glass-apple relative overflow-hidden rounded-2xl p-5">
      <h2 className="text-base font-semibold">New template</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Saved templates are available when sending an email to any contact.
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Name</span>
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Guest post pitch"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">
              Client (optional — leave blank for workspace-wide)
            </span>
            <select
              name="clientId"
              defaultValue=""
              className="flex h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm"
            >
              <option value="">Workspace-wide</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Subject</span>
          <input
            name="subject"
            required
            maxLength={300}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Quick suggestion for {{website}}"
            className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Body</span>
          <textarea
            name="body"
            required
            maxLength={20000}
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Hi {{name}},\n\nI came across {{website}} and...`}
            className="w-full rounded-md border border-white/10 bg-card/60 px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Tip: variables like <code>{"{{name}}"}</code> get filled per
            contact when you send.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center rounded-md bg-violet-500/15 px-4 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save template"}
          </button>
        </div>

        {state && !state.ok && (
          <p className="text-xs text-rose-300">{state.error}</p>
        )}
        {state && state.ok && (
          <p className="text-xs text-emerald-300">Saved.</p>
        )}
      </form>
    </section>
  );
}
