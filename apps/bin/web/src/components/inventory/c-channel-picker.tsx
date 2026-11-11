import {
  cChannelLengths,
  cChannelMaterials,
  cChannelWidths,
  decodeCChannel,
  defaultCChannel,
  encodeCChannel,
  type CChannelMaterial,
  type CChannelOptions,
} from "@v5x/backend/cChannel"
import { Label } from "@v5x/ui/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@v5x/ui/components/native-select"

const materialNames: Record<CChannelMaterial, string> = {
  steel: "Steel",
  aluminum: "Aluminum",
}

// Material, width, and length for a C-Channel. Changing one keeps the others.
export function CChannelPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (variant: string) => void
}) {
  const options = decodeCChannel(value) ?? defaultCChannel

  function change(next: Partial<CChannelOptions>) {
    onChange(encodeCChannel({ ...options, ...next }))
  }

  return (
    <div className="flex items-end gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="c-channel-material">Material</Label>
        <NativeSelect
          id="c-channel-material"
          value={options.material}
          onChange={(e) =>
            change({ material: e.target.value as CChannelMaterial })
          }
        >
          {cChannelMaterials.map((material) => (
            <NativeSelectOption key={material} value={material}>
              {materialNames[material]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="c-channel-width">Width</Label>
        <NativeSelect
          id="c-channel-width"
          value={options.width}
          onChange={(e) =>
            change({
              width: Number(e.target.value) as CChannelOptions["width"],
            })
          }
        >
          {cChannelWidths.map((width) => (
            <NativeSelectOption key={width} value={width}>
              {width}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="c-channel-length">Length</Label>
        <NativeSelect
          id="c-channel-length"
          value={options.length}
          onChange={(e) => change({ length: Number(e.target.value) })}
        >
          {cChannelLengths.map((length) => (
            <NativeSelectOption key={length} value={length}>
              {length}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  )
}
