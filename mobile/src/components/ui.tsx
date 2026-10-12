import { type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Polyline } from "react-native-svg";
import { useTheme, type Theme } from "../lib/theme";
import { useToasts } from "../lib/ui";
import { baseAsset, fmtPct } from "../lib/format";

export function T({ children, style, v = "body", color, numberOfLines, mono, onPress }: {
  children: ReactNode; style?: StyleProp<TextStyle>; v?: "h1" | "h2" | "h3" | "body" | "small" | "tiny" | "big"; color?: string; numberOfLines?: number; mono?: boolean; onPress?: () => void;
}) {
  const t = useTheme();
  const sizes = { big: [26, "700"], h1: [20, "700"], h2: [16, "700"], h3: [14, "600"], body: [14, "400"], small: [12.5, "400"], tiny: [11, "400"] } as const;
  const [fontSize, fontWeight] = sizes[v];
  return (
    <RNText numberOfLines={numberOfLines} onPress={onPress} suppressHighlighting style={[{ color: color ?? t.text, fontSize, fontWeight, fontVariant: ["tabular-nums"] }, mono && { fontFamily: "Courier" }, style]}>
      {children}
    </RNText>
  );
}

export function Screen({ children, scroll = true, refreshing, onRefresh, pad = true }: {
  children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; pad?: boolean;
}) {
  const t = useTheme();
  const style = { padding: pad ? 16 : 0, gap: 14, paddingBottom: 32 };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: t.bg }, style]}>{children}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={style} keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.primary} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, title, right, style, pad = true }: { children: ReactNode; title?: string; right?: ReactNode; style?: StyleProp<ViewStyle>; pad?: boolean }) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.surface, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: pad ? 14 : 0 }, style]}>
      {(title || right) && (
        <Row style={{ justifyContent: "space-between", marginBottom: 10, paddingHorizontal: pad ? 0 : 14, paddingTop: pad ? 0 : 14 }}>
          {title ? <T v="h3">{title}</T> : <View />}{right}
        </Row>
      )}
      {children}
    </View>
  );
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Btn({ title, onPress, kind = "default", disabled, loading, style, small, icon }: {
  title: string; onPress?: () => void; kind?: "default" | "primary" | "buy" | "sell" | "ghost" | "danger"; disabled?: boolean; loading?: boolean;
  style?: StyleProp<ViewStyle>; small?: boolean; icon?: ReactNode;
}) {
  const t = useTheme();
  const bg = { default: t.surface, primary: t.primary, buy: t.up, sell: t.down, ghost: "transparent", danger: t.surface }[kind];
  const fg = { default: t.text, primary: "#fff", buy: "#fff", sell: "#fff", ghost: t.primary, danger: t.down }[kind];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [{
        height: small ? 32 : 46, paddingHorizontal: small ? 12 : 16, borderRadius: 10, backgroundColor: bg, alignItems: "center", justifyContent: "center",
        flexDirection: "row", gap: 6, borderWidth: kind === "default" || kind === "danger" ? StyleSheet.hairlineWidth : 0, borderColor: t.border,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <>{icon}<T v={small ? "small" : "h3"} color={fg} style={{ fontWeight: "700" }}>{title}</T></>}
    </Pressable>
  );
}

export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: "up" | "down" | "blue" | "warn" }) {
  const t = useTheme();
  const map = { up: [t.upSoft, t.up], down: [t.downSoft, t.down], blue: [t.primarySoft, t.primary], warn: [t.warnSoft, t.warn] };
  const [bg, fg] = active ? [t.primarySoft, t.primary] : color ? map[color] : [t.surface3, t.text2];
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: bg, justifyContent: "center", borderWidth: active ? 1 : 0, borderColor: t.primary }}>
      <T v="tiny" color={fg} style={{ fontWeight: "600" }}>{label}</T>
    </Pressable>
  );
}

export function Seg<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  const t = useTheme();
  return (
    <Row gap={2} style={{ backgroundColor: t.surface2, borderRadius: 9, padding: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={{ flexGrow: 1, paddingHorizontal: 10, height: 28, borderRadius: 7, justifyContent: "center", alignItems: "center", backgroundColor: o.value === value ? t.primarySoft : "transparent" }}>
          <T v="small" color={o.value === value ? t.primary : t.muted} style={{ fontWeight: "600" }}>{o.label}</T>
        </Pressable>
      ))}
    </Row>
  );
}

export function Input(props: TextInputProps & { suffix?: string; label?: string }) {
  const t = useTheme();
  const { suffix, label, style, ...rest } = props;
  return (
    <View style={{ gap: 5 }}>
      {label && <T v="small" color={t.muted}>{label}</T>}
      <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: t.border, borderRadius: 10, backgroundColor: t.surface, paddingHorizontal: 12, height: 44 }}>
        <TextInput placeholderTextColor={t.faint} style={[{ flex: 1, color: t.text, fontSize: 15 }, style]} {...rest} />
        {suffix && <T v="small" color={t.text2} style={{ fontWeight: "600" }}>{suffix}</T>}
      </View>
    </View>
  );
}

const ICON_COLORS: Record<string, string> = { BTC: "#f7931a", ETH: "#627eea", SOL: "#14b88a", AAPL: "#111", TSLA: "#e31937", XAU: "#d4a017", MSFT: "#00a4ef", NVDA: "#76b900", AMZN: "#ff9900", GOOGL: "#4285f4" };
export function SymbolIcon({ symbol, display, size = 30 }: { symbol: string; display?: string; size?: number }) {
  const b = baseAsset(display || symbol);
  const color = ICON_COLORS[b] || `hsl(${[...symbol].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 55%, 45%)`;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <T style={{ fontSize: size * 0.32, fontWeight: "800" }} color="#fff">{b.replace(/[^A-Z0-9]/gi, "").slice(0, 4)}</T>
    </View>
  );
}

export function Change({ v, v2 }: { v?: number | null; v2?: "small" | "body" | "tiny" }) {
  const t = useTheme();
  return <T v={v2 ?? "small"} color={v == null ? t.muted : v >= 0 ? t.up : t.down} style={{ fontWeight: "600" }}>{fmtPct(v)}</T>;
}

export function Sparkline({ data, width = 70, height = 26, color }: { data: number[]; width?: number; height?: number; color?: string }) {
  const t = useTheme();
  if (!data || data.length < 2) return <View style={{ width, height }} />;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`).join(" ");
  return <Svg width={width} height={height}><Polyline points={pts} fill="none" stroke={color ?? (data[data.length - 1] >= data[0] ? t.up : t.down)} strokeWidth={1.6} /></Svg>;
}

export const PALETTE = ["#2563eb", "#7c3aed", "#f59e0b", "#14b8a6", "#ef4444", "#64748b", "#ec4899"];
export function Donut({ items, size = 110, thickness = 14 }: { items: { label: string; value: number }[]; size?: number; thickness?: number }) {
  const t = useTheme();
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0) || 1;
  const r = (size - thickness) / 2, C = 2 * Math.PI * r;
  let off = 0;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.surface3} strokeWidth={thickness} fill="none" />
      {items.map((it, i) => {
        const len = (Math.max(0, it.value) / total) * C;
        const el = <Circle key={it.label} cx={size / 2} cy={size / 2} r={r} stroke={PALETTE[i % PALETTE.length]} strokeWidth={thickness} fill="none" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} />;
        off += len;
        return el;
      })}
    </Svg>
  );
}

export function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <View style={{ padding: 24, alignItems: "center" }}><T v="small" color={t.muted} style={{ textAlign: "center" }}>{text}</T></View>;
}

export function Loading() {
  const t = useTheme();
  return <View style={{ padding: 24 }}><ActivityIndicator color={t.primary} /></View>;
}

export function ErrorText({ error }: { error?: { message: string } | null }) {
  const t = useTheme();
  if (!error) return null;
  return <View style={{ backgroundColor: t.downSoft, padding: 10, borderRadius: 8 }}><T v="small" color={t.down}>{error.message}</T></View>;
}

export function KV({ k, v, vColor }: { k: string; v: ReactNode; vColor?: string }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: "space-between", paddingVertical: 5 }}>
      <T v="small" color={t.muted}>{k}</T>
      {typeof v === "string" || typeof v === "number" ? <T v="small" color={vColor} style={{ fontWeight: "600" }}>{v}</T> : v}
    </Row>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

export function ToastHost() {
  const t = useTheme();
  const { toasts, dismiss } = useToasts();
  const insets = useSafeAreaInsets();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 12, right: 12, top: insets.top + 8, gap: 8, zIndex: 100 }}>
      {toasts.map((x) => (
        <Pressable key={x.id} onPress={() => dismiss(x.id)} style={{ backgroundColor: t.surface, borderRadius: 12, padding: 12, borderLeftWidth: 4,
          borderLeftColor: x.kind === "error" ? t.down : x.kind === "success" ? t.up : t.primary, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, elevation: 6 }}>
          <T v="h3">{x.title}</T>
          {x.body ? <T v="small" color={t.muted}>{x.body}</T> : null}
        </Pressable>
      ))}
    </View>
  );
}

export const styles = (t: Theme) => StyleSheet.create({
  listRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
});
