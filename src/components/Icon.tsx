import type {SVGProps} from 'react';
const paths={
 bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
 overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 board:'M3 4h18v16H3z M9 4v16 M15 4v16 M5 8h2 M11 8h2 M17 8h2',
 chat:'M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z M7 10h10 M7 14h6',
 files:'M3 7V4h7l2 3h9v13H3z',
 search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 tasks:'M9 5h12 M9 12h12 M9 19h12 M2 5l2 2 3-4 M2 12l2 2 3-4 M2 19l2 2 3-4',
 calendar:'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M13 14h2 M7 18h2',
 repeat:'M20 7H7a4 4 0 0 0-4 4 M17 3l4 4-4 4 M4 17h13a4 4 0 0 0 4-4 M7 13l-4 4 4 4',
 archive:'M3 3h18v5H3z M5 8v13h14V8 M10 12h4',
 summary:'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
 team:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M16 3a4 4 0 0 1 0 8',
 left:'M15 18l-6-6 6-6',right:'M9 18l6-6-6-6',
 sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
 moon:'M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10',
};
export type IconName=keyof typeof paths;
export default function Icon({name,...props}:SVGProps<SVGSVGElement>&{name:IconName}){
 return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]}/></svg>;
}
