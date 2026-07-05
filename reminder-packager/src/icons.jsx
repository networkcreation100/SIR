function SvgIcon({ size = 18, children, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}
export function AlertTriangle(props) { return <SvgIcon {...props}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></SvgIcon>; }
export function Bell(props) { return <SvgIcon {...props}><path d="M10.3 21a2 2 0 0 0 3.4 0"/><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/></SvgIcon>; }
export function CalendarClock(props) { return <SvgIcon {...props}><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><circle cx="17" cy="17" r="5"/><path d="M17 14v3l2 1"/></SvgIcon>; }
export function CheckCircle2(props) { return <SvgIcon {...props}><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></SvgIcon>; }
export function ChevronDown(props) { return <SvgIcon {...props}><path d="m6 9 6 6 6-6"/></SvgIcon>; }
export function ChevronLeft(props) { return <SvgIcon {...props}><path d="m15 18-6-6 6-6"/></SvgIcon>; }
export function ChevronRight(props) { return <SvgIcon {...props}><path d="m9 18 6-6-6-6"/></SvgIcon>; }
export function LocateFixed(props) { return <SvgIcon {...props}><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></SvgIcon>; }
export function Maximize2(props) { return <SvgIcon {...props}><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/></SvgIcon>; }
export function Minimize2(props) { return <SvgIcon {...props}><path d="M4 14h6v6"/><path d="m10 14-7 7"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/></SvgIcon>; }
export function MapPin(props) { return <SvgIcon {...props}><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></SvgIcon>; }
export function Mic(props) { return <SvgIcon {...props}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></SvgIcon>; }
export function Music2(props) { return <SvgIcon {...props}><circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/></SvgIcon>; }
export function Mail(props) { return <SvgIcon {...props}><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></SvgIcon>; }
export function MessageCircle(props) { return <SvgIcon {...props}><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></SvgIcon>; }
export function Heart(props) { return <SvgIcon {...props}><path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7Z"/></SvgIcon>; }
export function ShieldCheck(props) { return <SvgIcon {...props}><path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.5a1.3 1.3 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/></SvgIcon>; }
export function Settings2(props) { return <SvgIcon {...props}><path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.2a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.2a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.2a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.2a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></SvgIcon>; }
export function Send(props) { return <SvgIcon {...props}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></SvgIcon>; }
export function Smartphone(props) { return <SvgIcon {...props}><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></SvgIcon>; }
export function Sparkles(props) { return <SvgIcon {...props}><path d="m12 3-1.9 5.8L4 10.5l6.1 1.7L12 18l1.9-5.8 6.1-1.7-6.1-1.7Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></SvgIcon>; }
export function X(props) { return <SvgIcon {...props}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></SvgIcon>; }

export function RefreshCw(props) { return <SvgIcon {...props}><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/></SvgIcon>; }
