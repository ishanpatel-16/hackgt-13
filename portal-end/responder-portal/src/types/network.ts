export interface NetworkNode {
  id: string
  name: string
  status: 'ONLINE' | 'OFFLINE'
  rerouted?: boolean
}
