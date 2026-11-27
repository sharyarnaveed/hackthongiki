"use client";

import { Cat, Coffee, Timer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { formatMinutes, getStats, type Counters, type StatsResponse } from "./lifeService";

/**
 * Small office-life stats: cups of coffee, cat pets and time spent focusing,
 * for the whole office, for you, and per teammate. Focus time includes a
 * session that's still running.
 */
export function OfficeStats({ workspaceId }: { workspaceId: string }) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getStats(workspaceId)
      .then((s) => live && setStats(s))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : "Couldn’t load the stats. Try again."));
    return () => {
      live = false;
    };
  }, [workspaceId]);

  if (error) {
    return (
      <p role="alert" className="text-terracotta">
        {error}
      </p>
    );
  }
  if (!stats) return <p className="text-muted">Counting cups…</p>;

  return (
    <>
      <section aria-labelledby="stats-office">
        <h3 id="stats-office" className="mb-2 font-semibold">
          The whole office
        </h3>
        <Tiles counters={stats.office} />
      </section>
      <section aria-labelledby="stats-you">
        <h3 id="stats-you" className="mb-2 font-semibold">
          You
        </h3>
        <Tiles counters={stats.you} />
      </section>
      {stats.members.length > 1 && (
        <section aria-labelledby="stats-team">
          <h3 id="stats-team" className="mb-2 font-semibold">
            Team
          </h3>
          <table className="w-full border-2 border-ink bg-paper text-left text-sm">
            <thead className="border-b-2 border-ink bg-paper-deep font-mono text-[0.7rem] uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-normal">
                  Name
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  Focus
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  <span className="sr-only">Coffees</span>
                  <Coffee className="ml-auto size-3.5" aria-hidden />
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  <span className="sr-only">Cat pets</span>
                  <Cat className="ml-auto size-3.5" aria-hidden />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-dashed divide-ink/15">
              {stats.members.map((m) => (
                <tr key={m.memberId} className={m.you ? "bg-sun/30" : undefined}>
                  <td className="max-w-[9rem] truncate px-2 py-1.5 font-medium">
                    {m.displayName}
                    {m.you && <span className="text-muted"> (you)</span>}
                    {m.focusing && <span className="ml-1.5 inline-block size-2 border border-ink bg-terracotta align-middle" title="Focusing now" aria-label="focusing now" />}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatMinutes(m.focusMinutes)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{m.coffees}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{m.catPets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="border-2 border-dashed border-ink/40 bg-sun/25 px-3 py-2 text-ink/80">
        Make a coffee or pet the office cat to add to the count. Focus time adds up while your status is <strong>Focusing</strong> (up to 4 hours a session).
      </p>
    </>
  );
}

function Tiles({ counters }: { counters: Counters }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      <Tile icon={<Timer className="size-4" aria-hidden />} label="Focus time" value={formatMinutes(counters.focusMinutes)} />
      <Tile icon={<Coffee className="size-4" aria-hidden />} label="Coffees" value={String(counters.coffees)} />
      <Tile icon={<Cat className="size-4" aria-hidden />} label="Cat pets" value={String(counters.catPets)} />
    </dl>
  );
}

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-2 border-ink bg-paper px-2.5 py-2">
      <dt className="flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-wide text-muted">
        {icon}
        {label}
      </dt>
      <dd className="font-pixel text-base tabular-nums">{value}</dd>
    </div>
  );
}
