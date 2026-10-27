import {
  codegenNativeComponent,
  codegenNativeCommands,
  type CodegenTypes,
  type ColorValue,
  type HostComponent,
  type ViewProps,
} from 'react-native';

export type ChangeTextEvent = Readonly<{
  text: string;
  // Incremented by native on every user edit. Echo it back through
  // `mostRecentEventCount` so stale `text` props are not applied.
  eventCount: CodegenTypes.Int32;
}>;

export type SelectionChangeEvent = Readonly<{
  start: CodegenTypes.Double;
  end: CodegenTypes.Double;
}>;

export type FocusChangeEvent = Readonly<{
  focused: boolean;
}>;

type FontConfig = Readonly<{
  family?: string;
  boldFamily?: string;
  italicFamily?: string;
  boldItalicFamily?: string;
  size?: CodegenTypes.Double;
  lineHeight?: CodegenTypes.Double;
}>;

type GutterConfig = Readonly<{
  fontFamily?: string;
  fontSize?: CodegenTypes.Double;
  minimumWidth?: CodegenTypes.Double;
  leadingInset?: CodegenTypes.Double;
  trailingInset?: CodegenTypes.Double;
}>;

type EditorColors = Readonly<{
  background?: ColorValue;
  foreground?: ColorValue;
  caret?: ColorValue;
  gutterBackground?: ColorValue;
  gutterText?: ColorValue;
  gutterCurrentLineText?: ColorValue;
  currentLine?: ColorValue;
}>;

// Highlight spans over UTF-16 offsets of `text`. `color` is a #RRGGBB or
// #RRGGBBAA string. `fontStyle` bits: 1 italic, 2 bold.
type HighlightSpan = Readonly<{
  start: CodegenTypes.Int32;
  length: CodegenTypes.Int32;
  color: string;
  fontStyle: CodegenTypes.Int32;
}>;

type ContentInsets = Readonly<{
  top?: CodegenTypes.Double;
  bottom?: CodegenTypes.Double;
  left?: CodegenTypes.Double;
  right?: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  text?: string;
  mostRecentEventCount?: CodegenTypes.Int32;
  editable?: boolean;
  font?: FontConfig;
  theme?: string;
  language?: string;
  lineNumbers?: boolean;
  wrapLines?: boolean;
  gutter?: GutterConfig;
  colors?: EditorColors;
  highlights?: ReadonlyArray<HighlightSpan>;
  contentInsets?: ContentInsets;

  onChangeText?: CodegenTypes.DirectEventHandler<ChangeTextEvent>;
  onSelectionChange?: CodegenTypes.DirectEventHandler<SelectionChangeEvent>;
  onFocusChange?: CodegenTypes.DirectEventHandler<FocusChangeEvent>;
}

export type SourceEditorViewType = HostComponent<NativeProps>;

interface NativeCommands {
  focus: (viewRef: React.ElementRef<SourceEditorViewType>) => void;
  blur: (viewRef: React.ElementRef<SourceEditorViewType>) => void;
  setSelection: (
    viewRef: React.ElementRef<SourceEditorViewType>,
    start: CodegenTypes.Int32,
    end: CodegenTypes.Int32
  ) => void;
}

export const Commands: NativeCommands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['focus', 'blur', 'setSelection'],
});

export default codegenNativeComponent<NativeProps>(
  'SourceEditor'
) as SourceEditorViewType;
