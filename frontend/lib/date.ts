function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTripStatusLabel(startDate: string, endDate: string): string {
  const todayStr = toLocalDateString(new Date());

  if (todayStr > endDate) return '여행 완료';
  if (todayStr === startDate) return 'D-Day';
  if (todayStr > startDate) return '여행 중';

  const diff = Math.ceil(
    (new Date(startDate).getTime() - new Date(todayStr).getTime()) / (1000 * 60 * 60 * 24),
  );
  return `D-${diff}`;
}
