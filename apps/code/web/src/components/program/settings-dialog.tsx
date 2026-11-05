import { ActionTooltip } from "@/components/shared/action-tooltip"
import { resetSettings, updateSettings, useSettings } from "@/lib/settings"
import {
  getSoundEnabled,
  setSoundEnabled,
  subscribeSoundEnabled,
} from "@/lib/sound-preference"
import { GearSixIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react"
import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@v5x/ui/components/dialog"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import { Switch } from "@v5x/ui/components/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@v5x/ui/components/tabs"
import { unlock } from "cuelume"
import { useSyncExternalStore } from "react"

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y overflow-hidden rounded-lg border">{children}</div>
  )
}
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-2.5 py-1 sm:gap-4 sm:px-3">
      <span className="text-sm">{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
function NumberRow({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  onChange: (value: number) => void
}) {
  const name = label.toLowerCase()
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 py-1 sm:gap-x-4 sm:px-3">
      <span className="text-sm">{label}</span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border p-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Decrease ${name}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <MinusIcon />
        </Button>
        <span
          className="min-w-14 text-center text-sm tabular-nums"
          aria-live="polite"
        >
          {value}
          {unit && ` ${unit}`}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Increase ${name}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}
const tabClassName =
  "min-h-8 flex-none justify-start rounded-md px-2.5 text-xs sm:text-sm data-active:bg-muted dark:data-active:bg-muted"

export function SettingsDialog() {
  const settings = useSettings()
  const sound = useSyncExternalStore(
    subscribeSoundEnabled,
    getSoundEnabled,
    () => true
  )
  return (
    <Dialog>
      <ActionTooltip label="Settings">
        <DialogTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Settings" />
          }
        >
          <GearSixIcon />
        </DialogTrigger>
      </ActionTooltip>
      <DialogContent className="max-h-[85svh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Settings are saved on this device and changes apply immediately.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          defaultValue="editor"
          orientation="vertical"
          className="min-h-0 gap-3 sm:gap-4"
        >
          <TabsList
            className="w-24 shrink-0 items-stretch justify-start gap-0.5 bg-transparent p-0 sm:w-36"
            aria-label="Settings categories"
          >
            <TabsTrigger className={tabClassName} value="editor">
              Editor
            </TabsTrigger>
            <TabsTrigger className={tabClassName} value="editing">
              Editing
            </TabsTrigger>
            <TabsTrigger className={tabClassName} value="appearance">
              Appearance
            </TabsTrigger>
            <TabsTrigger className={tabClassName} value="brain">
              Brain
            </TabsTrigger>
          </TabsList>
          <ScrollArea className="h-[min(20rem,calc(85svh-11rem))] min-h-0 min-w-0 flex-1 pr-3">
            <TabsContent value="editor">
              <SettingsGroup>
                <NumberRow
                  label="Text size"
                  value={settings.fontSize}
                  min={11}
                  max={20}
                  unit="px"
                  onChange={(fontSize) => updateSettings({ fontSize })}
                />
                <NumberRow
                  label="Line spacing"
                  value={settings.lineSpacing}
                  min={4}
                  max={12}
                  unit="px"
                  onChange={(lineSpacing) => updateSettings({ lineSpacing })}
                />
                <ToggleRow
                  label="Minimap"
                  checked={settings.showMinimap}
                  onChange={(showMinimap) => updateSettings({ showMinimap })}
                />
                <ToggleRow
                  label="Line numbers"
                  checked={settings.lineNumbers}
                  onChange={(lineNumbers) => updateSettings({ lineNumbers })}
                />
                <ToggleRow
                  label="Word wrap"
                  checked={settings.wordWrap}
                  onChange={(wordWrap) => updateSettings({ wordWrap })}
                />
              </SettingsGroup>
            </TabsContent>
            <TabsContent value="editing">
              <SettingsGroup>
                <NumberRow
                  label="Tab display width"
                  value={settings.tabSize}
                  min={1}
                  max={8}
                  onChange={(tabSize) => updateSettings({ tabSize })}
                />
                <ToggleRow
                  label="Match brackets"
                  checked={settings.matchBrackets}
                  onChange={(matchBrackets) =>
                    updateSettings({ matchBrackets })
                  }
                />
                <ToggleRow
                  label="Rounded selections"
                  checked={settings.roundedSelection}
                  onChange={(roundedSelection) =>
                    updateSettings({ roundedSelection })
                  }
                />
                <ToggleRow
                  label="Surround selections"
                  checked={settings.autoSurround}
                  onChange={(autoSurround) => updateSettings({ autoSurround })}
                />
                <ToggleRow
                  label="Close brackets"
                  checked={settings.autoCloseBrackets}
                  onChange={(autoCloseBrackets) =>
                    updateSettings({ autoCloseBrackets })
                  }
                />
                <ToggleRow
                  label="Automatic completions"
                  checked={settings.autoComplete}
                  onChange={(autoComplete) => updateSettings({ autoComplete })}
                />
                <ToggleRow
                  label="Automatic signature help"
                  checked={settings.autoSignature}
                  onChange={(autoSignature) =>
                    updateSettings({ autoSignature })
                  }
                />
              </SettingsGroup>
            </TabsContent>
            <TabsContent value="appearance">
              <SettingsGroup>
                <ToggleRow
                  label="Surface texture"
                  checked={settings.texture}
                  onChange={(texture) => updateSettings({ texture })}
                />
                <ToggleRow
                  label="Reduce motion"
                  checked={settings.reduceMotion}
                  onChange={(reduceMotion) => updateSettings({ reduceMotion })}
                />
                <ToggleRow
                  label="Interface sounds"
                  checked={sound}
                  onChange={(enabled) => {
                    setSoundEnabled(enabled)
                    if (enabled) void unlock()
                  }}
                />
              </SettingsGroup>
            </TabsContent>
            <TabsContent value="brain">
              <SettingsGroup>
                <NumberRow
                  label="Default upload slot"
                  value={settings.uploadSlot}
                  min={1}
                  max={8}
                  onChange={(uploadSlot) => updateSettings({ uploadSlot })}
                />
                <ToggleRow
                  label="Run after upload"
                  checked={settings.runAfterUpload}
                  onChange={(runAfterUpload) =>
                    updateSettings({ runAfterUpload })
                  }
                />
              </SettingsGroup>
            </TabsContent>
          </ScrollArea>
        </Tabs>
        <DialogFooter>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              resetSettings()
              setSoundEnabled(true)
              void unlock()
            }}
          >
            Restore all defaults
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
