const formatters = new Map<string | undefined, Intl.DateTimeFormat>();

export function formatCaptureTime(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '기록 없음';
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  const part = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return `${part.year}년 ${part.month}월 ${part.day}일 ${part.hour}:${part.minute}:${part.second}`;
}
