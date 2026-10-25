"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import {
  submitIndexNow,
  verifyIndexNowKeyFile,
  type SubmitState,
} from "./actions";

export function IndexNowForm() {
  const [state, formAction, pending] = useActionState<
    SubmitState | null,
    FormData
  >(submitIndexNow, null);
  const [verifyState, verifyAction, verifying] = useActionState<
    { ok: boolean; error?: string } | null,
    FormData
  >(verifyIndexNowKeyFile, null);
  const [host, setHost] = useState("");

  return (
    <>
      <form action={formAction} className="glass-apple relative overflow-hidden rounded-2xl p-5 space-y-3">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Host (your site)</span>
          <input
            name="host"
            required
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="example.com"
            className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">
            URLs (one per line, all from the host above)
          </span>
          <textarea
            name="urls"
            required
            rows={8}
            placeholder={"https://example.com/blog/post-1\nhttps://example.com/blog/post-2"}
            className="w-full rounded-md border border-white/10 bg-card/60 px-3 py-2 font-mono text-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center rounded-md bg-cyan-500/15 px-4 text-xs font-medium text-cyan-300 ring-1 ring-inset ring-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Submit URLs"}
          </button>
          <form action={verifyAction} className="inline">
            <input type="hidden" name="host" value={host} />
            <button
              type="submit"
              disabled={verifying || !host}
              className="inline-flex h-9 items-center rounded-md bg-white/5 px-4 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-white/10 hover:bg-white/10 hover:text-foreground disabled:opacity-50"
            >
              {verifying ? "Verifying…" : "Verify key file"}
            </button>
          </form>
        </div>

        {state && state.ok && (
          <div className="flex items-start gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">
                Submitted {state.submitted} URL
                {state.submitted === 1 ? "" : "s"} (HTTP {state.status}).
              </p>
              {state.status === 202 && (
                <p className="mt-1 text-emerald-300/80">
                  Note: status 202 means engines accepted the request but
                  couldn&apos;t verify the key file. Check{" "}
                  <a
                    href={state.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {state.keyUrl} <ExternalLink className="inline size-3" />
                  </a>{" "}
                  is reachable.
                </p>
              )}
            </div>
          </div>
        )}
        {state && !state.ok && (
          <div className="flex items-start gap-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{state.error}</p>
              {state.status && (
                <p className="mt-0.5 text-rose-300/80">HTTP {state.status}</p>
              )}
            </div>
          </div>
        )}

        {verifyState && verifyState.ok && (
          <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            ✓ Key file verified — engines can confirm ownership.
          </p>
        )}
        {verifyState && !verifyState.ok && verifyState.error && (
          <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
            {verifyState.error}
          </p>
        )}
      </form>
    </>
  );
}
