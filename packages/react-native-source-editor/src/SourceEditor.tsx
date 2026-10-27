import * as React from 'react';
import { processColor } from 'react-native';

import SourceEditorView, { NativeSourceEditorRef } from './SourceEditorView';
import {
  Selection,
  SourceEditorProps,
  SourceEditorRef,
} from './SourceEditor.types';

const SourceEditor = React.forwardRef<SourceEditorRef, SourceEditorProps>(
  (
    {
      value,
      defaultValue,
      editable = true,
      font,
      theme = 'auto',
      language = 'plaintext',
      lineNumbers = false,
      wrapLines = false,
      gutter,
      colors,
      highlights,
      contentInsets,
      onChangeText,
      onSelectionChange,
      onFocusChange,
      style,
    },
    ref
  ) => {
    const isControlled = value !== undefined;
    const [uncontrolledText, setUncontrolledText] = React.useState(
      defaultValue ?? ''
    );
    // Latest native edit count. Sent back with `text` so native can drop a
    // render that was computed before the user's most recent keystroke.
    const [eventCount, setEventCount] = React.useState(0);
    const selectionRef = React.useRef<Selection>({ start: 0, end: 0 });
    const nativeRef = React.useRef<NativeSourceEditorRef>(null);

    const text = isControlled ? value : uncontrolledText;

    // React Native only converts top-level color props. Colors nested in an
    // object reach native as raw strings, which native reads as transparent,
    // so convert each one here.
    const nativeColors = React.useMemo(() => {
      if (!colors) return undefined;
      const processed: Record<string, unknown> = {};
      for (const [key, color] of Object.entries(colors)) {
        if (color != null) processed[key] = processColor(color);
      }
      return processed as typeof colors;
    }, [colors]);

    React.useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          nativeRef.current?.focus();
        },
        blur: () => {
          nativeRef.current?.blur();
        },
        getSelection: () => selectionRef.current,
        setSelection: ({ start, end }) => {
          nativeRef.current?.setSelection(start, end);
        },
      }),
      []
    );

    return (
      <SourceEditorView
        ref={nativeRef}
        text={text}
        mostRecentEventCount={eventCount}
        editable={editable}
        font={font}
        theme={theme}
        language={language}
        lineNumbers={lineNumbers}
        wrapLines={wrapLines}
        gutter={gutter}
        colors={nativeColors}
        highlights={highlights}
        contentInsets={contentInsets}
        style={style}
        onChangeText={(event) => {
          const next = event.nativeEvent.text;
          setEventCount(event.nativeEvent.eventCount);
          if (!isControlled) {
            setUncontrolledText(next);
          }
          onChangeText?.(next);
        }}
        onSelectionChange={(event) => {
          selectionRef.current = {
            start: event.nativeEvent.start,
            end: event.nativeEvent.end,
          };
          onSelectionChange?.(selectionRef.current);
        }}
        onFocusChange={(event) => {
          onFocusChange?.(event.nativeEvent.focused);
        }}
      />
    );
  }
);

export default SourceEditor;
