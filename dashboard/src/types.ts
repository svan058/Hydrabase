import type { ApiPeer } from "../../src/StatsReporter"

export interface EventEntry {
  lv: string
  m: string
  t: string
}

export type FilterState = "all" | "connected" | "connecting" | "disconnected"

export type PeerWithCountry = ApiPeer & {
  activity: number[]
  country: string
};

export interface VoteCounts {
  albums: number
  artists: number
  tracks: number
}

export type WsState = "closed" | "connecting" | "error" | "open"
