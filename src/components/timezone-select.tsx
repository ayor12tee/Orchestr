"use client";

import { useEffect, useState } from "react";
import { inputClass } from "./ui";

/**
 * IANA time-zone picker. The list and the visitor's own zone are filled in
 * after mount: the server doesn't know the visitor's zone, and its list can
 * differ from the browser's. `allowInherit` adds an "inherit" choice (empty).
 */
export function TimezoneSelect({
  name = "timezone",
  defaultValue,
  detect = false,
  allowInherit,
}: {
  name?: string;
  defaultValue?: string | null;
  /** Preselect the browser's zone when there's no default. */
  detect?: boolean;
  allowInherit?: string;
}) {
  const initial = defaultValue ?? (allowInherit ? "" : "UTC");
  const [zones, setZones] = useState<string[]>([...new Set(["UTC", initial].filter(Boolean))]);
  const [zone, setZone] = useState(initial);
  useEffect(() => {
    let list: string[] = ["UTC"];
    try {
      list = Intl.supportedValuesOf("timeZone");
    } catch {}
    setZones([...new Set(["UTC", ...(initial ? [initial] : []), ...list])]);
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detect && !defaultValue && local) setZone(local);
  }, [initial, detect, defaultValue]);

  return (
    <select name={name} value={zone} onChange={(e) => setZone(e.target.value)} className={inputClass}>
      {allowInherit && <option value="">{allowInherit}</option>}
      {zones.map((z) => <option key={z} value={z}>{z}</option>)}
    </select>
  );
}
