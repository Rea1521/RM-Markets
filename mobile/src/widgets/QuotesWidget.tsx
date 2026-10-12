// Non-iOS stub so the shared sync code can import this module on Android/web.
export type IOSWidgetProps = { rows: { display: string; price: string; change: string; up: boolean }[]; updated: string };
const noop = { updateSnapshot: (_p: IOSWidgetProps) => {}, reload: () => {} };
export default noop;
