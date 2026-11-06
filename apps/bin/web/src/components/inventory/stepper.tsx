import { MinusIcon, PlusIcon } from "@phosphor-icons/react"
import { useState } from "react"

// The number is a field as well as a pair of buttons, so 79 can be typed.
export function Stepper({
  value,
  onChange,
  min = 1,
  max,
  label,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  label: string
}) {
  // While someone is typing, show exactly what they typed (even an empty box).
  const [typing, setTyping] = useState<string | null>(null)
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n))
  const step =
    "grid size-8 place-items-center hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-8 items-center rounded-lg border border-input"
    >
      <button
        type="button"
        aria-label="Decrease"
        className={`${step} rounded-l-lg`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <MinusIcon />
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        className="w-14 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
        value={typing ?? String(value)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "")
          setTyping(digits)
          if (digits !== "") onChange(clamp(Number(digits)))
        }}
        onFocus={(event) => event.target.select()}
        onBlur={() => setTyping(null)}
      />
      <button
        type="button"
        aria-label="Increase"
        className={`${step} rounded-r-lg`}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        <PlusIcon />
      </button>
    </div>
  )
}
