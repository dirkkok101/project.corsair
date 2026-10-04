/** Calendar date `day` days after an ISO start date. Date.UTC arithmetic is deterministic; only the wall clock is banned. */
export function dateOf(startDate: string, day: number): { year: number; month: number; day: number } {
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d) + day * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDate(date: { year: number; month: number; day: number }): string {
  return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}
