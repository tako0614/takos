import { METER_TYPES, type MeterType } from './billing-types';

export function asMeterType(value: string): MeterType | null {
  return (METER_TYPES as readonly string[]).includes(value) ? (value as MeterType) : null;
}
