import type { ApiPeer } from "../../src/StatsReporter"

export interface EventEntry {
  lv: string
  m: string
  t: string
}

export type FilterState = "all" | "connected" | "disconnected"

export type PeerWithCountry = ApiPeer & {
  activity: number[]
  country: string
};

export type WsState = "closed" | "connecting" | "error" | "open"
