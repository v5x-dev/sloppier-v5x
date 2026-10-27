import Foundation

#if os(iOS)
import STTextView
import UIKit

/// Reports first-responder changes, which STTextView has no delegate hook for.
private final class FocusReportingTextView: STTextView {
  var onFocusChange: ((Bool) -> Void)?

  override func becomeFirstResponder() -> Bool {
    let became = super.becomeFirstResponder()
    if became { onFocusChange?(true) }
    return became
  }

  override func resignFirstResponder() -> Bool {
    let resigned = super.resignFirstResponder()
    if resigned { onFocusChange?(false) }
    return resigned
  }
}

@objc(RNSESourceEditorImpl)
public class SourceEditorImpl: UIView {
  private let textView = FocusReportingTextView()
  private var textDelegate: TextDelegate?
  private var currentLanguage: HighlightLanguage = .plaintext
  private var isReHighlighting = false
  private var reHighlightScheduled = false

  // Fonts for highlight spans (fontStyle bit 1 italic, bit 2 bold).
  private var regularFont = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
  private var boldFont: UIFont?
  private var italicFont: UIFont?
  private var boldItalicFont: UIFont?
  private var lineHeight: CGFloat = 0
  private var foregroundColor: UIColor = .label
  private var gutterTextColor: UIColor?
  private var gutterCurrentLineTextColor: UIColor?
  private var gutterBackgroundColor: UIColor?
  private var gutterFont: UIFont?
  private var gutterMinimumWidth: CGFloat?
  private var gutterInsets: (leading: CGFloat, trailing: CGFloat)?

  /// Spans supplied by JS. When nil, the built-in regex highlighter runs.
  private var highlights: [[String: Any]]?
  /// Incremented on every user edit; JS echoes it back so stale props lose.
  private var eventCount: Int = 0
  /// Set while applying props, so programmatic edits are not echoed to JS.
  private var applyingProps = false

  @objc public var onChange: ((String, Int) -> Void)?
  @objc public var onSelection: ((Int, Int) -> Void)?
  @objc public var onFocus: ((Bool) -> Void)?

  override public init(frame: CGRect) {
    super.init(frame: frame)
    setupTextView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupTextView()
  }

  private func setupTextView() {
    clipsToBounds = true

    textView.isScrollEnabled = true
    textView.alwaysBounceVertical = true
    textView.contentInsetAdjustmentBehavior = .never
    textView.isHorizontallyResizable = true

    // Source code: no autocorrect, capitalization or smart punctuation.
    textView.autocorrectionType = .no
    textView.autocapitalizationType = .none
    textView.smartQuotesType = .no
    textView.smartDashesType = .no
    textView.smartInsertDeleteType = .no
    textView.spellCheckingType = .no

    textView.onFocusChange = { [weak self] focused in self?.onFocus?(focused) }

    let delegate = TextDelegate(
      onChange: { [weak self] text in
        guard let self = self, !self.applyingProps else { return }
        self.updateGutterWidth(force: false)
        self.eventCount += 1
        self.onChange?(text, self.eventCount)
      },
      onSelection: { [weak self] range in
        guard let self = self, !self.applyingProps else { return }
        self.onSelection?(range.location, range.location + range.length)
      },
      onTextChanged: { [weak self] in
        guard let self = self, !self.applyingProps else { return }
        // JS-supplied spans now describe stale text; repaint when new ones
        // arrive. The regex highlighter can run straight away.
        if self.highlights == nil { self.scheduleReHighlight() }
      }
    )
    textDelegate = delegate
    textView.textDelegate = delegate
    addSubview(textView)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
  }

  /// Applies `value` unless it predates the latest user edit. Changes are
  /// applied as one minimal replacement so the caret and scroll stay put.
  @objc public func setText(_ value: String, eventCount: Int) -> Bool {
    if eventCount < self.eventCount { return false }
    let current = textView.text ?? ""
    if current == value { return true }

    applyingProps = true
    defer { applyingProps = false }

    let old = current as NSString
    let new = value as NSString
    if old.length == 0 {
      textView.text = value
      updateGutterWidth(force: false)
      return true
    }
    var start = 0
    let limit = min(old.length, new.length)
    while start < limit && old.character(at: start) == new.character(at: start) { start += 1 }
    var oldEnd = old.length
    var newEnd = new.length
    while oldEnd > start && newEnd > start &&
      old.character(at: oldEnd - 1) == new.character(at: newEnd - 1) {
      oldEnd -= 1
      newEnd -= 1
    }
    // Never split a surrogate pair.
    if start > 0 && CFStringIsSurrogateHighCharacter(old.character(at: start - 1)) { start -= 1 }
    if oldEnd < old.length && newEnd < new.length &&
      CFStringIsSurrogateLowCharacter(old.character(at: oldEnd)) {
      oldEnd += 1
      newEnd += 1
    }

    let selection = textView.textSelection
    let delta = (newEnd - start) - (oldEnd - start)
    func map(_ position: Int) -> Int {
      if position <= start { return position }
      if position >= oldEnd { return position + delta }
      return start
    }
    textView.replaceCharacters(
      in: NSRange(location: start, length: oldEnd - start),
      with: new.substring(with: NSRange(location: start, length: newEnd - start))
    )
    updateGutterWidth(force: false)
    if selection.location != NSNotFound {
      let mappedStart = map(selection.location)
      let mappedEnd = map(selection.location + selection.length)
      textView.textSelection = NSRange(location: mappedStart, length: max(0, mappedEnd - mappedStart))
    }
    return true
  }

  @objc public func setEditable(_ value: Bool) {
    textView.isEditable = value
  }

  @objc public func focusEditor() { _ = textView.becomeFirstResponder() }

  @objc public func blurEditor() { _ = textView.resignFirstResponder() }

  @objc public func setSelection(start: Int, end: Int) {
    let length = (textView.text ?? "").utf16.count
    let clampedStart = max(0, min(start, length))
    let clampedEnd = max(clampedStart, min(end, length))
    applyingProps = true
    textView.textSelection = NSRange(location: clampedStart, length: clampedEnd - clampedStart)
    applyingProps = false
    onSelection?(clampedStart, clampedEnd)
  }

  private func resolveFont(_ name: String?, size: CGFloat) -> UIFont? {
    guard let name = name, !name.isEmpty else { return nil }
    return UIFont(name: name, size: size)
  }

  @objc public func setFont(
    family: String?,
    boldFamily: String?,
    italicFamily: String?,
    boldItalicFamily: String?,
    size: Double,
    lineHeight: Double
  ) {
    let resolvedSize = CGFloat(size > 0 ? size : 14)
    regularFont = resolveFont(family, size: resolvedSize)
      ?? .monospacedSystemFont(ofSize: resolvedSize, weight: .regular)
    boldFont = resolveFont(boldFamily, size: resolvedSize)
    italicFont = resolveFont(italicFamily, size: resolvedSize)
    boldItalicFont = resolveFont(boldItalicFamily, size: resolvedSize)
    self.lineHeight = CGFloat(lineHeight)
    textView.font = regularFont
    if lineHeight > 0 {
      let paragraph = NSMutableParagraphStyle()
      paragraph.minimumLineHeight = CGFloat(lineHeight)
      paragraph.maximumLineHeight = CGFloat(lineHeight)
      textView.defaultParagraphStyle = paragraph
    }
    repaint()
  }

  @objc public func setTheme(_ theme: String) {
    switch theme {
    case "light":
      overrideUserInterfaceStyle = .light
    case "dark":
      overrideUserInterfaceStyle = .dark
    default:
      overrideUserInterfaceStyle = .unspecified
    }
  }

  @objc public func setColors(
    background: UIColor?,
    foreground: UIColor?,
    caret: UIColor?,
    gutterBackground: UIColor?,
    gutterText: UIColor?,
    gutterCurrentLineText: UIColor?,
    currentLine: UIColor?
  ) {
    let background = background ?? .systemBackground
    backgroundColor = background
    textView.backgroundColor = background
    foregroundColor = foreground ?? .label
    textView.textColor = foregroundColor
    // The caret and selection handles follow the view's tint.
    textView.tintColor = caret ?? .tintColor
    if let currentLine = currentLine {
      textView.highlightSelectedLine = true
      textView.selectedLineHighlightColor = currentLine
    } else {
      textView.highlightSelectedLine = false
    }
    gutterBackgroundColor = gutterBackground ?? background
    gutterTextColor = gutterText
    gutterCurrentLineTextColor = gutterCurrentLineText
    styleGutter()
    repaint()
  }

  @objc public func setGutter(
    fontFamily: String?,
    fontSize: Double,
    minimumWidth: Double,
    leadingInset: Double,
    trailingInset: Double
  ) {
    let size = CGFloat(fontSize > 0 ? fontSize : 11)
    gutterFont = resolveFont(fontFamily, size: size)
      ?? .monospacedDigitSystemFont(ofSize: size, weight: .regular)
    gutterMinimumWidth = minimumWidth > 0 ? CGFloat(minimumWidth) : nil
    gutterInsets = (CGFloat(leadingInset), CGFloat(trailingInset))
    styleGutter()
  }

  private func styleGutter() {
    guard let gutter = textView.gutterView else { return }
    gutter.backgroundColor = gutterBackgroundColor
    gutter.drawSeparator = false
    if let color = gutterTextColor { gutter.textColor = color }
    gutter.selectedLineTextColor = gutterCurrentLineTextColor
    if let font = gutterFont { gutter.font = font }
    if let insets = gutterInsets {
      gutter.insets = STRulerInsets(leading: insets.leading, trailing: insets.trailing)
    }
    updateGutterWidth()
  }

  private var gutterDigits = 0

  /// STTextView offsets the text by the gutter's width at layout time, then
  /// widens the gutter to fit the numbers without re-offsetting the text, so
  /// the gutter overlaps the first column. Size it up front instead.
  private func updateGutterWidth(force: Bool = true) {
    guard let gutter = textView.gutterView else { return }
    let text = (textView.text ?? "") as NSString
    var lines = 1
    var searchRange = NSRange(location: 0, length: text.length)
    while true {
      let found = text.range(of: "\n", options: [], range: searchRange)
      if found.location == NSNotFound { break }
      lines += 1
      searchRange = NSRange(location: found.location + 1, length: text.length - found.location - 1)
    }
    let digits = max(2, String(lines).count)
    if !force && digits == gutterDigits { return }
    gutterDigits = digits
    let digitWidth = ("0" as NSString).size(withAttributes: [.font: gutter.font]).width
    let width = ceil(gutter.insets.horizontal + digitWidth * CGFloat(digits)) + 2
    let thickness = max(gutterMinimumWidth ?? 0, width)
    gutter.minimumThickness = thickness
    gutter.frame.size.width = thickness
    gutter.setNeedsLayout()
    textView.setNeedsLayout()
  }

  @objc public func setContentInsets(top: Double, bottom: Double, left: Double, right: Double) {
    textView.textContainerInset = UIEdgeInsets(
      top: CGFloat(top),
      left: CGFloat(left),
      bottom: CGFloat(bottom),
      right: CGFloat(right)
    )
  }

  @objc public func setLanguage(_ value: String) {
    currentLanguage = HighlightLanguage(rawValue: value) ?? .plaintext
    if highlights == nil { scheduleReHighlight() }
  }

  @objc public func setLineNumbers(_ value: Bool) {
    textView.showsLineNumbers = value
    styleGutter()
  }

  @objc public func setWrapLines(_ value: Bool) {
    textView.isHorizontallyResizable = !value
  }

  /// Spans are UTF-16 ranges into the current text. Out-of-range spans are
  /// skipped rather than trusted.
  @objc public func setHighlights(_ spans: [[String: Any]]?) {
    highlights = spans
    repaint()
  }

  private func repaint() {
    if highlights != nil { applyHighlights() } else { scheduleReHighlight() }
  }

  private func font(forStyle style: Int) -> UIFont {
    switch style & 3 {
    case 1: return italicFont ?? regularFont
    case 2: return boldFont ?? regularFont
    case 3: return boldItalicFont ?? boldFont ?? italicFont ?? regularFont
    default: return regularFont
    }
  }

  private func applyHighlights() {
    guard let spans = highlights,
          let storage = (textView.textContentManager as? NSTextContentStorage)?.textStorage
    else { return }
    let length = storage.length
    guard length > 0 else { return }
    var base: [NSAttributedString.Key: Any] = [.font: regularFont, .foregroundColor: foregroundColor]
    base[.paragraphStyle] = textView.defaultParagraphStyle
    textView.textContentManager.performEditingTransaction {
      storage.setAttributes(base, range: NSRange(location: 0, length: length))
      for span in spans {
        guard let start = span["start"] as? Int,
              let spanLength = span["length"] as? Int,
              start >= 0, spanLength > 0, start + spanLength <= length
        else { continue }
        var attributes: [NSAttributedString.Key: Any] = [:]
        if let hex = span["color"] as? String, let color = UIColor(hex: hex) {
          attributes[.foregroundColor] = color
        }
        let style = span["fontStyle"] as? Int ?? 0
        if style != 0 { attributes[.font] = font(forStyle: style) }
        if !attributes.isEmpty {
          storage.addAttributes(attributes, range: NSRange(location: start, length: spanLength))
        }
      }
    }
    textView.setNeedsLayout()
  }

  private func scheduleReHighlight() {
    if isReHighlighting || reHighlightScheduled { return }
    reHighlightScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.reHighlightScheduled = false
      self.performReHighlight()
    }
  }

  private func performReHighlight() {
    guard !isReHighlighting, highlights == nil else { return }
    isReHighlighting = true
    defer { isReHighlighting = false }

    let text = textView.text ?? ""
    let attrString = NSMutableAttributedString(string: text)
    Highlighter(language: currentLanguage, theme: .system, baseFont: textView.font).apply(to: attrString)

    applyingProps = true
    let savedSelection = textView.textSelection
    textView.attributedText = attrString
    textView.textSelection = savedSelection
    applyingProps = false
  }
}

private extension UIColor {
  /// Parses #RGB, #RRGGBB or #RRGGBBAA.
  convenience init?(hex: String) {
    var value = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    if value.count == 3 { value = value.map { "\($0)\($0)" }.joined() }
    if value.count == 6 { value += "FF" }
    guard value.count == 8, let rgba = UInt64(value, radix: 16) else { return nil }
    self.init(
      red: CGFloat((rgba >> 24) & 0xFF) / 255,
      green: CGFloat((rgba >> 16) & 0xFF) / 255,
      blue: CGFloat((rgba >> 8) & 0xFF) / 255,
      alpha: CGFloat(rgba & 0xFF) / 255
    )
  }
}

private class TextDelegate: NSObject, STTextViewDelegate {
  let onChange: (String) -> Void
  let onSelection: (NSRange) -> Void
  let onTextChanged: () -> Void

  init(
    onChange: @escaping (String) -> Void,
    onSelection: @escaping (NSRange) -> Void,
    onTextChanged: @escaping () -> Void
  ) {
    self.onChange = onChange
    self.onSelection = onSelection
    self.onTextChanged = onTextChanged
  }

  func textViewDidChangeText(_ notification: Notification) {
    guard let textView = notification.object as? STTextView else { return }
    onChange(textView.text ?? "")
    onTextChanged()
  }

  func textViewDidChangeSelection(_ notification: Notification) {
    guard let textView = notification.object as? STTextView else { return }
    onSelection(textView.textSelection)
  }
}

#elseif os(macOS)
import STTextView
import AppKit

@objc(RNSESourceEditorImpl)
public class SourceEditorImpl: NSView {
  let scrollView = NSScrollView()
  let textView = STTextView()
  private var textDelegate: TextDelegate?
  private var currentLanguage: HighlightLanguage = .plaintext
  private var isReHighlighting = false
  private var reHighlightScheduled = false

  @objc public var onChange: ((String) -> Void)?
  @objc public var onSelection: ((Int, Int) -> Void)?

  override public init(frame: CGRect) {
    super.init(frame: frame)
    setupTextView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupTextView()
  }

  private func setupTextView() {
    wantsLayer = true
    layer?.masksToBounds = true

    let delegate = TextDelegate(
      onChange: { [weak self] text in self?.onChange?(text) },
      onSelection: { [weak self] range in
        self?.onSelection?(range.location, range.location + range.length)
      },
      onTextChanged: { [weak self] in self?.scheduleReHighlight() }
    )
    textDelegate = delegate
    textView.delegate = delegate

    scrollView.documentView = textView
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = true
    addSubview(scrollView)
  }

  public override func layout() {
    super.layout()
    scrollView.frame = bounds
  }

  @objc public func setText(_ value: String) {
    if textView.text != value {
      textView.text = value
    }
    scheduleReHighlight()
  }

  @objc public func setEditable(_ value: Bool) {
    textView.isEditable = value
  }

  @objc public func focusEditor() { window?.makeFirstResponder(textView) }

  @objc public func blurEditor() {
    if window?.firstResponder === textView {
      window?.makeFirstResponder(nil)
    }
  }

  @objc public func setFont(family: String?, size: Double) {
    let resolvedSize = CGFloat(size > 0 ? size : 14)
    if let family = family, !family.isEmpty,
       let custom = NSFont(name: family, size: resolvedSize) {
      textView.font = custom
    } else {
      textView.font = .monospacedSystemFont(ofSize: resolvedSize, weight: .regular)
    }
    scheduleReHighlight()
  }

  @objc public func setTheme(_ theme: String) {
    switch theme {
    case "light":
      appearance = NSAppearance(named: .aqua)
    case "dark":
      appearance = NSAppearance(named: .darkAqua)
    default:
      appearance = nil
    }
    textView.backgroundColor = .textBackgroundColor
    textView.textColor = .textColor
  }

  @objc public func setContentInsets(top: Double, bottom: Double, left: Double, right: Double) {
    scrollView.contentInsets = NSEdgeInsets(
      top: CGFloat(top),
      left: CGFloat(left),
      bottom: CGFloat(bottom),
      right: CGFloat(right)
    )
  }

  @objc public func setLanguage(_ value: String) {
    currentLanguage = HighlightLanguage(rawValue: value) ?? .plaintext
    scheduleReHighlight()
  }

  @objc public func setLineNumbers(_ value: Bool) {
    // STTextView (UIKit + AppKit) exposes the same `showsLineNumbers`
    // property; toggling at runtime adds/removes the gutter view in
    // place — no remount required.
    textView.showsLineNumbers = value
  }

  private func scheduleReHighlight() {
    if isReHighlighting || reHighlightScheduled { return }
    reHighlightScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.reHighlightScheduled = false
      self.performReHighlight()
    }
  }

  private func performReHighlight() {
    guard !isReHighlighting else { return }
    isReHighlighting = true
    defer { isReHighlighting = false }

    let text = textView.text ?? ""
    let attrString = NSMutableAttributedString(string: text)
    Highlighter(language: currentLanguage, theme: .system, baseFont: textView.font).apply(to: attrString)

    let savedSelection = textView.textSelection
    textView.attributedText = attrString
    textView.textSelection = savedSelection
  }
}

private class TextDelegate: NSObject, STTextViewDelegate {
  let onChange: (String) -> Void
  let onSelection: (NSRange) -> Void
  let onTextChanged: () -> Void

  init(
    onChange: @escaping (String) -> Void,
    onSelection: @escaping (NSRange) -> Void,
    onTextChanged: @escaping () -> Void
  ) {
    self.onChange = onChange
    self.onSelection = onSelection
    self.onTextChanged = onTextChanged
  }

  func textViewDidChangeText(_ notification: Notification) {
    guard let textView = notification.object as? STTextView else { return }
    onChange(textView.text ?? "")
    onTextChanged()
  }

  func textViewDidChangeSelection(_ notification: Notification) {
    guard let textView = notification.object as? STTextView else { return }
    onSelection(textView.textSelection)
  }
}
#endif
