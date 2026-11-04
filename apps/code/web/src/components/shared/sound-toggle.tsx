import { useSyncExternalStore } from "react"
import { SpeakerHighIcon, SpeakerSlashIcon } from "@phosphor-icons/react"
import { unlock } from "cuelume"
import { Button } from "@v5x/ui/components/button"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import {
  getSoundEnabled,
  setSoundEnabled,
  subscribeSoundEnabled,
} from "@/lib/sound-preference"

export function SoundToggle() {
  const enabled = useSyncExternalStore(
    subscribeSoundEnabled,
    getSoundEnabled,
    () => true
  )
  const label = enabled ? "Mute sounds" : "Unmute sounds"
  return (
    <ActionTooltip label={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        data-cuelume-toggle
        onClick={() => {
          setSoundEnabled(!enabled)
          // Start audio inside this click so cues work after unmuting.
          if (!enabled) void unlock()
        }}
      >
        {enabled ? <SpeakerHighIcon /> : <SpeakerSlashIcon />}
      </Button>
    </ActionTooltip>
  )
}
