import {
  type CSSProperties,
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Canvas as FabricCanvas,
  FabricImage,
  PencilBrush,
} from 'fabric'
import blackDevice from '../reference/black.webp'
import greenDevice from '../reference/green.webp'
import whiteDevice from '../reference/white.webp'
import './App.css'
import {
  A4_MM,
  CAMERA_GUIDE,
  CAMERA_HOLE_MM,
  DEFAULT_STICKER_BACKGROUND_COLOR,
  type DeviceColor,
  type LayoutAssignments,
  LAYOUT_SLOTS,
  STICKER_MM,
  STICKER_PX,
  STORAGE_KEYS,
  buildCutBoardSvg,
  createDesignName,
  createEmptyAssignments,
  createFabricClipPath,
  createStickerPath,
  downloadBlob,
  mmToPrintPx,
  renderDesignForExport,
  type StickerDesign,
} from './lib/sticker'

const TRANSPARENT_DEVICE_SIZE = { height: 1000, width: 1000 } as const
const TRANSPARENT_DEVICE_FRAME = {
  x: 289,
  y: 322,
  width: 422,
  height: 422 * (STICKER_MM.height / STICKER_MM.width),
} as const

const DEVICE_OPTIONS: Record<
  DeviceColor,
  {
    accent: string
    image: string
    label: string
    previewFrame: { x: number; y: number; width: number; height: number }
    size: { height: number; width: number }
  }
> = {
  black: {
    accent: '#101316',
    image: blackDevice,
    label: '曜石黑',
    previewFrame: TRANSPARENT_DEVICE_FRAME,
    size: TRANSPARENT_DEVICE_SIZE,
  },
  green: {
    accent: '#b9dd48',
    image: greenDevice,
    label: '草地绿',
    previewFrame: TRANSPARENT_DEVICE_FRAME,
    size: TRANSPARENT_DEVICE_SIZE,
  },
  white: {
    accent: '#e6ebef',
    image: whiteDevice,
    label: '雪山白',
    previewFrame: TRANSPARENT_DEVICE_FRAME,
    size: TRANSPARENT_DEVICE_SIZE,
  },
}

const DRAWING_COLORS = ['#7eff75', '#fb6363', '#6cb8ff', '#ffcc53', '#ffffff']
const BACKGROUND_COLORS = [
  DEFAULT_STICKER_BACKGROUND_COLOR,
  '#101316',
  '#c1d85d',
  '#ffffff',
  '#f4ead8',
  '#dde8ff',
  '#ffdce7',
]
const INITIAL_BRUSH_COLOR = '#7eff75'
const INITIAL_BRUSH_SIZE = 18

function createDesignId(): string {
  const nativeRandomUuid = globalThis.crypto?.randomUUID

  if (typeof nativeRandomUuid === 'function') {
    return nativeRandomUuid.call(globalThis.crypto)
  }

  return `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })
}

function createDataUrlFromImageSource(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): string {
  const width = source instanceof HTMLImageElement
    ? (source.naturalWidth || source.width)
    : source instanceof HTMLVideoElement
      ? (source.videoWidth || source.width)
      : source.width
  const height = source instanceof HTMLImageElement
    ? (source.naturalHeight || source.height)
    : source instanceof HTMLVideoElement
      ? (source.videoHeight || source.height)
      : source.height
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = Math.max(1, Math.round(width))
  exportCanvas.height = Math.max(1, Math.round(height))
  const context = exportCanvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas context is unavailable.')
  }

  context.drawImage(source, 0, 0, exportCanvas.width, exportCanvas.height)
  return exportCanvas.toDataURL('image/png')
}

function serializeCanvasState(canvas: FabricCanvas): Record<string, unknown> {
  const payload = canvas.toJSON() as Record<string, unknown>
  const serializedObjects = payload.objects
  const liveObjects = canvas.getObjects()

  payload.backgroundColor = getCanvasBackgroundColor(canvas)

  if (!Array.isArray(serializedObjects)) {
    return payload
  }

  serializedObjects.forEach((entry, index) => {
    const liveObject = liveObjects[index]

    if (!(liveObject instanceof FabricImage) || !entry || typeof entry !== 'object') {
      return
    }

    const serializedEntry = entry as { src?: unknown }
    if (typeof serializedEntry.src !== 'string' || !serializedEntry.src.startsWith('blob:')) {
      return
    }

    serializedEntry.src = createDataUrlFromImageSource(liveObject.getElement())
  })

  return payload
}

function readDesignsFromStorage(): StickerDesign[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.designs)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as Array<StickerDesign & { backgroundColor?: string }>
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.map((design) => ({
      ...design,
      backgroundColor:
        typeof design.backgroundColor === 'string' && design.backgroundColor
          ? design.backgroundColor
          : typeof design.json?.backgroundColor === 'string'
            ? design.json.backgroundColor
            : DEFAULT_STICKER_BACKGROUND_COLOR,
    }))
  } catch {
    return []
  }
}

function readAssignmentsFromStorage(): LayoutAssignments {
  const empty = createEmptyAssignments()

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.layout)
    if (!raw) {
      return empty
    }

    const parsed = JSON.parse(raw) as LayoutAssignments
    return {
      ...empty,
      ...parsed,
    }
  } catch {
    return empty
  }
}

function formatTimeLabel(input: string): string {
  const date = new Date(input)

  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(date)
}

function formatSheetLabel(input: string, maxLength = 18): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 1)}…`
    : trimmed
}

function getCanvasBackgroundColor(canvas: FabricCanvas): string {
  return typeof canvas.backgroundColor === 'string' && canvas.backgroundColor
    ? canvas.backgroundColor
    : DEFAULT_STICKER_BACKGROUND_COLOR
}

function drawStickerOutline(
  context: CanvasRenderingContext2D,
  xMm: number,
  yMm: number,
  widthMm: number,
  heightMm: number,
  strokeStyle: string,
  lineWidth: number,
): void {
  const x = mmToPrintPx(xMm)
  const y = mmToPrintPx(yMm)
  const width = mmToPrintPx(widthMm)
  const height = mmToPrintPx(heightMm)
  const centerX = x + width / 2
  const centerY = y + height / 2
  const holeCenterX = x + width * CAMERA_GUIDE.centerXRatio
  const holeRadius = height * CAMERA_GUIDE.radiusRatio
  const holeCenterY = y + height * CAMERA_GUIDE.centerYRatio

  context.save()
  context.strokeStyle = strokeStyle
  context.lineWidth = lineWidth
  context.beginPath()
  context.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2)
  context.moveTo(holeCenterX + holeRadius, holeCenterY)
  context.arc(holeCenterX, holeCenterY, holeRadius, 0, Math.PI * 2)
  context.stroke()
  context.restore()
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Image failed to load: ${src}`))
    image.src = src
  })
}

function LayoutPreview({
  assignments,
  highlightedDesignId,
  previewDesigns,
  selectedSlotId,
  onSelectSlot,
}: {
  assignments: LayoutAssignments
  highlightedDesignId: string | null
  previewDesigns: Map<string, StickerDesign>
  selectedSlotId: string
  onSelectSlot: (slotId: string) => void
}) {
  return (
    <svg
      className="paper-preview"
      viewBox={`0 0 ${A4_MM.width} ${A4_MM.height}`}
      role="img"
      aria-label="Looki Skin Lab A4 打印预览"
    >
      <rect
        x="0"
        y="0"
        width={A4_MM.width}
        height={A4_MM.height}
        rx="2.5"
        fill="#fffdfa"
      />
      <rect
        x="5.5"
        y="5.5"
        width={A4_MM.width - 11}
        height={A4_MM.height - 11}
        rx="2.5"
        fill="none"
        stroke="#d7dde5"
        strokeDasharray="1.4 1.2"
        strokeWidth="0.45"
      />
      <text x="14" y="17" className="paper-preview__title">
        Looki Skin Lab Sheet
      </text>
      <text x="14" y="22.4" className="paper-preview__subtitle">
        点击纸面位置放入当前选中的 Skin
      </text>
      {LAYOUT_SLOTS.map((slot) => {
        const assignedDesignId = assignments[slot.id]
        const design = assignedDesignId
          ? previewDesigns.get(assignedDesignId)
          : undefined
        const label = design ? formatSheetLabel(design.name) : ''
        const isSelected = selectedSlotId === slot.id
        const isEmphasized = highlightedDesignId !== null &&
          highlightedDesignId === assignedDesignId

        return (
          <g
            key={slot.id}
            className="paper-preview__slot"
            onClick={() => onSelectSlot(slot.id)}
          >
            {design ? (
              <image
                href={design.preview}
                x={slot.x}
                y={slot.y}
                width={STICKER_MM.width}
                height={STICKER_MM.height}
                preserveAspectRatio="none"
              />
            ) : (
              <rect
                x={slot.x + 1.2}
                y={slot.y + 1.2}
                width={STICKER_MM.width - 2.4}
                height={STICKER_MM.height - 2.4}
                rx="12"
                fill="#eef3ea"
                opacity="0.9"
              />
            )}
            <path
              d={createStickerPath(
                STICKER_MM.width,
                STICKER_MM.height,
                slot.x,
                slot.y,
              )}
              fill="none"
              stroke={
                isSelected
                  ? '#7bd343'
                  : isEmphasized
                    ? '#4f86ff'
                    : '#bcc7d0'
              }
              strokeWidth={isSelected ? 0.85 : 0.45}
            />
            {label ? (
              <text
                x={slot.x + STICKER_MM.width / 2}
                y={slot.y + STICKER_MM.height + 4}
                className="paper-preview__slot-label"
              >
                {label}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

function App() {
  const [designs, setDesigns] = useState<StickerDesign[]>(readDesignsFromStorage)
  const [assignments, setAssignments] = useState<LayoutAssignments>(
    readAssignmentsFromStorage,
  )
  const [page, setPage] = useState<'editor' | 'layout'>('editor')
  const [deviceColor, setDeviceColor] = useState<DeviceColor>('green')
  const [currentName, setCurrentName] = useState(createDesignName(designs.length))
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null)
  const [pickedLayoutDesignId, setPickedLayoutDesignId] = useState<string | null>(
    designs[0]?.id ?? null,
  )
  const [selectedSlotId, setSelectedSlotId] = useState(
    LAYOUT_SLOTS[0]?.id ?? '',
  )
  const [previewUrl, setPreviewUrl] = useState('')
  const [backgroundColor, setBackgroundColor] = useState(
    DEFAULT_STICKER_BACKGROUND_COLOR,
  )
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR)
  const [brushSize, setBrushSize] = useState(INITIAL_BRUSH_SIZE)
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const editorCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fabricCanvasRef = useRef<FabricCanvas | null>(null)
  const isHydratingRef = useRef(false)
  const previewRefreshTimerRef = useRef<number | null>(null)
  const undoHistoryRef = useRef<string[]>([])
  const redoHistoryRef = useRef<string[]>([])
  const savedSnapshotRef = useRef('')
  const undoActionRef = useRef<() => void>(() => undefined)
  const clearSlotActionRef = useRef<() => boolean>(() => false)
  const pushHistorySnapshotRef = useRef<() => void>(() => undefined)

  const currentDesign = designs.find((item) => item.id === selectedDesignId) ?? null
  const activeSlotDesignId = assignments[selectedSlotId] ?? null
  const activeSlotDesign = designs.find((item) => item.id === activeSlotDesignId) ?? null
  const devicePreview = DEVICE_OPTIONS[deviceColor]
  const savedCount = designs.length
  const layoutCount = Object.values(assignments).filter(Boolean).length
  const designMap = new Map(designs.map((design) => [design.id, design]))
  const deviceOverlayStyle: CSSProperties = {
    left: `${(devicePreview.previewFrame.x / devicePreview.size.width) * 100}%`,
    top: `${(devicePreview.previewFrame.y / devicePreview.size.height) * 100}%`,
    width: `${(devicePreview.previewFrame.width / devicePreview.size.width) * 100}%`,
  }

  const queuePreviewRefresh = () => {
    if (previewRefreshTimerRef.current !== null) {
      window.clearTimeout(previewRefreshTimerRef.current)
    }

    previewRefreshTimerRef.current = window.setTimeout(() => {
      const canvas = fabricCanvasRef.current
      if (!canvas) {
        return
      }

      setPreviewUrl(
        canvas.toDataURL({
          enableRetinaScaling: false,
          format: 'png',
          multiplier: 0.34,
        }),
      )
    }, 100)
  }

  const snapshotCanvasState = () => {
    const canvas = fabricCanvasRef.current
    if (!canvas) {
      return ''
    }

    return JSON.stringify(serializeCanvasState(canvas))
  }

  const pushHistorySnapshot = () => {
    if (isHydratingRef.current) {
      return
    }

    const snapshot = snapshotCanvasState()
    if (!snapshot) {
      return
    }

    const history = undoHistoryRef.current
    if (history[history.length - 1] === snapshot) {
      return
    }

    history.push(snapshot)
    if (history.length > 50) {
      history.shift()
    }

    redoHistoryRef.current = []
    setCanUndo(history.length > 1)
    setDirty(snapshot !== savedSnapshotRef.current)
  }

  pushHistorySnapshotRef.current = pushHistorySnapshot

  const setBaselineHistory = () => {
    const snapshot = snapshotCanvasState()
    if (!snapshot) {
      return
    }

    savedSnapshotRef.current = snapshot
    undoHistoryRef.current = [snapshot]
    redoHistoryRef.current = []
    setCanUndo(false)
    setDirty(false)
  }

  const restoreSnapshot = async (snapshot: string) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) {
      return
    }

    const parsed = JSON.parse(snapshot) as Record<string, unknown>
    const nextBackgroundColor =
      typeof parsed.backgroundColor === 'string'
        ? parsed.backgroundColor
        : DEFAULT_STICKER_BACKGROUND_COLOR

    isHydratingRef.current = true
    canvas.discardActiveObject()
    canvas.clear()
    canvas.backgroundColor = nextBackgroundColor
    canvas.clipPath = createFabricClipPath()
    await canvas.loadFromJSON(parsed)
    canvas.backgroundColor = nextBackgroundColor
    canvas.clipPath = createFabricClipPath()
    canvas.requestRenderAll()
    isHydratingRef.current = false
    setBackgroundColor(nextBackgroundColor)
    setHasSelection(false)
    setDirty(snapshot !== savedSnapshotRef.current)
    queuePreviewRefresh()
  }

  const applyCanvasBase = async (
    json?: Record<string, unknown>,
    fallbackBackgroundColor = DEFAULT_STICKER_BACKGROUND_COLOR,
  ) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) {
      return
    }

    const nextBackgroundColor =
      typeof json?.backgroundColor === 'string'
        ? json.backgroundColor
        : fallbackBackgroundColor

    isHydratingRef.current = true
    canvas.discardActiveObject()
    canvas.clear()
    canvas.backgroundColor = nextBackgroundColor
    canvas.clipPath = createFabricClipPath()

    if (json) {
      await canvas.loadFromJSON(json)
      canvas.backgroundColor = nextBackgroundColor
      canvas.clipPath = createFabricClipPath()
    }

    canvas.requestRenderAll()
    isHydratingRef.current = false
    setBackgroundColor(nextBackgroundColor)
    setHasSelection(false)
    setBaselineHistory()
    queuePreviewRefresh()
  }

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.designs, JSON.stringify(designs))
  }, [designs])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(assignments))
  }, [assignments])

  useEffect(() => {
    if (!pickedLayoutDesignId && designs.length > 0) {
      setPickedLayoutDesignId(designs[0].id)
    }

    if (
      pickedLayoutDesignId &&
      !designs.some((design) => design.id === pickedLayoutDesignId)
    ) {
      setPickedLayoutDesignId(designs[0]?.id ?? null)
    }
  }, [designs, pickedLayoutDesignId])

  useEffect(() => {
    const domCanvas = editorCanvasRef.current
    if (!domCanvas) {
      return
    }

    const canvas = new FabricCanvas(domCanvas, {
      enableRetinaScaling: true,
      height: STICKER_PX.height,
      preserveObjectStacking: true,
      selectionBorderColor: '#cbff93',
      selectionColor: 'rgba(126, 255, 117, 0.16)',
      selectionDashArray: [16, 8],
      width: STICKER_PX.width,
    })

    const brush = new PencilBrush(canvas)
    brush.color = INITIAL_BRUSH_COLOR
    brush.width = INITIAL_BRUSH_SIZE
    canvas.freeDrawingBrush = brush
    canvas.backgroundColor = DEFAULT_STICKER_BACKGROUND_COLOR
    canvas.clipPath = createFabricClipPath()
    fabricCanvasRef.current = canvas

    const syncSelection = () => {
      setHasSelection(Boolean(canvas.getActiveObject()))
    }

    const markDirty = () => {
      pushHistorySnapshotRef.current()
    }

    const handleAfterRender = () => {
      queuePreviewRefresh()
    }

    canvas.on('selection:created', syncSelection)
    canvas.on('selection:updated', syncSelection)
    canvas.on('selection:cleared', syncSelection)
    canvas.on('object:added', markDirty)
    canvas.on('object:modified', markDirty)
    canvas.on('object:removed', markDirty)
    canvas.on('path:created', markDirty)
    canvas.on('after:render', handleAfterRender)

    setHasSelection(false)
    setBackgroundColor(DEFAULT_STICKER_BACKGROUND_COLOR)
    const initialSnapshot = snapshotCanvasState()
    if (initialSnapshot) {
      savedSnapshotRef.current = initialSnapshot
      undoHistoryRef.current = [initialSnapshot]
      redoHistoryRef.current = []
    }
    setCanUndo(false)
    setDirty(false)
    queuePreviewRefresh()

    return () => {
      if (previewRefreshTimerRef.current !== null) {
        window.clearTimeout(previewRefreshTimerRef.current)
      }

      canvas.off('selection:created', syncSelection)
      canvas.off('selection:updated', syncSelection)
      canvas.off('selection:cleared', syncSelection)
      canvas.off('object:added', markDirty)
      canvas.off('object:modified', markDirty)
      canvas.off('object:removed', markDirty)
      canvas.off('path:created', markDirty)
      canvas.off('after:render', handleAfterRender)
      fabricCanvasRef.current = null
      void canvas.dispose()
    }
  }, [])

  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) {
      return
    }

    let brush = canvas.freeDrawingBrush as PencilBrush | undefined
    if (!brush) {
      brush = new PencilBrush(canvas)
      canvas.freeDrawingBrush = brush
    }

    brush.color = brushColor
    brush.width = brushSize
    canvas.isDrawingMode = isDrawingMode
  }, [brushColor, brushSize, isDrawingMode])

  useEffect(() => {
    if (page !== 'editor') {
      return
    }

    const canvas = fabricCanvasRef.current
    if (!canvas) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      canvas.calcOffset()
      canvas.requestRenderAll()
      setPreviewUrl(
        canvas.toDataURL({
          enableRetinaScaling: false,
          format: 'png',
          multiplier: 0.34,
        }),
      )
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [page])

  const handleUndo = async () => {
    if (undoHistoryRef.current.length <= 1) {
      return
    }

    const current = undoHistoryRef.current.pop()
    if (current) {
      redoHistoryRef.current.push(current)
    }

    const previous = undoHistoryRef.current[undoHistoryRef.current.length - 1]
    if (!previous) {
      return
    }

    await restoreSnapshot(previous)
    setCanUndo(undoHistoryRef.current.length > 1)
  }

  undoActionRef.current = () => {
    void handleUndo()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isUndoShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      const isClearSlotShortcut =
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === 'Backspace' || event.key === 'Delete')

      if (!isUndoShortcut && !isClearSlotShortcut) {
        return
      }

      const target = event.target as HTMLElement | null
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)

      if (isEditable) {
        return
      }

      if (isUndoShortcut) {
        event.preventDefault()
        undoActionRef.current()
        return
      }

      if (clearSlotActionRef.current()) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleUploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    const canvas = fabricCanvasRef.current
    if (!file || !canvas) {
      return
    }

    setIsDrawingMode(false)

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const image = await FabricImage.fromURL(dataUrl)
      const fitWidth = STICKER_PX.width * 0.55
      const fitHeight = STICKER_PX.height * 0.55

      if ((image.width ?? 0) >= (image.height ?? 0)) {
        image.scaleToWidth(fitWidth)
      } else {
        image.scaleToHeight(fitHeight)
      }

      image.set({
        borderColor: '#cbff93',
        centeredRotation: true,
        cornerColor: '#cbff93',
        cornerStrokeColor: '#101719',
        cornerStyle: 'circle',
        left: STICKER_PX.width / 2,
        originX: 'center',
        originY: 'center',
        top: STICKER_PX.height / 2,
        transparentCorners: false,
      })

      canvas.add(image)
      canvas.setActiveObject(image)
      canvas.requestRenderAll()
      setHasSelection(true)
    } finally {
      event.target.value = ''
    }
  }

  const handleDeleteSelection = () => {
    const canvas = fabricCanvasRef.current
    const activeObject = canvas?.getActiveObject()
    if (!canvas || !activeObject) {
      return
    }

    canvas.remove(activeObject)
    canvas.requestRenderAll()
  }

  const handleLayerMove = (direction: 'front' | 'back') => {
    const canvas = fabricCanvasRef.current
    const activeObject = canvas?.getActiveObject()
    if (!canvas || !activeObject) {
      return
    }

    if (direction === 'front') {
      canvas.bringObjectForward(activeObject)
    } else {
      canvas.sendObjectBackwards(activeObject)
    }

    canvas.requestRenderAll()
  }

  const handleBackgroundColorChange = (nextColor: string) => {
    const canvas = fabricCanvasRef.current
    setBackgroundColor(nextColor)

    if (!canvas) {
      return
    }

    canvas.backgroundColor = nextColor
    canvas.requestRenderAll()
    pushHistorySnapshot()
  }

  const handleStartFresh = async () => {
    if (dirty && !window.confirm('当前画布还有未保存修改，确定要重新开始吗？')) {
      return
    }

    setSelectedDesignId(null)
    setCurrentName(createDesignName(designs.length))
    await applyCanvasBase(undefined, DEFAULT_STICKER_BACKGROUND_COLOR)
  }

  const handleOpenDesign = async (design: StickerDesign) => {
    if (
      dirty &&
      selectedDesignId !== design.id &&
      !window.confirm('当前画布还有未保存修改，继续会丢失这些修改。确定继续吗？')
    ) {
      return
    }

    setSelectedDesignId(design.id)
    setCurrentName(design.name)
    setDeviceColor(design.previewColor)
    setPickedLayoutDesignId(design.id)
    setPage('editor')
    await applyCanvasBase(design.json, design.backgroundColor)
  }

  const saveCurrentDesign = (forceNew: boolean) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) {
      return
    }

    const payload = serializeCanvasState(canvas)
    const preview = canvas.toDataURL({
      enableRetinaScaling: false,
      format: 'png',
      multiplier: 0.34,
    })
    const name = currentName.trim() || createDesignName(designs.length)
    const isNew = forceNew || !selectedDesignId
    const nextId = isNew ? createDesignId() : selectedDesignId

    const nextDesign: StickerDesign = {
      backgroundColor,
      id: nextId,
      json: payload,
      name,
      preview,
      previewColor: deviceColor,
      updatedAt: new Date().toISOString(),
    }

    setDesigns((previous) => {
      const filtered = previous.filter((item) => item.id !== nextId)
      return [nextDesign, ...filtered]
    })
    setSelectedDesignId(nextId)
    setPickedLayoutDesignId(nextId)
    setCurrentName(name)
    savedSnapshotRef.current = JSON.stringify(payload)
    undoHistoryRef.current = [savedSnapshotRef.current]
    redoHistoryRef.current = []
    setCanUndo(false)
    setDirty(false)
  }

  const handleDeleteDesign = async (designId: string) => {
    const design = designs.find((item) => item.id === designId)
    if (!design) {
      return
    }

    const shouldDelete = window.confirm(`删除「${design.name}」后将无法恢复，确定继续吗？`)
    if (!shouldDelete) {
      return
    }

    setDesigns((previous) => previous.filter((item) => item.id !== designId))
    setAssignments((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([slotId, value]) => [
          slotId,
          value === designId ? null : value,
        ]),
      ),
    )

    if (selectedDesignId === designId) {
      setSelectedDesignId(null)
      setCurrentName(createDesignName(Math.max(designs.length - 1, 0)))
      await applyCanvasBase(undefined, DEFAULT_STICKER_BACKGROUND_COLOR)
    }

    if (pickedLayoutDesignId === designId) {
      const fallback = designs.find((item) => item.id !== designId)?.id ?? null
      setPickedLayoutDesignId(fallback)
    }
  }

  const handleSlotSelect = (slotId: string) => {
    setSelectedSlotId(slotId)

    if (!pickedLayoutDesignId) {
      return
    }

    setAssignments((previous) => ({
      ...previous,
      [slotId]: pickedLayoutDesignId,
    }))
  }

  const handleClearSelectedSlot = () => {
    setAssignments((previous) => ({
      ...previous,
      [selectedSlotId]: null,
    }))
  }

  clearSlotActionRef.current = () => {
    if (page !== 'layout' || !activeSlotDesignId) {
      return false
    }

    handleClearSelectedSlot()
    return true
  }

  const handleDownloadA4 = async () => {
    const activeDesignIds = Array.from(
      new Set(Object.values(assignments).filter(Boolean)),
    ) as string[]

    if (activeDesignIds.length === 0) {
      window.alert('请先在 A4 纸面上放入至少一个 Skin。')
      return
    }

    setIsExporting(true)

    try {
      const renderedImages = new Map<string, HTMLImageElement>()
      for (const designId of activeDesignIds) {
        const design = designMap.get(designId)
        if (!design) {
          continue
        }

        let dataUrl: string
        try {
          dataUrl = await renderDesignForExport(design.json, design.backgroundColor)
        } catch (error) {
          console.warn(
            `Failed to render sticker ${designId} from JSON, falling back to saved preview.`,
            error,
          )
          dataUrl = design.preview
        }
        const image = await loadImageElement(dataUrl)
        renderedImages.set(designId, image)
      }

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(mmToPrintPx(A4_MM.width))
      canvas.height = Math.round(mmToPrintPx(A4_MM.height))
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Canvas context is unavailable.')
      }

      context.fillStyle = '#fffdfa'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.strokeStyle = '#d7dde5'
      context.lineWidth = 1.4
      context.strokeRect(
        mmToPrintPx(5.5),
        mmToPrintPx(5.5),
        mmToPrintPx(A4_MM.width - 11),
        mmToPrintPx(A4_MM.height - 11),
      )
      context.fillStyle = '#27313b'
      context.font = '700 58px "Avenir Next", "PingFang SC", sans-serif'
      context.fillText('Looki Skin Lab Sheet', mmToPrintPx(14), mmToPrintPx(17))
      context.font = '400 28px "Avenir Next", "PingFang SC", sans-serif'
      context.fillStyle = '#6d7885'
      context.fillText(
        'A4 print layout for Looki Skin Lab',
        mmToPrintPx(14),
        mmToPrintPx(22.4),
      )

      for (const slot of LAYOUT_SLOTS) {
        drawStickerOutline(
          context,
          slot.x,
          slot.y,
          STICKER_MM.width,
          STICKER_MM.height,
          '#e0e6ec',
          1.1,
        )
      }

      for (const slot of LAYOUT_SLOTS) {
        const designId = assignments[slot.id]
        if (!designId) {
          continue
        }

        const image = renderedImages.get(designId)
        if (!image) {
          continue
        }

        context.drawImage(
          image,
          mmToPrintPx(slot.x),
          mmToPrintPx(slot.y),
          mmToPrintPx(STICKER_MM.width),
          mmToPrintPx(STICKER_MM.height),
        )
      }

      for (const slot of LAYOUT_SLOTS) {
        const designId = assignments[slot.id]
        const design = designId ? designMap.get(designId) : null
        const label = design ? formatSheetLabel(design.name, 20) : ''
        if (!label) {
          continue
        }

        context.fillStyle = '#7e8994'
        context.font = '600 18px "Avenir Next", "PingFang SC", sans-serif'
        context.textAlign = 'center'
        context.fillText(
          label,
          mmToPrintPx(slot.x + STICKER_MM.width / 2),
          mmToPrintPx(slot.y + STICKER_MM.height + 4.2),
        )
      }

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png')
      })

      if (!blob) {
        throw new Error('Failed to create PNG export.')
      }

      downloadBlob(blob, `looki-skin-lab-a4-sheet-${Date.now()}.png`)
    } finally {
      setIsExporting(false)
    }
  }

  const handleDownloadCutBoard = () => {
    const svg = buildCutBoardSvg(assignments, designMap)
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `looki-skin-lab-cut-board-${Date.now()}.svg`,
    )
  }

  return (
    <div className="app-shell">
      <div className="app-shell__glow app-shell__glow--one" />
      <div className="app-shell__glow app-shell__glow--two" />

      <header className="hero-strip">
        <div>
          <h1>Looki Skin Lab</h1>
          <p className="hero-strip__subtitle">
            上传、绘制、保存、排版与导出都在同一工作台完成。
          </p>
        </div>

        <div className="hero-strip__stats">
          <div className="stat-card">
            <span className="stat-card__label">已保存 Skin</span>
            <strong>{savedCount}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">已占版位置</span>
            <strong>{layoutCount}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">当前机身色</span>
            <strong>{DEVICE_OPTIONS[deviceColor].label}</strong>
          </div>
        </div>
      </header>

      <div className="view-switch">
        <button
          className={page === 'editor' ? 'is-active' : ''}
          type="button"
          onClick={() => setPage('editor')}
        >
          Skin 编辑
        </button>
        <button
          className={page === 'layout' ? 'is-active' : ''}
          type="button"
          onClick={() => setPage('layout')}
        >
          打印排版
        </button>
        <div className={`status-chip ${dirty ? 'is-dirty' : ''}`}>
          {dirty ? '当前画布有未保存修改' : '当前画布已同步'}
        </div>
      </div>

      <main
        className={`workspace-grid ${page !== 'editor' ? 'workspace-grid--hidden' : ''}`}
        aria-hidden={page !== 'editor'}
      >
        <section className="panel editor-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-heading__kicker">Skin Design</p>
                <h2>设计 Skin、继续编辑旧 Skin，并准备打印版本</h2>
                <p className="panel-heading__copy">
                  在 Looki Skin Lab 里直接对 Looki Skin 做上传、绘制和调整，顶部保留 {CAMERA_HOLE_MM}mm 开孔。
                </p>
              </div>
            </div>

            <div className="editor-stage-grid">
              <section className="device-editor-card">
                <div className="section-title">
                  <div>
                    <h3>Looki 机身预览</h3>
                    <p>所有编辑都直接叠加在机身预览上，方便随时看最终上机效果。</p>
                  </div>
                  <div className="device-editor-badges">
                    <span className="meta-chip">
                      {STICKER_MM.width.toFixed(2)}mm × {STICKER_MM.height.toFixed(2)}mm
                    </span>
                    <span className="meta-chip">{CAMERA_HOLE_MM}mm 开孔</span>
                  </div>
                </div>

                <div className="device-editor-shell">
                  <div
                    className="device-editor-machine"
                    style={{
                      aspectRatio: `${devicePreview.size.width} / ${devicePreview.size.height}`,
                    }}
                  >
                    <div className="device-editor-stage">
                      <img
                        className="device-editor-photo"
                        src={devicePreview.image}
                        alt={`Looki ${devicePreview.label} 参考机身`}
                      />
                      <div className="device-editor-overlay" style={deviceOverlayStyle}>
                        <canvas ref={editorCanvasRef} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="color-picker">
                  {Object.entries(DEVICE_OPTIONS).map(([key, option]) => (
                    <button
                      key={key}
                      className={deviceColor === key ? 'is-active' : ''}
                      type="button"
                      onClick={() => setDeviceColor(key as DeviceColor)}
                    >
                      <span
                        className="color-picker__swatch"
                        style={{ background: option.accent }}
                      />
                      {option.label}
                    </button>
                  ))}
                </div>

                <p className="canvas-note">
                  当前预览严格基于 reference 机身图；画布只负责真实可打印的 Skin 内容。
                </p>
              </section>
            </div>
          </section>

          <aside className="side-stack">
            <section className="panel controls-panel">
              <div className="section-title">
                <div>
                  <h3>编辑控制</h3>
                  <p>上传素材、开启绘制、管理图层，并保存为可复用的 Skin。</p>
                </div>
              </div>

              <label className="field">
                <span>Skin 名称</span>
                <input
                  type="text"
                  value={currentName}
                  onChange={(event) => setCurrentName(event.target.value)}
                  placeholder="例如：森林渐变 / 漫画头像"
                />
              </label>

              <label className="upload-button">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadImage}
                />
                上传图片素材
              </label>

              <div className="field">
                <span>Skin 背景色</span>
                <div className="draw-palette">
                  {BACKGROUND_COLORS.map((color) => (
                    <button
                      key={color}
                      className={backgroundColor === color ? 'is-active' : ''}
                      type="button"
                      style={{ background: color }}
                      onClick={() => handleBackgroundColorChange(color)}
                      aria-label={`选择 Skin 背景色 ${color}`}
                    />
                  ))}
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(event) => handleBackgroundColorChange(event.target.value)}
                    aria-label="自定义 Skin 背景色"
                  />
                </div>
                <p className="field-hint">图片没有覆盖到的区域会显示这个背景色。</p>
              </div>

              <div className="button-row">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={() => void handleUndo()}
                >
                  撤销 Ctrl+Z
                </button>
                <button
                  className={isDrawingMode ? 'is-active' : ''}
                  type="button"
                  onClick={() => setIsDrawingMode((value) => !value)}
                >
                  {isDrawingMode ? '退出画笔' : '进入画笔'}
                </button>
              </div>

              <button type="button" onClick={() => void handleStartFresh()}>
                新建空白 Skin
              </button>

              {previewUrl ? (
                <div className="live-preview-card">
                  <span>当前 Skin 缩略图</span>
                  <div className="live-preview-card__thumb">
                    <img src={previewUrl} alt="" />
                  </div>
                </div>
              ) : null}

              <div className="field">
                <span>画笔颜色</span>
                <div className="draw-palette">
                  {DRAWING_COLORS.map((color) => (
                    <button
                      key={color}
                      className={brushColor === color ? 'is-active' : ''}
                      type="button"
                      style={{ background: color }}
                      onClick={() => setBrushColor(color)}
                      aria-label={`选择画笔颜色 ${color}`}
                    />
                  ))}
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(event) => setBrushColor(event.target.value)}
                    aria-label="自定义画笔颜色"
                  />
                </div>
              </div>

              <label className="field">
                <span>画笔粗细：{brushSize}px</span>
                <input
                  type="range"
                  min="4"
                  max="48"
                  step="1"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
              </label>

              <div className="button-row">
                <button
                  type="button"
                  disabled={!hasSelection}
                  onClick={() => handleLayerMove('front')}
                >
                  上移一层
                </button>
                <button
                  type="button"
                  disabled={!hasSelection}
                  onClick={() => handleLayerMove('back')}
                >
                  下移一层
                </button>
              </div>

              <div className="button-row">
                <button
                  type="button"
                  disabled={!hasSelection}
                  onClick={handleDeleteSelection}
                >
                  删除当前对象
                </button>
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => saveCurrentDesign(false)}
                >
                  {currentDesign ? '更新当前 Skin' : '保存当前 Skin'}
                </button>
              </div>

              <button
                type="button"
                className="button-secondary"
                onClick={() => saveCurrentDesign(true)}
              >
                另存为新 Skin
              </button>
            </section>

            <section className="panel library-panel">
              <div className="section-title">
                <div>
                  <h3>Skin Library</h3>
                  <p>保存后的 Skin 可以继续编辑，也可以直接拿去打印排版。</p>
                </div>
              </div>

              {designs.length === 0 ? (
                <div className="empty-state">
                  <strong>还没有保存的 Skin</strong>
                  <p>上传一张图片或在画布里绘制后，点“保存当前 Skin”就会出现在这里。</p>
                </div>
              ) : (
                <div className="design-list">
                  {designs.map((design) => (
                    <article
                      key={design.id}
                      className={`design-card ${
                        selectedDesignId === design.id ? 'is-selected' : ''
                      }`}
                    >
                      <div className="design-card__preview">
                        <img src={design.preview} alt="" />
                      </div>
                      <div className="design-card__content">
                        <strong>{design.name}</strong>
                        <span>{formatTimeLabel(design.updatedAt)}</span>
                      </div>
                      <div className="design-card__actions">
                        <button type="button" onClick={() => void handleOpenDesign(design)}>
                          继续编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPage('layout')
                            setPickedLayoutDesignId(design.id)
                          }}
                        >
                          放入打印版
                        </button>
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() => void handleDeleteDesign(design.id)}
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </aside>
      </main>
      <main
        className={`workspace-grid workspace-grid--layout ${
          page !== 'layout' ? 'workspace-grid--hidden' : ''
        }`}
        aria-hidden={page !== 'layout'}
      >
          <section className="panel layout-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-heading__kicker">Print Layout</p>
                <h2>把多个 Skin 排进 A4 模板，并导出打印文件</h2>
                <p className="panel-heading__copy">
                  先在右侧选中一个 Skin，再点纸面位置放入；需要时也可以快速清空并重排。
                </p>
              </div>
            </div>

            <div className="layout-panel__paper">
              <LayoutPreview
                assignments={assignments}
                highlightedDesignId={pickedLayoutDesignId}
                previewDesigns={designMap}
                selectedSlotId={selectedSlotId}
                onSelectSlot={handleSlotSelect}
              />
            </div>
          </section>

          <aside className="side-stack">
            <section className="panel controls-panel">
              <div className="section-title">
                <div>
                  <h3>排版控制</h3>
                  <p>为 Looki Skin Lab 的打印版位分配 Skin，并导出 PNG / SVG。</p>
                </div>
              </div>

              <div className="slot-focus">
                <div>
                  <span>当前纸面位置</span>
                  <strong>{selectedSlotId.replace('slot-', 'S')}</strong>
                </div>
                <div>
                  <span>已放 Skin</span>
                  <strong>{activeSlotDesign?.name ?? '未放置'}</strong>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClearSelectedSlot}
                disabled={!activeSlotDesignId}
              >
                清空当前纸位
              </button>
              <p className="helper-copy">也可以按 Backspace / Del 快速清空当前纸位。</p>

              <div className="field">
                <span>当前准备放置的 Skin</span>
                {pickedLayoutDesignId ? (
                  <div className="picked-design">
                    <img
                      src={designMap.get(pickedLayoutDesignId)?.preview}
                      alt=""
                    />
                    <div>
                      <strong>
                        {designMap.get(pickedLayoutDesignId)?.name ?? '未命名 Skin'}
                      </strong>
                      <p>点击左侧纸面任意一个位置即可放入。</p>
                    </div>
                  </div>
                ) : (
                  <p className="helper-copy">请先从下方 Skin Library 里选择一个 Skin。</p>
                )}
              </div>

              <div className="button-row">
                <button
                  type="button"
                  className="button-primary"
                  disabled={isExporting || layoutCount === 0}
                  onClick={() => void handleDownloadA4()}
                >
                  {isExporting ? '正在导出 A4 PNG...' : '下载 A4 图片'}
                </button>
                <button
                  type="button"
                  disabled={layoutCount === 0}
                  onClick={handleDownloadCutBoard}
                >
                  下载切割刀板 SVG
                </button>
              </div>

              <p className="helper-copy">
                刀板文件默认只输出当前已放置 Skin 的位置；如果纸面为空，会回退为整张预制版位。
              </p>
            </section>

            <section className="panel library-panel">
              <div className="section-title">
                <div>
                  <h3>打印 Skin 库</h3>
                  <p>选中一个 Skin 后，点击左侧纸面位置即可放置。</p>
                </div>
              </div>

              {designs.length === 0 ? (
                <div className="empty-state">
                  <strong>打印库还是空的</strong>
                  <p>先回 Skin 编辑页保存几个 Skin，再回来排版。</p>
                </div>
              ) : (
                <div className="design-list">
                  {designs.map((design) => (
                    <article
                      key={design.id}
                      className={`design-card ${
                        pickedLayoutDesignId === design.id ? 'is-selected' : ''
                      }`}
                    >
                      <div className="design-card__preview">
                        <img src={design.preview} alt="" />
                      </div>
                      <div className="design-card__content">
                        <strong>{design.name}</strong>
                        <span>{formatTimeLabel(design.updatedAt)}</span>
                      </div>
                      <div className="design-card__actions">
                        <button
                          type="button"
                          onClick={() => setPickedLayoutDesignId(design.id)}
                        >
                          选中用于排版
                        </button>
                        <button type="button" onClick={() => void handleOpenDesign(design)}>
                          回到 Skin 编辑
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </aside>
      </main>
    </div>
  )
}

export default App
