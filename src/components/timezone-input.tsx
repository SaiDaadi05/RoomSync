"use client";

import { useEffect, useState } from "react";

/** Hidden input pre-filled with the browser's timezone. */
export function BrowserTimezoneInput({ name = "timezone" }: { name?: string }) {
  const [tz, setTz] = useState("");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  return <input type="hidden" name={name} value={tz} />;
}

export function TimezoneSelect({ name, defaultValue, options }: { name: string; defaultValue?: string; options: string[] }) {
  const [value, setValue] = useState(defaultValue ?? "");
  useEffect(() => {
    if (!defaultValue) setValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [defaultValue]);
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select id={name} name={name} className="input" value={value} onChange={(e) => setValue(e.target.value)}>
      {all.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
    </select>
  );
}
