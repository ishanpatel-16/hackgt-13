// Mock deployment positions, NOT surveyed device locations. [latitude, longitude].
// Kept separate from legacy schematic x/y values and backend contracts.
export const mockDeviceCoordinates: Record<string, [number, number]> = {
  '07': [33.7705, -84.3895],
  '12': [33.7805, -84.3795],
  '04': [33.7605, -84.3795],
  r02: [33.768, -84.387],
  r03: [33.7715, -84.382],
  gw: [33.766, -84.374],
}
