// 日出日落：時間軸用來標示白天與夜晚
const RAD = Math.PI / 180;
const TAIPEI_LATITUDE = 25.05 * RAD;
const TAIPEI_LONGITUDE = 121.53;

/** 以 NOAA 的太陽公式估算臺北（UTC+8）的日出與日落。 */
export function solarTimes(date: string) {
  const year = Number(date.slice(0, 4));
  const first = Date.UTC(year, 0, 1);
  const day = (Date.parse(date + 'T00:00:00Z') - first) / 86400000;
  const days = (Date.UTC(year + 1, 0, 1) - first) / 86400000;
  const angle = 2 * Math.PI * day / days;
  const c = Math.cos(angle), s = Math.sin(angle), c2 = Math.cos(2 * angle), s2 = Math.sin(2 * angle);
  const equation = 229.18 * (0.000075 + 0.001868 * c - 0.032077 * s - 0.014615 * c2 - 0.040849 * s2);
  const declination = 0.006918 - 0.399912 * c + 0.070257 * s - 0.006758 * c2 + 0.000907 * s2
    - 0.002697 * Math.cos(3 * angle) + 0.00148 * Math.sin(3 * angle);
  const noon = 720 - 4 * TAIPEI_LONGITUDE + 480 - equation;
  const hourAngle = Math.acos((Math.cos(90.833 * RAD) - Math.sin(TAIPEI_LATITUDE) * Math.sin(declination))
    / (Math.cos(TAIPEI_LATITUDE) * Math.cos(declination)));
  const span = 4 * hourAngle / RAD;
  return { sunrise: Math.round(noon - span), sunset: Math.round(noon + span) };
}

export function formatSolarTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function daylightAt(hour: number | null, date: string) {
  if (hour == null) return null;
  const { sunrise, sunset } = solarTimes(date);
  const middle = hour * 60 + 30;
  const fade = (delta: number) => Math.max(0, Math.min(1, (delta + 65) / 125));
  const shade = Math.max(fade(sunrise - middle), fade(middle - sunset));
  if (shade === 1) return { label: '夜間', icon: 'moon', shade } as const;
  if (shade === 0) return { label: '白天', icon: 'sun', shade } as const;
  return { label: middle < 720 ? '清晨' : '傍晚', icon: 'horizon', shade } as const;
}

const clock = (hour: string) => `${hour.padStart(2, '0')}:00`;

export function timeRange(band: string) {
  const [start, end] = band.split('-');
  return band === '0-24' ? '全天' : `${clock(start)}–${clock(end)}`;
}
