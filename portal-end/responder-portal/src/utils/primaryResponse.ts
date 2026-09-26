// Informational presentation labels only; this does not assign or dispatch personnel.
const responseCategoryMap: Record<string, string> = {
  medical: 'EMS',
  fire: 'Fire / Rescue',
  trapped: 'Rescue',
  flood: 'Rescue',
  structural: 'Fire / Rescue',
  security: 'Law Enforcement',
  hazmat: 'Hazmat',
  other: 'Dispatcher Review',
  unknown: 'Dispatcher Review',
}

export function getPrimaryResponse(category: string | null | undefined): string {
  const key = category?.trim().toLowerCase() ?? 'unknown'
  return Object.hasOwn(responseCategoryMap, key)
    ? responseCategoryMap[key]
    : responseCategoryMap.unknown
}
