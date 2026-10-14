/**
 * @onethu/gui —— OneGUI 公开 API（唯一 import 面）
 *
 * 应用代码只允许：
 *   import { Btn, Card, Row, … } from "@onethu/gui";
 *   import "@onethu/gui/gui.css";
 * 别的一律违规（尤其：不要 import 到 src/ 深层路径）。
 */

/* ── 风格管线 ── */
export {
  og,
  installOneGUI,
  StyleDirector,
  SCOPE_TOKENS,
  resolveAxes,
} from "./pipeline/director.js";
export type {
  OGAxes, OGTheme, OGSkin, OGScheme, OGSchemePref, OGDensity, OGMotion, OGPlatform, OGScopeSpec, ScopeToken, StorageLike,
} from "./pipeline/director.js";
export { OneGUIProvider, Scope, useAxes, useOneGUI, useScheme, useScopeSpec } from "./pipeline/react.js";

/* ── 组件基类 ── */
export { OneStyle, one, cx, scopeProps } from "./components/kit.js";
export type { OneBase, OGSize, OGTone, OGEmphasis, OGLevel } from "./components/kit.js";

/* ── 组件 ── */
export {
  Page, PageHead, Toolbar, SettingsList, SettingsRow, Tabs, VerticalTabs, Segment, Banner, SectionCard,
  LoadingBlock, DataList, DataRow,
} from "./components/patterns.js";
export type {
  PageProps, PageHeadProps, PageWidth, ToolbarProps, SettingsListProps, SettingsRowProps,
  TabsProps, TabItem, VerticalTabsProps, SegmentProps, SegmentOption, BannerProps, SectionCardProps,
  LoadingBlockProps, DataListProps,
} from "./components/patterns.js";

export {
  Modal, Drawer, Menu, ContextMenu, ActionSheet, Tooltip, Popover,
} from "./components/overlay.js";
export type {
  ModalProps, DrawerProps, MenuProps, MenuItem, ContextMenuProps, ActionSheetProps, TooltipProps, PopoverProps,
} from "./components/overlay.js";

export { Stack, Inline, Spacer, Grow } from "./components/layout.js";
export type { StackProps, InlineProps, Gap, Align, Justify } from "./components/layout.js";

export { Text, Section, KeyValue } from "./components/text.js";
export type { TextProps, TextSlot, TextTone, TextWeight, SectionProps, KeyValueProps } from "./components/text.js";

export { Surface, Card, Grid, surfaceClass } from "./components/surface.js";
export type { SurfaceProps, CardProps, GridProps, SurfacePad, SurfaceRadius, GridMin } from "./components/surface.js";

export { Btn, IconBtn, Fab, BtnGroup } from "./components/button.js";
export type { BtnProps, IconBtnProps, FabProps, BtnGroupProps } from "./components/button.js";

export { List, Row, EmptyState, Divider } from "./components/list.js";
export type { ListProps, RowProps, RowSize, EmptyStateProps } from "./components/list.js";

export {
  Field, Input, TextArea, SearchField, NumberField, Select, Checkbox, Radio, RadioGroup, Switch, Slider, RangeSlider,
} from "./components/form.js";
export type {
  FieldProps, InputProps, TextAreaProps, SearchFieldProps, NumberFieldProps, SelectProps, SelectOption,
  CheckboxProps, RadioProps, RadioGroupProps, SwitchProps, SliderProps, RangeSliderProps,
} from "./components/form.js";

export * from "./components/icons.js";
export { Icon, Chip, Tag, Badge } from "./components/chip.js";
export type { IconProps, IconSize, ChipProps, BadgeProps } from "./components/chip.js";
