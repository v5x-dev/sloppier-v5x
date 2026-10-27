import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

export type Selection = {
  start: number;
  end: number;
};

export type ChangeTextEventPayload = {
  text: string;
  eventCount: number;
};

export type FocusChangeEventPayload = {
  focused: boolean;
};

export type SelectionChangeEventPayload = Selection;

export type FontConfig = {
  /** PostScript names. Bold and italic faces are used by highlight spans. */
  family?: string;
  boldFamily?: string;
  italicFamily?: string;
  boldItalicFamily?: string;
  size?: number;
  /** Fixed line height in points. */
  lineHeight?: number;
};

export type GutterConfig = {
  fontFamily?: string;
  fontSize?: number;
  minimumWidth?: number;
  leadingInset?: number;
  trailingInset?: number;
};

export type EditorColors = {
  background?: ColorValue;
  foreground?: ColorValue;
  /** Caret and selection handles. */
  caret?: ColorValue;
  gutterBackground?: ColorValue;
  gutterText?: ColorValue;
  gutterCurrentLineText?: ColorValue;
  /** Highlights the caret's line when set. */
  currentLine?: ColorValue;
};

/**
 * A highlight over UTF-16 offsets of the text. `color` is #RRGGBB or
 * #RRGGBBAA. `fontStyle` bits: 1 italic, 2 bold.
 */
export type HighlightSpan = {
  start: number;
  length: number;
  color: string;
  fontStyle: number;
};

export type Theme = 'light' | 'dark' | 'auto';

export type Language =
  | 'plaintext'
  | 'markdown'
  | 'json'
  | 'javascript'
  | 'typescript'
  | 'html';

export type ContentInsets = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
};

export type SourceEditorViewProps = {
  text?: string;
  mostRecentEventCount?: number;
  editable?: boolean;
  font?: FontConfig;
  theme?: Theme;
  language?: Language;
  lineNumbers?: boolean;
  wrapLines?: boolean;
  gutter?: GutterConfig;
  colors?: EditorColors;
  highlights?: ReadonlyArray<HighlightSpan>;
  contentInsets?: ContentInsets;
  onChangeText?: (event: { nativeEvent: ChangeTextEventPayload }) => void;
  onSelectionChange?: (event: { nativeEvent: SelectionChangeEventPayload }) => void;
  onFocusChange?: (event: { nativeEvent: FocusChangeEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};

export type SourceEditorProps = {
  value?: string;
  defaultValue?: string;
  editable?: boolean;
  font?: FontConfig;
  theme?: Theme;
  language?: Language;
  lineNumbers?: boolean;
  /** Wrap long lines. Default false: lines scroll horizontally. */
  wrapLines?: boolean;
  gutter?: GutterConfig;
  colors?: EditorColors;
  /** Spans for the current `value`. Replaces the built-in highlighter. */
  highlights?: ReadonlyArray<HighlightSpan>;
  contentInsets?: ContentInsets;
  onChangeText?: (text: string) => void;
  onSelectionChange?: (selection: Selection) => void;
  onFocusChange?: (focused: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

export type SourceEditorRef = {
  focus: () => void;
  blur: () => void;
  getSelection: () => Selection;
  setSelection: (selection: Selection) => void;
};
