export function formatDate(date = new Date(), timezone = "Asia/Tokyo") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isoHoursAgo(hours: number, from = new Date()) {
  return new Date(from.getTime() - hours * 3600_000).toISOString();
}
