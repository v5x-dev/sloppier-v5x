import * as React from 'react';
import type { NativeSyntheticEvent } from 'react-native';

import SourceEditorNativeView, {
  Commands,
  type ChangeTextEvent,
  type FocusChangeEvent,
  type SelectionChangeEvent,
  type SourceEditorViewType,
} from './SourceEditorViewNativeComponent';
import type { SourceEditorViewProps } from './SourceEditor.types';

export type NativeSourceEditorRef = {
  focus: () => void;
  blur: () => void;
  setSelection: (start: number, end: number) => void;
};

const SourceEditorView = React.forwardRef<NativeSourceEditorRef, SourceEditorViewProps>(
  (props, ref) => {
    const nativeRef = React.useRef<React.ElementRef<SourceEditorViewType>>(null);

    React.useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (nativeRef.current) Commands.focus(nativeRef.current);
        },
        blur: () => {
          if (nativeRef.current) Commands.blur(nativeRef.current);
        },
        setSelection: (start: number, end: number) => {
          if (nativeRef.current)
            Commands.setSelection(nativeRef.current, start, end);
        },
      }),
      []
    );

    const { onChangeText, onSelectionChange, onFocusChange, ...rest } = props;

    return (
      <SourceEditorNativeView
        ref={nativeRef}
        {...rest}
        onChangeText={(event: NativeSyntheticEvent<ChangeTextEvent>) => {
          onChangeText?.(event);
        }}
        onSelectionChange={(event: NativeSyntheticEvent<SelectionChangeEvent>) => {
          onSelectionChange?.(event);
        }}
        onFocusChange={(event: NativeSyntheticEvent<FocusChangeEvent>) => {
          onFocusChange?.(event);
        }}
      />
    );
  }
);

SourceEditorView.displayName = 'SourceEditorView';

export default SourceEditorView;
