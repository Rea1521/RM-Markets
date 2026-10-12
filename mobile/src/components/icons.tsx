import Svg, { Circle, Path, Rect } from "react-native-svg";

type P = { color: string; size?: number };
const S = ({ color, size = 22, children }: P & { children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{children}</Svg>
);

export const Icons = {
  home: (p: P) => <S {...p}><Path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></S>,
  markets: (p: P) => <S {...p}><Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></S>,
  portfolio: (p: P) => <S {...p}><Rect x={3} y={7} width={18} height={13} rx={2} /><Path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></S>,
  orders: (p: P) => <S {...p}><Rect x={4} y={3} width={16} height={18} rx={2} /><Path d="M8 8h8M8 12h8M8 16h5" /></S>,
  more: (p: P) => <S {...p}><Circle cx={5} cy={12} r={1} /><Circle cx={12} cy={12} r={1} /><Circle cx={19} cy={12} r={1} /></S>,
  bell: (p: P) => <S {...p}><Path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" /></S>,
  menu: (p: P) => <S {...p}><Path d="M3 6h18M3 12h18M3 18h18" /></S>,
  deposit: (p: P) => <S {...p}><Path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></S>,
  withdraw: (p: P) => <S {...p}><Path d="M12 15V3M7 8l5-5 5 5M4 21h16" /></S>,
  transfer: (p: P) => <S {...p}><Path d="M17 3l4 4-4 4M21 7H9M7 21l-4-4 4-4M3 17h12" /></S>,
  history: (p: P) => <S {...p}><Path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3" /></S>,
  star: (p: P & { filled?: boolean }) => <Svg width={p.size ?? 22} height={p.size ?? 22} viewBox="0 0 24 24" fill={p.filled ? "#f59e0b" : "none"} stroke={p.filled ? "#f59e0b" : p.color} strokeWidth={1.8} strokeLinejoin="round"><Path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></Svg>,
  back: (p: P) => <S {...p}><Path d="M19 12H5M12 19l-7-7 7-7" /></S>,
  chevron: (p: P) => <S {...p}><Path d="m9 6 6 6-6 6" /></S>,
};
