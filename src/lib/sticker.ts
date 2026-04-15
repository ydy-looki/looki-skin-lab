import { Path, StaticCanvas } from 'fabric'

export type DeviceColor = 'green' | 'black' | 'white'

export interface StickerDesign {
  backgroundColor: string
  id: string
  name: string
  json: Record<string, unknown>
  preview: string
  previewColor: DeviceColor
  updatedAt: string
}

export interface LayoutSlot {
  id: string
  column: number
  row: number
  x: number
  y: number
}

export type LayoutAssignments = Record<string, string | null>

export const STORAGE_KEYS = {
  designs: 'looki-touchpad.designs.v1',
  layout: 'looki-touchpad.layout.v1',
} as const

// Derived from reference/touch pad尺寸-new.svg.
export const STICKER_PX = {
  width: 1094,
  height: 924,
} as const

export const STICKER_MM = {
  width: 38.61,
  height: 32.61,
} as const

export const DEFAULT_STICKER_BACKGROUND_COLOR = '#262626'
export const PRINT_BLEED_MM = 3

export const CAMERA_GUIDE = {
  centerXRatio: 0.5005555905044057,
  centerYRatio: 0.16471717425460708,
  radiusRatio: 0.13492792404144227,
} as const

export const CAMERA_HOLE_MM = 8.8

export const A4_MM = {
  width: 210,
  height: 297,
} as const

const LAYOUT_COLUMNS = 4
const LAYOUT_ROWS = 7
const LAYOUT_START = { x: 16, y: 9 }
const LAYOUT_GAP = { x: 8.5, y: 8.5 }

export const LAYOUT_SLOTS: LayoutSlot[] = Array.from(
  { length: LAYOUT_COLUMNS * LAYOUT_ROWS },
  (_, index) => {
    const column = index % LAYOUT_COLUMNS
    const row = Math.floor(index / LAYOUT_COLUMNS)

    return {
      id: `slot-${row + 1}-${column + 1}`,
      column,
      row,
      x: LAYOUT_START.x + column * (STICKER_MM.width + LAYOUT_GAP.x),
      y: LAYOUT_START.y + row * (STICKER_MM.height + LAYOUT_GAP.y),
    }
  },
)

export function createEmptyAssignments(): LayoutAssignments {
  return Object.fromEntries(LAYOUT_SLOTS.map((slot) => [slot.id, null]))
}

export function createStickerPath(
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): string {
  const radiusX = width / 2
  const radiusY = height / 2
  const centerY = offsetY + radiusY
  const holeCenterX = offsetX + width * CAMERA_GUIDE.centerXRatio
  const holeRadius = height * CAMERA_GUIDE.radiusRatio
  const holeCenterY = offsetY + height * CAMERA_GUIDE.centerYRatio

  return [
    `M ${offsetX} ${centerY}`,
    `A ${radiusX} ${radiusY} 0 1 0 ${offsetX + width} ${centerY}`,
    `A ${radiusX} ${radiusY} 0 1 0 ${offsetX} ${centerY}`,
    'Z',
    `M ${holeCenterX + holeRadius} ${holeCenterY}`,
    `A ${holeRadius} ${holeRadius} 0 1 0 ${holeCenterX - holeRadius} ${holeCenterY}`,
    `A ${holeRadius} ${holeRadius} 0 1 0 ${holeCenterX + holeRadius} ${holeCenterY}`,
    'Z',
  ].join(' ')
}

function createOuterStickerPath(
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): string {
  const radiusX = width / 2
  const radiusY = height / 2
  const centerY = offsetY + radiusY

  return [
    `M ${offsetX} ${centerY}`,
    `A ${radiusX} ${radiusY} 0 1 0 ${offsetX + width} ${centerY}`,
    `A ${radiusX} ${radiusY} 0 1 0 ${offsetX} ${centerY}`,
    'Z',
  ].join(' ')
}

export function createFabricClipPath(
  width = STICKER_PX.width,
  height = STICKER_PX.height,
): Path {
  return new Path(createStickerPath(width, height), {
    absolutePositioned: true,
    evented: false,
    fill: '#000000',
    fillRule: 'evenodd',
    left: 0,
    originX: 'left',
    originY: 'top',
    selectable: false,
    top: 0,
  })
}

export function createFabricOuterClipPath(
  width: number,
  height: number,
): Path {
  return new Path(createOuterStickerPath(width, height), {
    absolutePositioned: true,
    evented: false,
    fill: '#000000',
    left: 0,
    originX: 'left',
    originY: 'top',
    selectable: false,
    top: 0,
  })
}

export function createDesignName(index: number): string {
  return `Skin ${String(index + 1).padStart(2, '0')}`
}

function formatLayoutLabel(input: string, maxLength = 18): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 1)}…`
    : trimmed
}

function escapeXml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function mmToPrintPx(mm: number): number {
  return (mm / 25.4) * 300
}

export async function renderDesignForExport(
  json: Record<string, unknown>,
  fallbackBackgroundColor = DEFAULT_STICKER_BACKGROUND_COLOR,
): Promise<string> {
  const canvas = new StaticCanvas(undefined, {
    enableRetinaScaling: false,
    height: STICKER_PX.height,
    renderOnAddRemove: false,
    width: STICKER_PX.width,
  })
  const backgroundColor = typeof json.backgroundColor === 'string'
    ? json.backgroundColor
    : fallbackBackgroundColor

  canvas.backgroundColor = backgroundColor
  canvas.clipPath = createFabricClipPath()
  await canvas.loadFromJSON(json)
  canvas.backgroundColor = backgroundColor
  canvas.clipPath = createFabricClipPath()
  canvas.requestRenderAll()

  const dataUrl = canvas.toDataURL({
    enableRetinaScaling: false,
    format: 'png',
    multiplier: 1,
  })

  await canvas.dispose()
  return dataUrl
}

export async function renderDesignForPrintBleed(
  json: Record<string, unknown>,
  fallbackBackgroundColor = DEFAULT_STICKER_BACKGROUND_COLOR,
): Promise<string> {
  const bleedPxX = Math.round((PRINT_BLEED_MM / STICKER_MM.width) * STICKER_PX.width)
  const bleedPxY = Math.round((PRINT_BLEED_MM / STICKER_MM.height) * STICKER_PX.height)
  const width = STICKER_PX.width + bleedPxX * 2
  const height = STICKER_PX.height + bleedPxY * 2
  const canvas = new StaticCanvas(undefined, {
    enableRetinaScaling: false,
    height,
    renderOnAddRemove: false,
    width,
  })
  const backgroundColor = typeof json.backgroundColor === 'string'
    ? json.backgroundColor
    : fallbackBackgroundColor

  canvas.backgroundColor = backgroundColor
  canvas.clipPath = createFabricOuterClipPath(width, height)
  await canvas.loadFromJSON(json)
  canvas.getObjects().forEach((object) => {
    object.set({
      left: (object.left ?? 0) + bleedPxX,
      top: (object.top ?? 0) + bleedPxY,
    })
    object.setCoords()
  })
  canvas.backgroundColor = backgroundColor
  canvas.clipPath = createFabricOuterClipPath(width, height)
  canvas.requestRenderAll()

  const dataUrl = canvas.toDataURL({
    enableRetinaScaling: false,
    format: 'png',
    multiplier: 1,
  })

  await canvas.dispose()
  return dataUrl
}

export function downloadBlob(
  blob: Blob,
  filename: string,
): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.click()

  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

export function buildCutBoardSvg(
  assignments: LayoutAssignments,
  designLookup?: Map<string, StickerDesign>,
): string {
  const activeSlots = LAYOUT_SLOTS.filter((slot) => assignments[slot.id])

  const slots = activeSlots.length > 0 ? activeSlots : LAYOUT_SLOTS
  const shapes = slots
    .map((slot) => {
      const stickerPath = createStickerPath(
        STICKER_MM.width,
        STICKER_MM.height,
        slot.x,
        slot.y,
      )
      const labelX = slot.x + STICKER_MM.width / 2
      const labelY = slot.y + STICKER_MM.height + 4.6
      const designId = assignments[slot.id]
      const label = designId
        ? formatLayoutLabel(designLookup?.get(designId)?.name ?? '')
        : ''

      return `
        <g class="cut-slot">
          <path d="${stickerPath}" />
          ${label ? `<text x="${labelX}" y="${labelY}">${escapeXml(label)}</text>` : ''}
        </g>
      `
    })
    .join('')

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${A4_MM.width}mm" height="${A4_MM.height}mm" viewBox="0 0 ${A4_MM.width} ${A4_MM.height}">
      <defs>
        <style>
          .sheet-bg { fill: #ffffff; }
          .sheet-border {
            fill: none;
            stroke: #d2d8de;
            stroke-width: 0.4;
            stroke-dasharray: 1.2 1.2;
          }
          .cut-slot path {
            fill: none;
            stroke: #ff3b30;
            stroke-width: 0.25;
            vector-effect: non-scaling-stroke;
          }
          .cut-slot text {
            fill: #6c7884;
            font-family: 'Avenir Next', 'PingFang SC', sans-serif;
            font-size: 2.6px;
            font-weight: 600;
            text-anchor: middle;
          }
        </style>
      </defs>
      <rect class="sheet-bg" x="0" y="0" width="${A4_MM.width}" height="${A4_MM.height}" rx="2.5" />
      <rect class="sheet-border" x="6" y="6" width="${A4_MM.width - 12}" height="${A4_MM.height - 12}" rx="2.5" />
      ${shapes}
    </svg>
  `.trim()
}
