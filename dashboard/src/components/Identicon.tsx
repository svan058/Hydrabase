import { useEffect, useRef } from "react"

interface Props {
  address: string
  size?: number
  style?: React.CSSProperties
}

function hashAddress(address: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h
}

export const Identicon = ({ address, size = 24, style }: Props) => {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const hash = hashAddress(address)
    const hue = hash % 360
    const sat = 50 + (hash >> 8) % 25
    const lit = 45 + (hash >> 16) % 15

    ctx.clearRect(0, 0, size, size)

    // background
    ctx.fillStyle = `hsl(${hue},${sat}%,10%)`
    ctx.fillRect(0, 0, size, size)

    // 5x5 symmetric grid — only compute left 3 cols, mirror right 2
    const cell = size / 5
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const bit = (hash >> (row * 3 + col)) & 1
        if (!bit) continue
        ctx.fillStyle = `hsl(${hue},${sat}%,${lit}%)`
        ctx.fillRect(col * cell, row * cell, cell, cell)
        // mirror
        if (col < 2) ctx.fillRect((4 - col) * cell, row * cell, cell, cell)
      }
    }
  }, [address, size])

  return <canvas ref={ref} width={size} height={size} style={{ borderRadius: 4, flexShrink: 0, imageRendering: "pixelated", ...style }} />
}