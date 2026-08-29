import type { LabelRow } from './service.js';

export function toLabelDto(row: LabelRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    updatedAt: row.updatedAt.toISOString(),
  };
}
