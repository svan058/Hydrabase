import type { ApiPeer } from "../../../../../src/StatsReporter";
import type { FilterState, PeerWithCountry } from "../../../types";

import { toEmoji } from "../../../geo";
import { ACCENT, BORD, confColor, latColor, MUTED, panel } from "../../../theme";
import { fmtBytes, fmtUptime } from "../../../utils";
import { StatusDot } from "../../StatusDot";
import { Identicon } from "../../Identicon";

interface Props {
  filter: FilterState;
  sel: ApiPeer | null;
  setFilter: (f: FilterState) => void;
  setSel: (p: PeerWithCountry | null) => void;
  sorted: PeerWithCountry[];
}

export const PeersTab = ({ filter, sel, setFilter, setSel, sorted }: Props) => <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
    <span style={{ color: MUTED, fontSize: 11 }}>Filter:</span>
    {(["all", "connected", "disconnected"] as const).map((s) => <button className={`fbtn${filter === s ? " on" : ""}`} key={s} onClick={() => setFilter(s)}>{s}</button>)}
    <span style={{ color: MUTED, fontSize: 11, marginLeft: "auto" }}>{sorted.length} peers</span>
  </div>

  {sorted.map((p) => <div key={p.address} onClick={() => setSel(sel?.address === p.address ? null : p)} style={{ ...panel(), borderColor: sel?.address === p.address ? "#58a6ff55" : BORD, cursor: "pointer", transition: "border-color .15s" }}>
    <div style={{ padding: "12px 16px" }}>
      <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ alignItems: "center", display: "flex", gap: 8, marginBottom: 3 }}>
            <Identicon address={p.address} size={24} />
            <StatusDot status={p.status} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>{p.address}</span>
            <span style={{ fontSize: 12 }}>{toEmoji(p.country)}</span>
          </div>
          <div style={{ color: MUTED, fontSize: 11, marginLeft: 12 }}>ws://{p.hostname}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {p.plugins.map((pl) => <span key={pl} style={{ background: "#21262d", border: `1px solid ${BORD}`, borderRadius: 4, color: ACCENT, fontSize: 10, padding: "2px 8px" }}>{pl}</span>)}
          {p.plugins.length === 0 && <span style={{ color: MUTED, fontSize: 10 }}>no plugins</span>}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", marginBottom: 10 }}>
        {([
          ["Latency", p.latency ? `${Math.round(p.latency * 10) / 10}ms` : "—", p.latency ? latColor(p.latency) : MUTED],
          ["↓ RX",   fmtBytes(p.rxTotal), ACCENT],
          ["↑ TX",   fmtBytes(p.txTotal), "#f0883e"],
          ["Uptime",  fmtUptime(p.uptime), p.uptime / 1_000 > 90 ? "#3fb950" : p.uptime / 1_000 > 60 ? "#d29922" : "#f85149"],
        ] as [string, string, string][]).map(([l, v, c]) => <div key={l} style={{ background: "#0d1117", borderRadius: 6, padding: "8px 10px" }}>
          <div style={{ color: MUTED, fontSize: 9, letterSpacing: ".1em", marginBottom: 4, textTransform: "uppercase" }}>{l}</div>
          <div style={{ color: c, fontSize: 15, fontWeight: 700 }}>{v}</div>
        </div>)}
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ color: MUTED, fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase" }}>Historic Confidence</span>
          <span style={{ color: confColor(p.confidence), fontSize: 10, fontWeight: 700 }}>{(p.confidence * 100).toFixed(1)}%</span>
        </div>
        <div style={{ background: "#21262d", borderRadius: 2, height: 4, overflow: "hidden" }}>
          <div style={{ background: confColor(p.confidence), borderRadius: 2, height: "100%", transition: "width .3s", width: `${p.confidence * 100}%` }} />
        </div>
      </div>
    </div>
  </div>)}
</div>
