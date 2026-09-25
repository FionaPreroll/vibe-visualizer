/** Display formats for slider values. */

export const percent = (value: number) => `${Math.round(value * 100)} %`;
export const seconds = (value: number) =>
  value < 0.1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
export const hertz = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} k` : `${Math.round(value)}`;
export const degrees = (value: number) => `${Math.round(value)}°`;
export const perMinute = (value: number) => `${value.toFixed(1)}/min`;
export const times = (value: number) => `${value.toFixed(2)}×`;
export const integer = (value: number) => String(Math.round(value));
export const plain = (value: number) => value.toFixed(2);
