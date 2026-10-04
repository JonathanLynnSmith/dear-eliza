import { memo, useEffect, useEffectEvent, useRef, useState } from 'react'
import letter from './data/letter.json'
import './App.css'

const BATTERY_DURATION_MS = 30_000
const CHARGE_INCREMENT_PERCENT = 20
const CHARGE_INCREMENT_MS =
  BATTERY_DURATION_MS * (CHARGE_INCREMENT_PERCENT / 100)
const BATTERY_WARNING_PERCENT = 30
const BATTERY_CRITICAL_PERCENT = 12
const MINIMUM_USABLE_ENERGY = 0.28
const BEAM_ENERGY_CURVE_EXPONENT = 0.75
const MINIMUM_BEAM_SIZE = 0.55
const BEAM_SIZE_CURVE_EXPONENT = 0.75
const MAX_FLICKERS_PER_BURST = 20
const MAX_FLICKER_TRANSITIONS_PER_SECOND = 2.75
const FLICKER_BURST_CONFIG = {
  dim: {
    strength: [0.55, 0.82],
    holdMs: [120, 260],
    pulseGapMs: [180, 360],
    recoveryMs: [900, 1_800],
    outageChance: 0,
  },
  outage: {
    strength: [0.25, 0.65],
    holdMs: [140, 300],
    pulseGapMs: [200, 420],
    recoveryMs: [700, 1_500],
    outageChance: 0.25,
  },
}
const SHAKE_REVERSALS_REQUIRED = 5
const SHAKE_WINDOW_MS = 900
const SHAKE_MIN_DISTANCE_PX = 14
const SHAKE_MIN_VELOCITY_PX_PER_MS = 0.45
const SHAKE_REVERSAL_DOT_PRODUCT = -0.35
const MOTION_PEAKS_REQUIRED = 4
const MOTION_WINDOW_MS = 900
const MOTION_PEAK_THRESHOLD = 13
const MOTION_PEAK_RESET_THRESHOLD = 10.5
const MOTION_PEAK_DEBOUNCE_MS = 160
const CHARGE_COOLDOWN_MS = 700
const CHARGED_MESSAGE_MS = 2_200
const FLASHLIGHT_DISTANCE_MIN_PX = 150
const FLASHLIGHT_DISTANCE_VIEWPORT_RATIO = 0.24
const FLASHLIGHT_DISTANCE_MAX_PX = 280
const FLASHLIGHT_EDGE_MARGIN_PX = 42
const FLASHLIGHT_LENS_OFFSET_PX = 48
// the beam is drawn once at this length and scaled, so it never re-lays out
const FLASHLIGHT_BEAM_MAX_LENGTH_PX = 640
const BATTERY_MS_PER_PERCENT = BATTERY_DURATION_MS / 100
const EYES_SPAWN_DELAY_MS = [2_000, 5_000]
const EYES_RETRY_MS = 3_000
// once the light comes back, how long the eyes linger before slipping away
const EYES_LIFETIME_MS = [5_000, 8_000]
const EYES_FADE_MS = 1_400
const EYES_FLEE_MS = 200
const EYES_HOVER_DISTANCE_PX = 40
const EYES_SPAWN_ATTEMPTS = 30
const EYES_PAPER_MARGIN_PX = 40
const EYES_HUD_CLEARANCE_PX = 110
const EYES_POINTER_CLEARANCE_PX = 280
const GLITCH_DURATION_MS = 650
const CARVING_FONT_SIZE_PX = 22
const CARVING_CHARACTER_WIDTH_PX = 19
const CARVING_LINE_HEIGHT_PX = 32
const CARVING_MAX_LINE_CHARACTERS = 9
// above or below the letter there is room for wider, shorter carvings
const CARVING_WIDE_MAX_LINE_CHARACTERS = 22
// wide carvings are cut closer to level so they fit the strip below the letter
const CARVING_WIDE_ROTATION_SCALE = 0.25
const CARVING_GAP_PX = 24
const CARVING_ROTATION_DEG = [-8, 8]
const CARVING_SPAWN_ATTEMPTS = 60
const BLOOD_SPLATTER_LIMIT = 5
const BLOOD_SPLATTER_X_PERCENT = [12, 82]
const BLOOD_SPLATTER_MIN_SPACING_PERCENT = 22
const BLOOD_SPLATTER_PLACEMENT_ATTEMPTS = 30
const BLOOD_SPLATTER_SCALE = [0.7, 1.1]
const BLOOD_SPLATTER_Y_PERCENT = [14, 82]
const BLOOD_SPLATTER_LOBES = 8
const BLOOD_SPLATTER_BLOB_POINTS = 48
const BLOOD_SPLATTER_DROPLETS = 22
const BLOOD_SPLATTER_STREAKS = 7
const BLOOD_SPLATTER_DRIPS = 3

function toBatteryPercent(batteryMs) {
  return Math.max(
    0,
    Math.min(100, Math.ceil((batteryMs / BATTERY_DURATION_MS) * 100)),
  )
}

function randomBetween([minimum, maximum]) {
  return minimum + Math.random() * (maximum - minimum)
}

function createFlickerBurstPlan(flickerBand) {
  const config = FLICKER_BURST_CONFIG[flickerBand]
  const pulseCount =
    1 + Math.floor(Math.random() * MAX_FLICKERS_PER_BURST)
  const pulses = Array.from({ length: pulseCount }, () => ({
    strength:
      Math.random() < config.outageChance
        ? 0
        : randomBetween(config.strength),
    holdMs: randomBetween(config.holdMs),
    pulseGapMs: randomBetween(config.pulseGapMs),
  }))
  const burstDurationMs = pulses.reduce(
    (duration, pulse, index) =>
      duration + pulse.holdMs + (index < pulseCount - 1 ? pulse.pulseGapMs : 0),
    0,
  )
  const minimumCycleMs =
    ((pulseCount * 2) / MAX_FLICKER_TRANSITIONS_PER_SECOND) * 1_000
  const recoveryMs = Math.max(
    randomBetween(config.recoveryMs),
    minimumCycleMs - burstDurationMs,
  )

  return { pulses, recoveryMs }
}

function findEyesPosition(paper, pointer) {
  const paperBounds = paper?.getBoundingClientRect()
  const width = window.innerWidth
  const height = window.innerHeight

  for (let attempt = 0; attempt < EYES_SPAWN_ATTEMPTS; attempt += 1) {
    const x = randomBetween([40, width - 40])
    const y = randomBetween([
      EYES_HUD_CLEARANCE_PX,
      height - EYES_HUD_CLEARANCE_PX,
    ])
    const isOnPaper =
      paperBounds &&
      x > paperBounds.left - EYES_PAPER_MARGIN_PX &&
      x < paperBounds.right + EYES_PAPER_MARGIN_PX &&
      y > paperBounds.top - EYES_PAPER_MARGIN_PX &&
      y < paperBounds.bottom + EYES_PAPER_MARGIN_PX
    const isNearBeam =
      pointer &&
      Math.hypot(x - pointer.x, y - pointer.y) < EYES_POINTER_CLEARANCE_PX
    if (!isOnPaper && !isNearBeam) return { x, y }
  }

  return null
}

// Breaks a carving into short lines so it fits in the strip of desk beside
// the letter.
function splitCarving(text, maxLineCharacters) {
  return text.split(' ').reduce((lines, word) => {
    const lastLine = lines.at(-1)
    if (lastLine && lastLine.length + 1 + word.length <= maxLineCharacters) {
      lines[lines.length - 1] = `${lastLine} ${word}`
    } else {
      lines.push(word)
    }
    return lines
  }, [])
}

function overlaps(a, b, gap) {
  return (
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap
  )
}

// Finds a spot on the bare desk for a new carving, preferring the part of the
// desk currently on screen so the glitch shows it being cut.
let carvingMeasureContext = null

// Measures carving lines in the carving font itself, falling back to an
// estimate when canvas text measurement is unavailable.
function measureCarvingWidth(lines) {
  carvingMeasureContext ??= document.createElement('canvas').getContext('2d')
  if (!carvingMeasureContext)
    return (
      Math.max(...lines.map((line) => line.length)) * CARVING_CHARACTER_WIDTH_PX
    )

  carvingMeasureContext.font = `${CARVING_FONT_SIZE_PX}px 'Rock Salt'`
  return Math.max(
    ...lines.map((line) => carvingMeasureContext.measureText(line).width),
  )
}

// Finds a spot on the bare desk for a new carving. It tries the strips beside
// the letter on screen first, so the glitch shows it being cut, then those
// strips anywhere on the page, then the desk above or below the letter.
function findCarvingPosition(page, paper, carvings, text, rotation) {
  if (!page || !paper) return null

  const pageBounds = page.getBoundingClientRect()
  const paperBounds = paper.getBoundingClientRect()
  const paperBox = {
    left: paperBounds.left - pageBounds.left,
    right: paperBounds.right - pageBounds.left,
    top: paperBounds.top - pageBounds.top,
    bottom: paperBounds.bottom - pageBounds.top,
  }
  const visibleRegion = [
    -pageBounds.top + EYES_HUD_CLEARANCE_PX,
    -pageBounds.top + window.innerHeight - EYES_HUD_CLEARANCE_PX,
  ]
  const pageRegion = [CARVING_GAP_PX, pageBounds.height - CARVING_GAP_PX]
  const passes = [
    [visibleRegion, 'sides', CARVING_MAX_LINE_CHARACTERS, rotation],
    [pageRegion, 'sides', CARVING_MAX_LINE_CHARACTERS, rotation],
    [
      pageRegion,
      'full',
      CARVING_WIDE_MAX_LINE_CHARACTERS,
      rotation * CARVING_WIDE_ROTATION_SCALE,
    ],
  ]

  for (const [
    [regionTop, regionBottom],
    lanePlan,
    maxLineCharacters,
    passRotation,
  ] of passes) {
    const lines = splitCarving(text, maxLineCharacters)
    const width = measureCarvingWidth(lines)
    const height = lines.length * CARVING_LINE_HEIGHT_PX
    // a tilted carving sweeps up or down by this much along its length
    const tilt = width * Math.abs(Math.sin((passRotation * Math.PI) / 180))
    const lanes = (
      lanePlan === 'sides'
        ? [
            [CARVING_GAP_PX, paperBox.left - CARVING_GAP_PX - width],
            [
              paperBox.right + CARVING_GAP_PX,
              pageBounds.width - CARVING_GAP_PX - width,
            ],
          ]
        : [[CARVING_GAP_PX, pageBounds.width - CARVING_GAP_PX - width]]
    ).filter(([minimum, maximum]) => maximum >= minimum)
    if (lanes.length === 0 || regionBottom - regionTop < height + tilt * 2)
      continue

    for (let attempt = 0; attempt < CARVING_SPAWN_ATTEMPTS; attempt += 1) {
      const lane = lanes[Math.floor(Math.random() * lanes.length)]
      const left = randomBetween(lane)
      const top = randomBetween([regionTop + tilt, regionBottom - height - tilt])
      const box = {
        left,
        right: left + width,
        top,
        bottom: top + height,
      }
      const footprint = {
        ...box,
        top: box.top - tilt,
        bottom: box.bottom + tilt,
      }
      if (
        !overlaps(footprint, paperBox, CARVING_GAP_PX) &&
        !carvings.some((carving) =>
          overlaps(footprint, carving.footprint, CARVING_GAP_PX),
        )
      )
        return {
          ...box,
          footprint,
          text: lines.join('\n'),
          rotation: passRotation,
        }
    }
  }

  return null
}

// Picks a spot on the letter that keeps clear of earlier splatters, falling
// back to the last spot tried if the page is already crowded.
function placeBloodSplatter(splatters) {
  let position = null
  for (
    let attempt = 0;
    attempt < BLOOD_SPLATTER_PLACEMENT_ATTEMPTS;
    attempt += 1
  ) {
    position = {
      left: randomBetween(BLOOD_SPLATTER_X_PERCENT),
      top: randomBetween(BLOOD_SPLATTER_Y_PERCENT),
    }
    const isClear = splatters.every(
      (splatter) =>
        Math.hypot(splatter.left - position.left, splatter.top - position.top) >=
        BLOOD_SPLATTER_MIN_SPACING_PERCENT,
    )
    if (isClear) break
  }
  return position
}

// Builds a one-off blood splatter in a 300 x 300 box centered on 0,0: a
// ragged central blob, droplets and streaks flung outward, and a few drips.
function createBloodSplatter(splatters) {
  const lobeRadii = Array.from({ length: BLOOD_SPLATTER_LOBES }, () =>
    randomBetween([46, 78]),
  )
  const blobPoints = Array.from(
    { length: BLOOD_SPLATTER_BLOB_POINTS },
    (_, index) => {
      // a few big lobes with a ragged, splashed edge baked into the shape
      const angle = (index / BLOOD_SPLATTER_BLOB_POINTS) * Math.PI * 2
      const lobe = lobeRadii[
        Math.floor((index / BLOOD_SPLATTER_BLOB_POINTS) * BLOOD_SPLATTER_LOBES)
      ]
      const radius = lobe + randomBetween([-7, 7])
      return [Math.cos(angle) * radius, Math.sin(angle) * radius]
    },
  )
  const blobPath =
    blobPoints
      .map(([x, y], index) => {
        const [nextX, nextY] = blobPoints[(index + 1) % blobPoints.length]
        const midX = (x + nextX) / 2
        const midY = (y + nextY) / 2
        return `${index === 0 ? `M${midX} ${midY}` : ''} Q${nextX} ${nextY} ${(nextX + blobPoints[(index + 2) % blobPoints.length][0]) / 2} ${(nextY + blobPoints[(index + 2) % blobPoints.length][1]) / 2}`
      })
      .join(' ') + ' Z'

  const droplets = Array.from({ length: BLOOD_SPLATTER_DROPLETS }, () => {
    const angle = randomBetween([0, Math.PI * 2])
    const distance = randomBetween([82, 145])
    return {
      cx: Math.cos(angle) * distance,
      cy: Math.sin(angle) * distance,
      r: randomBetween([1.2, 7]) * (1 - distance / 220),
    }
  })

  const streaks = Array.from({ length: BLOOD_SPLATTER_STREAKS }, () => {
    const angle = randomBetween([0, Math.PI * 2])
    const distance = randomBetween([66, 108])
    return {
      cx: Math.cos(angle) * distance,
      cy: Math.sin(angle) * distance,
      rx: randomBetween([14, 30]),
      ry: randomBetween([2.5, 5]),
      angle: (angle * 180) / Math.PI,
    }
  })

  const drips = Array.from({ length: BLOOD_SPLATTER_DRIPS }, () => {
    const x = randomBetween([-44, 44])
    const y = randomBetween([20, 40])
    const length = randomBetween([50, 120])
    const width = randomBetween([5, 9])
    const half = width / 2
    const bulb = width * 0.7
    // a run that narrows as it falls and ends in a heavier drop
    return `M${x - half} ${y} C${x - half} ${y + length * 0.6} ${x - width * 0.3} ${y + length * 0.8} ${x - bulb} ${y + length} A${bulb} ${bulb} 0 1 0 ${x + bulb} ${y + length} C${x + width * 0.3} ${y + length * 0.8} ${x + half} ${y + length * 0.6} ${x + half} ${y} Z`
  })

  return {
    blobPath,
    droplets,
    streaks,
    drips,
    ...placeBloodSplatter(splatters),
    scale: randomBetween(BLOOD_SPLATTER_SCALE),
    rotation: randomBetween([0, 360]),
    id: performance.now(),
  }
}

function renderInk(text) {
  return text
    .split(/~~(.+?)~~/)
    .map((part, index) =>
      index % 2 === 1 ? <s key={index}>{part}</s> : part,
    )
}

function renderUnsteadyInk(text) {
  return text.split(' ').map((word, index) => (
    <span
      key={index}
      className="unsteady-word"
      style={{
        '--word-tilt': `${((index * 37) % 9) - 4}deg`,
        '--word-drop': `${((index * 53) % 7) - 2}px`,
      }}
    >
      {word}{' '}
    </span>
  ))
}

function formatTimecode(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function Timecode({ isRunning }) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!isRunning) return undefined
    const timerId = window.setInterval(
      () => setSeconds((current) => current + 1),
      1_000,
    )
    return () => window.clearInterval(timerId)
  }, [isRunning])

  return (
    <span className="hud-timecode" aria-hidden="true">
      {formatTimecode(seconds)}
    </span>
  )
}

// The static filter definitions used by the carvings.
const svgFilters = (
  <svg className="svg-filters" aria-hidden="true">
    <filter id="carving-gouge">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.45"
        numOctaves="2"
        seed="13"
      />
      <feDisplacementMap
        in="SourceGraphic"
        scale="2.5"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </svg>
)

// The parts of the page that only change when the story moves on are memoized
// so the flashlight, battery, and HUD updates don't re-render them.
const DeskCarvings = memo(function DeskCarvings({ carvings }) {
  return (
    <div className="desk-carvings" aria-hidden="true">
      {carvings.map((carving, index) => (
        <span
          key={carving.text}
          className={
            index === carvings.length - 1 ? 'is-fresh' : undefined
          }
          style={{
            left: `${carving.left}px`,
            top: `${carving.top}px`,
            '--carving-rotation': `${carving.rotation}deg`,
            '--carving-font-size': `${CARVING_FONT_SIZE_PX}px`,
            '--carving-line-height': `${CARVING_LINE_HEIGHT_PX}px`,
          }}
        >
          {carving.text}
        </span>
      ))}
    </div>
  )
})

const BloodSplatter = memo(function BloodSplatter({ splatter }) {
  return (
    <svg
      className="blood-splatter"
      viewBox="-150 -150 300 300"
      style={{
        left: `${splatter.left}%`,
        top: `${splatter.top}%`,
        '--splatter-rotation': `${splatter.rotation}deg`,
        '--splatter-scale': splatter.scale,
      }}
      aria-hidden="true"
    >
      <g>
        <path d={splatter.blobPath} />
        {splatter.streaks.map((streak, index) => (
          <ellipse
            key={`streak-${index}`}
            cx={streak.cx}
            cy={streak.cy}
            rx={streak.rx}
            ry={streak.ry}
            transform={`rotate(${streak.angle} ${streak.cx} ${streak.cy})`}
          />
        ))}
        {splatter.droplets.map((droplet, index) => (
          <circle
            key={`droplet-${index}`}
            cx={droplet.cx}
            cy={droplet.cy}
            r={droplet.r}
          />
        ))}
      </g>
      <g className="blood-drips" transform={`rotate(${-splatter.rotation})`}>
        {splatter.drips.map((drip, index) => (
          <path
            key={`drip-${index}`}
            d={drip}
            style={{ '--drip-delay': `${index * 0.35}s` }}
          />
        ))}
      </g>
    </svg>
  )
})

const LetterPaper = memo(function LetterPaper({ paperRef, bloodSplatters }) {
  return (
    <article ref={paperRef} className="letter-paper">
      {bloodSplatters.map((splatter) => (
        <BloodSplatter key={splatter.id} splatter={splatter} />
      ))}
      <p className="letter-heading">
        {letter.place}
        <br />
        {letter.date}
      </p>
      <p className="letter-salutation">{letter.salutation}</p>
      {letter.paragraphs.map((paragraph) => (
        <p key={paragraph}>{renderInk(paragraph)}</p>
      ))}
      <p className="letter-closing">
        {letter.closing}
        <br />
        <span className="letter-signature">
          {letter.signature}
          <svg
            className="signature-flourish"
            viewBox="0 0 220 34"
            aria-hidden="true"
          >
            <path d="M4 20 C 40 30, 90 8, 140 16 S 200 26, 214 6 C 206 18, 170 32, 120 26 S 50 18, 24 28" />
          </svg>
        </span>
      </p>
      <p className="letter-postscript">
        {renderUnsteadyInk(letter.postscript)}
      </p>
    </article>
  )
})

function App() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(pointer: coarse)').matches
  })
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  // React only hears about the battery when its displayed percentage changes;
  // the exact charge lives in batteryMsRef so draining doesn't re-render every
  // frame.
  const [batteryPercent, setBatteryPercent] = useState(100)
  const [chargeRevision, setChargeRevision] = useState(0)
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => {
    if (typeof document === 'undefined') return true
    return !document.hidden
  })
  const [shakeProgress, setShakeProgress] = useState(0)
  const [shakeProgressTarget, setShakeProgressTarget] = useState(
    SHAKE_REVERSALS_REQUIRED,
  )
  const [motionState, setMotionState] = useState(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.DeviceMotionEvent === 'undefined'
    )
      return 'unavailable'
    return typeof window.DeviceMotionEvent.requestPermission === 'function'
      ? 'needs-permission'
      : 'listening'
  })
  const [statusMessage, setStatusMessage] = useState('')
  const [flickerMultiplier, setFlickerMultiplier] = useState(1)
  const [eyes, setEyes] = useState(null)
  const [glitch, setGlitch] = useState(null)
  const [carvings, setCarvings] = useState([])
  const [bloodSplatters, setBloodSplatters] = useState([])
  const pageRef = useRef(null)
  const batteryMsRef = useRef(BATTERY_DURATION_MS)
  const flashlightRef = useRef(null)
  const maskRef = useRef(null)
  const spotlightFrameRef = useRef(null)
  const lastFrameRef = useRef(null)
  const depletionTimerRef = useRef(null)
  const pointerShakeRef = useRef({ point: null, vector: null, reversals: [] })
  const motionPeaksRef = useRef({
    peaks: [],
    lastPeakAt: -Infinity,
    isAboveThreshold: false,
  })
  const chargeCooldownUntilRef = useRef(0)
  const chargedMessageTimerRef = useRef(null)
  const shakeProgressTimerRef = useRef(null)
  const announcedThresholdRef = useRef('healthy')
  const paperRef = useRef(null)
  const pointerRef = useRef(null)

  const normalizedCharge = batteryPercent / 100
  const beamEnergy =
    batteryPercent === 0
      ? 0
      : MINIMUM_USABLE_ENERGY +
        (1 - MINIMUM_USABLE_ENERGY) *
          normalizedCharge ** BEAM_ENERGY_CURVE_EXPONENT
  const beamSize =
    batteryPercent === 0
      ? 0
      : batteryPercent >= 50
        ? 1
        : MINIMUM_BEAM_SIZE +
          (1 - MINIMUM_BEAM_SIZE) *
            (batteryPercent / 50) ** BEAM_SIZE_CURVE_EXPONENT
  const batteryState =
    batteryPercent === 0
      ? 'empty'
      : batteryPercent <= BATTERY_CRITICAL_PERCENT
        ? 'critical'
        : batteryPercent <= BATTERY_WARNING_PERCENT
          ? 'warning'
          : 'healthy'
  const isBatteryEmpty = batteryPercent === 0
  const suppressDecorativeMotion =
    isCoarsePointer || prefersReducedMotion
  const flickerBand =
    suppressDecorativeMotion ||
    batteryPercent === 0 ||
    batteryPercent >= 20
      ? 'stable'
      : batteryPercent >= 10
        ? 'dim'
        : 'outage'
  const isActiveFlickerDip =
    flickerBand !== 'stable' && flickerMultiplier < 1
  const effectiveBeamEnergy =
    batteryPercent === 0
      ? 0
      : isActiveFlickerDip
        ? beamEnergy * flickerMultiplier
        : Math.max(MINIMUM_USABLE_ENERGY, beamEnergy)

  function commitBatteryMs(nextBatteryMs) {
    batteryMsRef.current = nextBatteryMs
    setBatteryPercent(toBatteryPercent(nextBatteryMs))
  }

  useEffect(() => {
    const coarsePointerQuery = window.matchMedia('(pointer: coarse)')
    const reducedMotionQuery = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    )

    function updateMotionPreference() {
      setIsCoarsePointer(coarsePointerQuery.matches)
      setPrefersReducedMotion(reducedMotionQuery.matches)
    }

    coarsePointerQuery.addEventListener('change', updateMotionPreference)
    reducedMotionQuery.addEventListener('change', updateMotionPreference)
    updateMotionPreference()

    return () => {
      coarsePointerQuery.removeEventListener('change', updateMotionPreference)
      reducedMotionQuery.removeEventListener('change', updateMotionPreference)
    }
  }, [])

  useEffect(() => {
    // carvings are measured in their font before the first one is drawn
    document.fonts?.load(`${CARVING_FONT_SIZE_PX}px 'Rock Salt'`)
  }, [])

  useEffect(() => {
    function updateDocumentState() {
      setIsDocumentVisible(!document.hidden)
    }

    document.addEventListener('visibilitychange', updateDocumentState)

    return () => {
      document.removeEventListener('visibilitychange', updateDocumentState)
    }
  }, [])

  useEffect(() => {
    if (!isDocumentVisible || isBatteryEmpty) {
      lastFrameRef.current = null
      return undefined
    }

    // Wakes once each time the displayed percentage should tick down, rather
    // than every animation frame.
    lastFrameRef.current = performance.now()
    function drainBattery() {
      const now = performance.now()
      const elapsed = now - lastFrameRef.current
      lastFrameRef.current = now
      const remaining = Math.max(0, batteryMsRef.current - elapsed)
      commitBatteryMs(remaining)
      if (remaining === 0) {
        depletionTimerRef.current = null
        lastFrameRef.current = null
        return
      }
      depletionTimerRef.current = window.setTimeout(
        drainBattery,
        (remaining % BATTERY_MS_PER_PERCENT || BATTERY_MS_PER_PERCENT) + 1,
      )
    }

    depletionTimerRef.current = window.setTimeout(
      drainBattery,
      (batteryMsRef.current % BATTERY_MS_PER_PERCENT ||
        BATTERY_MS_PER_PERCENT) + 1,
    )

    return () => {
      if (depletionTimerRef.current !== null) {
        window.clearTimeout(depletionTimerRef.current)
        depletionTimerRef.current = null
      }
      if (lastFrameRef.current !== null) {
        const elapsed = performance.now() - lastFrameRef.current
        commitBatteryMs(Math.max(0, batteryMsRef.current - elapsed))
      }
      lastFrameRef.current = null
    }
  }, [isDocumentVisible, isBatteryEmpty, chargeRevision])

  useEffect(() => {
    if (batteryState === announcedThresholdRef.current) return

    announcedThresholdRef.current = batteryState
    const shakeTarget = isCoarsePointer ? 'device' : 'flashlight quickly'
    const message = {
      warning: `Battery low, 30% remaining. Shake your ${shakeTarget} to charge.`,
      critical: `Battery critical, 12% remaining. Shake your ${shakeTarget} to charge.`,
      empty: `Battery empty. Shake your ${shakeTarget} to restore 20%.`,
    }[batteryState]
    if (!message) return

    const timerId = window.setTimeout(() => setStatusMessage(message), 0)
    return () => window.clearTimeout(timerId)
  }, [batteryState, isCoarsePointer])

  useEffect(() => {
    if (flickerBand === 'stable' || !isDocumentVisible) return undefined

    const timerIds = new Set()
    let cancelled = false

    function schedule(callback, delayMs) {
      const timerId = window.setTimeout(() => {
        timerIds.delete(timerId)
        if (!cancelled) callback()
      }, delayMs)
      timerIds.add(timerId)
    }

    function scheduleBurst() {
      const { pulses, recoveryMs } = createFlickerBurstPlan(flickerBand)
      let elapsedMs = 0

      pulses.forEach((pulse, index) => {
        schedule(() => setFlickerMultiplier(pulse.strength), elapsedMs)
        elapsedMs += pulse.holdMs
        schedule(() => setFlickerMultiplier(1), elapsedMs)
        if (index < pulses.length - 1) elapsedMs += pulse.pulseGapMs
      })

      schedule(scheduleBurst, elapsedMs + recoveryMs)
    }

    scheduleBurst()
    return () => {
      cancelled = true
      timerIds.forEach((timerId) => window.clearTimeout(timerId))
      timerIds.clear()
      setFlickerMultiplier(1)
    }
  }, [flickerBand, isDocumentVisible])

  useEffect(
    () => () => {
      if (spotlightFrameRef.current !== null) {
        window.cancelAnimationFrame(spotlightFrameRef.current)
        // cleared so a remount (StrictMode runs one in development) can
        // schedule frames again
        spotlightFrameRef.current = null
      }
      if (chargedMessageTimerRef.current)
        window.clearTimeout(chargedMessageTimerRef.current)
      if (shakeProgressTimerRef.current)
        window.clearTimeout(shakeProgressTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    // the eyes only come while the light is out
    if (prefersReducedMotion || !isDocumentVisible || !isBatteryEmpty || eyes)
      return undefined

    let timerId = null
    function trySpawn() {
      const position = findEyesPosition(paperRef.current, pointerRef.current)
      if (position) {
        setEyes({ ...position, id: performance.now(), phase: 'watching' })
      } else {
        timerId = window.setTimeout(trySpawn, EYES_RETRY_MS)
      }
    }

    timerId = window.setTimeout(trySpawn, randomBetween(EYES_SPAWN_DELAY_MS))
    return () => window.clearTimeout(timerId)
  }, [eyes, isBatteryEmpty, isDocumentVisible, prefersReducedMotion])

  useEffect(() => {
    // in the dark they keep watching; once the light is back they linger a
    // little while before slipping away
    if (
      !eyes ||
      !isDocumentVisible ||
      (eyes.phase === 'watching' && isBatteryEmpty)
    )
      return undefined

    const timerId =
      eyes.phase === 'watching'
        ? window.setTimeout(
            () => setEyes((current) => ({ ...current, phase: 'fading' })),
            randomBetween(EYES_LIFETIME_MS),
          )
        : window.setTimeout(
            () => setEyes(null),
            eyes.phase === 'fleeing' ? EYES_FLEE_MS : EYES_FADE_MS,
          )
    return () => window.clearTimeout(timerId)
  }, [eyes, isBatteryEmpty, isDocumentVisible])

  useEffect(() => {
    if (!glitch) return undefined

    const timerId = window.setTimeout(
      () => setGlitch(null),
      GLITCH_DURATION_MS,
    )
    return () => window.clearTimeout(timerId)
  }, [glitch])

  function clearChargeDetectorHistory() {
    setShakeProgress(0)
    setShakeProgressTarget(SHAKE_REVERSALS_REQUIRED)
    pointerShakeRef.current = { point: null, vector: null, reversals: [] }
    motionPeaksRef.current = {
      peaks: [],
      lastPeakAt: -Infinity,
      isAboveThreshold: false,
    }
    if (shakeProgressTimerRef.current)
      window.clearTimeout(shakeProgressTimerRef.current)
  }

  function addCharge() {
    if (
      batteryPercent >= 100 ||
      performance.now() < chargeCooldownUntilRef.current
    )
      return

    const nextBatteryMs = Math.min(
      BATTERY_DURATION_MS,
      batteryMsRef.current + CHARGE_INCREMENT_MS,
    )
    const nextPercent = Math.ceil(
      (nextBatteryMs / BATTERY_DURATION_MS) * 100,
    )
    chargeCooldownUntilRef.current = performance.now() + CHARGE_COOLDOWN_MS
    commitBatteryMs(nextBatteryMs)
    setChargeRevision((current) => current + 1)
    clearChargeDetectorHistory()
    announcedThresholdRef.current =
      nextPercent <= BATTERY_CRITICAL_PERCENT
        ? 'critical'
        : nextPercent <= BATTERY_WARNING_PERCENT
          ? 'warning'
          : 'healthy'
    setStatusMessage(
      `+${CHARGE_INCREMENT_PERCENT}% charge · ${nextPercent}%`,
    )
    if (chargedMessageTimerRef.current)
      window.clearTimeout(chargedMessageTimerRef.current)
    chargedMessageTimerRef.current = window.setTimeout(
      () => setStatusMessage(''),
      CHARGED_MESSAGE_MS,
    )
  }

  function trackPointerShake(event) {
    if (
      batteryPercent >= 100 ||
      event.pointerType === 'touch' ||
      isCoarsePointer ||
      performance.now() < chargeCooldownUntilRef.current
    )
      return

    const now = performance.now()
    const shake = pointerShakeRef.current
    const point = { x: event.clientX, y: event.clientY, time: now }
    if (!shake.point) {
      shake.point = point
      return
    }

    const dx = point.x - shake.point.x
    const dy = point.y - shake.point.y
    const distance = Math.hypot(dx, dy)
    if (distance < SHAKE_MIN_DISTANCE_PX) return

    const elapsed = Math.max(1, now - shake.point.time)
    const isFastSegment =
      distance / elapsed >= SHAKE_MIN_VELOCITY_PX_PER_MS
    const vector = { x: dx / distance, y: dy / distance }
    if (
      isFastSegment &&
      shake.vector &&
      vector.x * shake.vector.x + vector.y * shake.vector.y <
        SHAKE_REVERSAL_DOT_PRODUCT
    ) {
      shake.reversals = shake.reversals.filter(
        (timestamp) => now - timestamp <= SHAKE_WINDOW_MS,
      )
      shake.reversals.push(now)
      setShakeProgressTarget(SHAKE_REVERSALS_REQUIRED)
      setShakeProgress(
        Math.min(SHAKE_REVERSALS_REQUIRED, shake.reversals.length),
      )
      if (shakeProgressTimerRef.current)
        window.clearTimeout(shakeProgressTimerRef.current)
      shakeProgressTimerRef.current = window.setTimeout(() => {
        shake.reversals = []
        setShakeProgress(0)
      }, SHAKE_WINDOW_MS)
      if (shake.reversals.length >= SHAKE_REVERSALS_REQUIRED) addCharge()
    }
    shake.point = point
    shake.vector = isFastSegment ? vector : null
  }

  const handleMotion = useEffectEvent((event) => {
    const now = performance.now()
    if (
      batteryPercent >= 100 ||
      now < chargeCooldownUntilRef.current
    )
      return
    const acceleration = event.accelerationIncludingGravity
    if (!acceleration) return
    const magnitude = Math.hypot(
      acceleration.x || 0,
      acceleration.y || 0,
      acceleration.z || 0,
    )
    const motion = motionPeaksRef.current
    if (magnitude <= MOTION_PEAK_RESET_THRESHOLD) {
      motion.isAboveThreshold = false
      return
    }
    if (magnitude < MOTION_PEAK_THRESHOLD || motion.isAboveThreshold) return
    motion.isAboveThreshold = true
    if (now - motion.lastPeakAt < MOTION_PEAK_DEBOUNCE_MS) return
    motion.lastPeakAt = now
    motion.peaks = motion.peaks.filter(
      (timestamp) => now - timestamp <= MOTION_WINDOW_MS,
    )
    motion.peaks.push(now)
    setShakeProgressTarget(MOTION_PEAKS_REQUIRED)
    setShakeProgress(
      Math.min(MOTION_PEAKS_REQUIRED, motion.peaks.length),
    )
    if (shakeProgressTimerRef.current)
      window.clearTimeout(shakeProgressTimerRef.current)
    shakeProgressTimerRef.current = window.setTimeout(() => {
      motion.peaks = []
      setShakeProgress(0)
    }, MOTION_WINDOW_MS)
    if (motion.peaks.length >= MOTION_PEAKS_REQUIRED) addCharge()
  })

  async function enableMotionRecharge() {
    if (typeof window.DeviceMotionEvent === 'undefined') {
      setMotionState('unavailable')
      setStatusMessage('Motion sensor unavailable on this device.')
      return
    }

    setMotionState('requesting')
    try {
      if (typeof window.DeviceMotionEvent.requestPermission === 'function') {
        const permission = await window.DeviceMotionEvent.requestPermission()
        if (permission !== 'granted') {
          setMotionState('denied')
          setStatusMessage('Motion access denied. Device shake is unavailable.')
          return
        }
      }
      setShakeProgressTarget(MOTION_PEAKS_REQUIRED)
      setMotionState('listening')
      setStatusMessage('Motion recharge ready. Shake your device')
    } catch {
      // usually means the request didn't count as a user gesture; the next tap
      // can try again
      setMotionState('needs-permission')
      setStatusMessage('Tap again to enable motion recharge.')
    }
  }

  // Finding the eyes glitches the camera, and they are gone when it clears.
  function disturbEyes(event) {
    // nothing happens in the dark; the light has to be on to catch them
    if (
      isBatteryEmpty ||
      eyes?.phase !== 'watching' ||
      Math.hypot(event.clientX - eyes.x, event.clientY - eyes.y) >
        EYES_HOVER_DISTANCE_PX
    )
      return

    setEyes({ ...eyes, phase: 'fleeing' })
    setGlitch({ id: performance.now() })
    if (bloodSplatters.length < BLOOD_SPLATTER_LIMIT) {
      setBloodSplatters([
        ...bloodSplatters,
        createBloodSplatter(bloodSplatters),
      ])
    }

    const text = letter.carvings[carvings.length]
    const rotation = randomBetween(CARVING_ROTATION_DEG)
    const position =
      text &&
      findCarvingPosition(
        pageRef.current,
        paperRef.current,
        carvings,
        text,
        rotation,
      )
    if (position) {
      setCarvings([
        ...carvings,
        position,
      ])
    }
  }

  function handlePagePointerDown(event) {
    disturbEyes(event)
  }

  // iOS only grants motion access from a completed tap, so ask on click
  function handlePageClick() {
    if (isCoarsePointer && motionState === 'needs-permission') {
      enableMotionRecharge()
    }
  }

  useEffect(() => {
    if (motionState !== 'listening') return undefined

    window.addEventListener('devicemotion', handleMotion)
    return () => window.removeEventListener('devicemotion', handleMotion)
  }, [motionState])

  // Places the flashlight and the hole in the darkness. Runs at most once per
  // frame, and writes only onto the two elements that use the values so the
  // rest of the page isn't restyled.
  function drawSpotlight() {
    spotlightFrameRef.current = null
    const pointer = pointerRef.current
    if (!pointer || !pageRef.current) return

    const bounds = pageRef.current.getBoundingClientRect()
    const endpointX = pointer.x - bounds.left
    const endpointY = pointer.y - bounds.top
    const centerX = bounds.width / 2
    const centerY = bounds.height / 2
    const outwardX = endpointX - centerX
    const outwardY = endpointY - centerY
    const outwardLength = Math.max(1, Math.hypot(outwardX, outwardY))
    const bodyDistance = Math.min(
      FLASHLIGHT_DISTANCE_MAX_PX,
      Math.max(
        FLASHLIGHT_DISTANCE_MIN_PX,
        bounds.width * FLASHLIGHT_DISTANCE_VIEWPORT_RATIO,
      ),
    )
    const bodyX = Math.min(
      bounds.width - FLASHLIGHT_EDGE_MARGIN_PX,
      Math.max(
        FLASHLIGHT_EDGE_MARGIN_PX,
        endpointX - (outwardX / outwardLength) * bodyDistance,
      ),
    )
    const bodyY = Math.min(
      bounds.height - FLASHLIGHT_EDGE_MARGIN_PX,
      Math.max(
        FLASHLIGHT_EDGE_MARGIN_PX,
        endpointY - (outwardY / outwardLength) * bodyDistance,
      ),
    )
    const rayX = endpointX - bodyX
    const rayY = endpointY - bodyY
    const rayLength = Math.hypot(rayX, rayY)
    const angle = (Math.atan2(rayY, rayX) * 180) / Math.PI

    // the darkness is fixed to the viewport, so it takes viewport coordinates
    maskRef.current?.style.setProperty('--spotlight-x', `${pointer.x}px`)
    maskRef.current?.style.setProperty('--spotlight-y', `${pointer.y}px`)
    const flashlight = flashlightRef.current
    if (!flashlight) return
    flashlight.style.setProperty('--flashlight-x', `${bodyX}px`)
    flashlight.style.setProperty('--flashlight-y', `${bodyY}px`)
    flashlight.style.setProperty(
      '--flashlight-beam-scale',
      Math.max(0, rayLength - FLASHLIGHT_LENS_OFFSET_PX) /
        FLASHLIGHT_BEAM_MAX_LENGTH_PX,
    )
    flashlight.style.setProperty('--flashlight-angle', `${angle}deg`)
  }

  function scheduleSpotlight() {
    spotlightFrameRef.current ??= window.requestAnimationFrame(drawSpotlight)
  }

  // Aim the light at the middle of the screen before the first pointer move
  // (and for good on touch), and keep it under the pointer while scrolling.
  const handleViewportChange = useEffectEvent(scheduleSpotlight)
  useEffect(() => {
    pointerRef.current ??= {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }
    handleViewportChange()
    window.addEventListener('scroll', handleViewportChange, { passive: true })
    window.addEventListener('resize', handleViewportChange)
    return () => {
      window.removeEventListener('scroll', handleViewportChange)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [])

  function moveSpotlight(event) {
    trackPointerShake(event)
    if (event.pointerType === 'touch' || !pageRef.current) return

    pointerRef.current = { x: event.clientX, y: event.clientY }
    disturbEyes(event)
    scheduleSpotlight()
  }


  return (
    <main
      ref={pageRef}
      className={[
        'letter-page',
        `battery-${batteryState}`,
        glitch && 'is-glitching',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={handlePagePointerDown}
      onClick={handlePageClick}
      onPointerMove={moveSpotlight}
    >
      <div className="page-noise" aria-hidden="true" />
      {svgFilters}
      <DeskCarvings carvings={carvings} />
      <div className="camcorder-hud">
        <span className="viewfinder-corner top-left" aria-hidden="true" />
        <span className="viewfinder-corner top-right" aria-hidden="true" />
        <span className="viewfinder-corner bottom-left" aria-hidden="true" />
        <span className="viewfinder-corner bottom-right" aria-hidden="true" />

        <div className="hud-recording" aria-hidden="true">
          {isBatteryEmpty ? (
            <span>STBY</span>
          ) : (
            <>
              <span className="rec-dot" />
              <span>REC</span>
            </>
          )}
          <span className="hud-tape-speed">SP</span>
        </div>

        <div
          className="battery-status"
          role="progressbar"
          aria-label={`Flashlight battery: ${batteryPercent}%`}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={batteryPercent}
        >
          <span className="battery-icon" aria-hidden="true">
            {[1, 2, 3, 4].map((segment) => (
              <span
                key={segment}
                className={
                  batteryPercent > (segment - 1) * 25 ? 'is-charged' : ''
                }
              />
            ))}
          </span>
          <span className="battery-value">{batteryPercent}%</span>
        </div>

        <Timecode isRunning={isDocumentVisible && !isBatteryEmpty} />
        <span className="hud-date" aria-hidden="true">
          OCT.31 1998
        </span>

        <p
          className="shake-status"
          role="status"
          aria-live={shakeProgress > 0 ? 'off' : 'polite'}
          aria-atomic="true"
        >
          {shakeProgress > 0
            ? `Charging ${'▮'.repeat(shakeProgress)}${'▯'.repeat(Math.max(0, shakeProgressTarget - shakeProgress))}`
            : statusMessage ||
              (isCoarsePointer
                ? motionState === 'requesting'
                  ? 'Enabling device motion...'
                  : motionState === 'denied'
                    ? 'Motion access denied. Device shake is unavailable.'
                    : motionState === 'unavailable'
                      ? 'Motion sensor unavailable on this device.'
                      : isBatteryEmpty
                        ? 'Battery empty. Shake your device to restore 20%.'
                        : 'Shake your device to charge.'
                : isBatteryEmpty
                  ? 'Battery empty. Shake your flashlight quickly to restore 20%.'
                  : 'Shake your flashlight quickly to charge.')}
        </p>
      </div>

      <section className="letter-layout" aria-labelledby="letter-title">
        <h1 id="letter-title" className="visually-hidden">
          A letter from {letter.place}
        </h1>
        <div className="letter-shell">
          <div className="letter-shadow" aria-hidden="true" />
          <LetterPaper paperRef={paperRef} bloodSplatters={bloodSplatters} />
        </div>
      </section>

      <div
        ref={flashlightRef}
        className="flashlight"
        style={{ '--beam-energy': effectiveBeamEnergy }}
        aria-hidden="true"
      >
        <span className="flashlight-beam">
          <span className="beam-falloff" />
          <span className="beam-spill" />
          <span className="beam-core" />
        </span>
        <span className="flashlight-body">
          <span className="flashlight-head" />
          <span className="flashlight-lens" />
          <span className="flashlight-grip" />
        </span>
      </div>
      <div
        ref={maskRef}
        className="spotlight-mask"
        style={{
          '--beam-energy': effectiveBeamEnergy,
          '--beam-size': beamSize,
        }}
        aria-hidden="true"
      >
        <div className="spotlight-hole" />
      </div>
      {eyes && (
        <div
          key={eyes.id}
          className={`lurking-eyes is-${eyes.phase}`}
          style={{ left: `${eyes.x}px`, top: `${eyes.y}px` }}
          aria-hidden="true"
        >
          <span />
          <span />
        </div>
      )}
      {glitch && (
        <div className="glitch-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </main>
  )
}

export default App
