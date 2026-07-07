function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isTripCompleted(startDate: string, endDate: string): boolean {
  return toLocalDateString(new Date()) > endDate;
}

export function getTripStatusLabel(
  t: (key: string) => string,
  startDate: string,
  endDate: string,
): string {
  const todayStr = toLocalDateString(new Date());

  if (todayStr > endDate) return t('tripStatus.completed');
  if (todayStr === startDate) return t('tripStatus.dDay');
  if (todayStr > startDate) return t('tripStatus.inProgress');

  const diff = Math.ceil(
    (new Date(startDate).getTime() - new Date(todayStr).getTime()) / (1000 * 60 * 60 * 24),
  );
  return `D-${diff}`;
}
