/**
 * VIBA Date/Time Tools
 *
 * datetime_parse   — parse any date string and return ISO + components + timezone info
 * datetime_format  — format a date with a custom pattern and timezone
 * datetime_diff    — calculate the difference between two dates in any unit
 * cron_next        — calculate the next N execution times for a cron expression
 */

export interface DateTimeTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function num(v: unknown, fb: number): number { return typeof v === "number" ? v : fb; }

// ── Cron parser ──────────────────────────────────────────────────────────────
function parseCronField(expr: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const part of expr.split(",")) {
    if (part === "*") { for (let i = min; i <= max; i++) result.add(i); continue; }
    const stepMatch = part.match(/^(\*|\d+)(?:-(\d+))?\/(\d+)$/);
    if (stepMatch) {
      const start = stepMatch[1] === "*" ? min : parseInt(stepMatch[1]!);
      const end   = stepMatch[2] ? parseInt(stepMatch[2]!) : max;
      const step  = parseInt(stepMatch[3]!);
      for (let i = start; i <= end; i += step) result.add(i);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      for (let i = parseInt(rangeMatch[1]!); i <= parseInt(rangeMatch[2]!); i++) result.add(i);
      continue;
    }
    const n = parseInt(part);
    if (!isNaN(n) && n >= min && n <= max) result.add(n);
  }
  return result;
}

function calcCronNext(expression: string, count: number): Date[] {
  // Expand common non-standard aliases
  const aliases: Record<string, string> = {
    "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *",
  };
  const expr = aliases[expression.trim()] ?? expression.trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must have 5 fields: minute hour day month weekday");

  const [minExpr, hrExpr, domExpr, monExpr, dowExpr] = parts;
  const minutes  = parseCronField(minExpr!, 0, 59);
  const hours    = parseCronField(hrExpr!,  0, 23);
  const days     = parseCronField(domExpr!, 1, 31);
  const months   = parseCronField(monExpr!, 1, 12);
  const weekdays = parseCronField(dowExpr!, 0,  6);
  // Per POSIX: if both DOM and DOW are restricted, use OR logic
  const domStar  = domExpr === "*";
  const dowStar  = dowExpr === "*";

  const results: Date[] = [];
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  let iter = 0;
  while (results.length < count && iter++ < 200_000) {
    const mo = d.getMonth() + 1, dy = d.getDate(), dw = d.getDay(), hr = d.getHours(), mn = d.getMinutes();
    if (!months.has(mo))  { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    const domOk = days.has(dy), dowOk = weekdays.has(dw);
    const dayOk = domStar && dowStar ? domOk : (!domStar && !dowStar ? domOk || dowOk : (!domStar ? domOk : dowOk));
    if (!dayOk)           { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!hours.has(hr))   { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!minutes.has(mn)) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    results.push(new Date(d));
    d.setMinutes(d.getMinutes() + 1, 0, 0);
  }
  return results;
}

// ── Date formatter ───────────────────────────────────────────────────────────
function formatDate(d: Date, pattern: string, tz: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const locale = "en-US";
  const opts = (o: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(locale, { ...o, timeZone: tz }).format(d);
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "??";
  const year   = get("year");
  const month  = get("month");
  const day    = get("day");
  const hour   = get("hour") === "24" ? "00" : get("hour");
  const minute = get("minute");
  const second = get("second");
  const monthNum = parseInt(month);
  const MONTHS_L = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MONTHS_S = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAYS_L   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const DAYS_S   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const h12 = parseInt(hour) % 12 || 12;
  const ampm = parseInt(hour) < 12 ? "AM" : "PM";

  return pattern
    .replace("YYYY", year).replace("YY", year.slice(-2))
    .replace("MMMM", MONTHS_L[monthNum - 1] ?? month).replace("MMM", MONTHS_S[monthNum - 1] ?? month)
    .replace("MM", month).replace("M", String(monthNum))
    .replace("DDDD", DAYS_L[d.getDay()] ?? "").replace("DDD", DAYS_S[d.getDay()] ?? "")
    .replace("DD", day).replace("D", String(parseInt(day)))
    .replace("HH", hour).replace("H", String(parseInt(hour)))
    .replace("hh", pad(h12)).replace("h", String(h12))
    .replace("mm", minute).replace("ss", second)
    .replace("A", ampm).replace("a", ampm.toLowerCase());
}

export function getDateTimeTools(): DateTimeTool[] {
  return [

    // ── datetime_parse ────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "datetime_parse",
          description: "Parse any date/time string into a structured breakdown: ISO 8601, Unix timestamp, year/month/day/hour/minute/second components, and day-of-week. Handles natural language relative expressions like 'now', 'today', 'yesterday', 'next monday'. Use to normalise dates from user input, API responses, or documents.",
          parameters: {
            type: "object",
            properties: {
              input:    { type: "string", description: "Date string to parse (e.g. '2026-07-13', 'July 13 2026 14:00', 'now', 'yesterday')" },
              timezone: { type: "string", description: "IANA timezone for output components (e.g. 'America/New_York'). Default: UTC" },
            },
            required: ["input"],
          },
        },
      },
      async execute(args) {
        let input = str(args["input"]).trim().toLowerCase();
        const tz  = str(args["timezone"], "UTC");
        let d: Date;

        if (input === "now")       { d = new Date(); }
        else if (input === "today")     { d = new Date(); d.setHours(0,0,0,0); }
        else if (input === "yesterday") { d = new Date(); d.setDate(d.getDate()-1); d.setHours(0,0,0,0); }
        else if (input === "tomorrow")  { d = new Date(); d.setDate(d.getDate()+1); d.setHours(0,0,0,0); }
        else if (/^\d{10}$/.test(input))   { d = new Date(parseInt(input) * 1000); }
        else if (/^\d{13}$/.test(input))   { d = new Date(parseInt(input)); }
        else { d = new Date(str(args["input"])); }

        if (isNaN(d.getTime())) return `Error: could not parse date "${str(args["input"])}"`;

        const locale = "en-US";
        const fmtOpts = (o: Intl.DateTimeFormatOptions) =>
          new Intl.DateTimeFormat(locale, { ...o, timeZone: tz }).format(d);

        const parts = new Intl.DateTimeFormat(locale, {
          timeZone: tz,
          year:"numeric", month:"2-digit", day:"2-digit",
          hour:"2-digit", minute:"2-digit", second:"2-digit",
          hour12: false,
          weekday: "long",
        }).formatToParts(d);
        const get = (t: string) => parts.find(p => p.type === t)?.value ?? "?";

        return [
          `Parsed: ${str(args["input"])}`,
          `ISO 8601:   ${d.toISOString()}`,
          `Unix (s):   ${Math.floor(d.getTime() / 1000)}`,
          `Unix (ms):  ${d.getTime()}`,
          ``,
          `Timezone:   ${tz}`,
          `Weekday:    ${get("weekday")}`,
          `Year:       ${get("year")}`,
          `Month:      ${get("month")}`,
          `Day:        ${get("day")}`,
          `Hour:       ${get("hour") === "24" ? "00" : get("hour")}`,
          `Minute:     ${get("minute")}`,
          `Second:     ${get("second")}`,
          ``,
          `Human:      ${fmtOpts({ dateStyle:"full", timeStyle:"long" })}`,
        ].join("\n");
      },
    },

    // ── datetime_format ───────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "datetime_format",
          description: "Format a date/time with a custom pattern and optional timezone conversion. Pattern tokens: YYYY=year, MM=month, DD=day, HH=24h, hh=12h, mm=minute, ss=second, A=AM/PM, MMMM=month name, DDDD=weekday name.",
          parameters: {
            type: "object",
            properties: {
              input:    { type: "string", description: "Date to format (ISO 8601, Unix timestamp, or natural expression)" },
              pattern:  { type: "string", description: "Output pattern (e.g. 'MMMM DD, YYYY' → 'July 13, 2026')" },
              timezone: { type: "string", description: "IANA timezone (e.g. 'Europe/Paris'). Default: UTC" },
            },
            required: ["input", "pattern"],
          },
        },
      },
      async execute(args) {
        const input   = str(args["input"]);
        const pattern = str(args["pattern"]);
        const tz      = str(args["timezone"], "UTC");
        if (!input || !pattern) return "Error: input and pattern are required";
        let d: Date;
        if (/^\d{10}$/.test(input)) { d = new Date(parseInt(input) * 1000); }
        else if (/^\d{13}$/.test(input)) { d = new Date(parseInt(input)); }
        else { d = new Date(input); }
        if (isNaN(d.getTime())) return `Error: could not parse date "${input}"`;
        try {
          const result = formatDate(d, pattern, tz);
          return `${result}\n(Input: ${input} | Pattern: ${pattern} | TZ: ${tz})`;
        } catch (e) {
          return `Format error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },

    // ── datetime_diff ─────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "datetime_diff",
          description: "Calculate the difference between two dates in human-readable form and specific units (seconds, minutes, hours, days, weeks, months, years). Use for calculating duration, time-since-event, deadline proximity, or SLA checks.",
          parameters: {
            type: "object",
            properties: {
              from: { type: "string", description: "Start date/time (ISO 8601, Unix timestamp, or 'now')" },
              to:   { type: "string", description: "End date/time (ISO 8601, Unix timestamp, or 'now'). Default: now" },
              unit: { type: "string", enum: ["auto", "seconds", "minutes", "hours", "days", "weeks", "months", "years"], description: "Unit to return (default: auto — picks the most readable unit)" },
            },
            required: ["from"],
          },
        },
      },
      async execute(args) {
        const parseD = (s: string): Date => {
          if (s.toLowerCase() === "now") return new Date();
          if (/^\d{10}$/.test(s)) return new Date(parseInt(s) * 1000);
          if (/^\d{13}$/.test(s)) return new Date(parseInt(s));
          return new Date(s);
        };
        const from = parseD(str(args["from"]));
        const to   = parseD(str(args["to"], "now"));
        if (isNaN(from.getTime())) return `Error: invalid 'from' date: ${str(args["from"])}`;
        if (isNaN(to.getTime()))   return `Error: invalid 'to' date: ${str(args["to"])}`;

        const diffMs = to.getTime() - from.getTime();
        const abs    = Math.abs(diffMs);
        const future = diffMs > 0;
        const dir    = future ? "from now" : "ago";

        const s = Math.floor(abs / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        const w = Math.floor(d / 7);
        const mo = Math.floor(d / 30.44);
        const y  = Math.floor(d / 365.25);

        const unit = str(args["unit"], "auto");
        let value: number; let label: string;
        switch (unit) {
          case "seconds": value = s; label = `second${s !== 1 ? "s" : ""}`; break;
          case "minutes": value = m; label = `minute${m !== 1 ? "s" : ""}`; break;
          case "hours":   value = h; label = `hour${h !== 1 ? "s" : ""}`; break;
          case "days":    value = d; label = `day${d !== 1 ? "s" : ""}`; break;
          case "weeks":   value = w; label = `week${w !== 1 ? "s" : ""}`; break;
          case "months":  value = mo; label = `month${mo !== 1 ? "s" : ""}`; break;
          case "years":   value = y; label = `year${y !== 1 ? "s" : ""}`; break;
          default: // auto
            if (y >= 2)  { value = y; label = `year${y !== 1 ? "s" : ""}`; }
            else if (mo >= 2) { value = mo; label = `month${mo !== 1 ? "s" : ""}`; }
            else if (w >= 2)  { value = w; label = `week${w !== 1 ? "s" : ""}`; }
            else if (d >= 2)  { value = d; label = `day${d !== 1 ? "s" : ""}`; }
            else if (h >= 2)  { value = h; label = `hour${h !== 1 ? "s" : ""}`; }
            else if (m >= 2)  { value = m; label = `minute${m !== 1 ? "s" : ""}`; }
            else              { value = s; label = `second${s !== 1 ? "s" : ""}`; }
        }

        const human = value === 0 ? "just now" : `${value} ${label} ${dir}`;

        return [
          `Time Difference`,
          `From: ${from.toISOString()}`,
          `To:   ${to.toISOString()}`,
          ``,
          `Summary:  ${human}`,
          ``,
          `All units:`,
          `  ${s.toLocaleString()} seconds`,
          `  ${m.toLocaleString()} minutes`,
          `  ${h.toLocaleString()} hours`,
          `  ${d.toLocaleString()} days`,
          `  ${w.toLocaleString()} weeks`,
          `  ${mo.toLocaleString()} months`,
          `  ${y.toLocaleString()} years`,
        ].join("\n");
      },
    },

    // ── cron_next ─────────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "cron_next",
          description: "Calculate the next N execution times for a cron expression. Supports standard 5-field cron (minute hour day month weekday) and aliases: @yearly, @monthly, @weekly, @daily, @hourly. Use to verify schedules, debug cron jobs, or communicate when tasks will run.",
          parameters: {
            type: "object",
            properties: {
              expression: { type: "string", description: "Cron expression (e.g. '0 9 * * 1-5' = 9am Monday-Friday) or alias (@daily, @hourly, etc.)" },
              count:      { type: "number", description: "Number of next run times to return (default: 5, max: 20)" },
            },
            required: ["expression"],
          },
        },
      },
      async execute(args) {
        const expr  = str(args["expression"]);
        const count = Math.min(Math.max(1, num(args["count"], 5)), 20);
        if (!expr) return "Error: expression is required";
        try {
          const times = calcCronNext(expr, count);
          if (times.length === 0) return `No matching times found for expression: ${expr}`;
          const lines = [
            `Cron: ${expr}`,
            `Next ${times.length} run${times.length > 1 ? "s" : ""}:`,
            ...times.map((t, i) => `  ${i + 1}. ${t.toISOString()} (${t.toLocaleString()})`),
          ];
          return lines.join("\n");
        } catch (e) {
          return `Error parsing cron expression: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },

  ];
}
