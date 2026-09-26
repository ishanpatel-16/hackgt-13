// Presentation only: technical identifiers and stored report paths stay intact.
export function deviceName(name: string) {
  return name.replace(/Access Node |Node /g, 'Access Point ').replace(/Gateway/g, 'Responder Station')
}

export function devicePurpose(name: string) {
  if (name === 'Gateway') return 'Responder Station'
  if (name.startsWith('Relay')) return 'Message Relay'
  return 'Civilian Connection'
}
