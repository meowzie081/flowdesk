export function calendarCells(month:string){
 if(!/^\d{4}-\d{2}$/.test(month))throw new Error('Некорректный месяц');
 const first=new Date(`${month}-01T12:00:00Z`);if(!Number.isFinite(+first)||first.toISOString().slice(0,7)!==month)throw new Error('Некорректный месяц');
 const shift=(first.getUTCDay()+6)%7;
 const next=new Date(+first);next.setUTCMonth(next.getUTCMonth()+1);
 const days=Math.round((+next-+first)/86400000);
 return Array.from({length:Math.ceil((shift+days)/7)*7},(_,i)=>{const date=new Date(+first+(i-shift)*86400000);return {date:date.toISOString().slice(0,10),day:date.getUTCDate(),inMonth:date.toISOString().slice(0,7)===month}});
}
export function addDays(day:string,days:number){return new Date(+new Date(`${day}T12:00:00Z`)+days*86400000).toISOString().slice(0,10)}
export function checklistLines(value:string){return value.split('\n').map(v=>v.trim()).filter(Boolean)}

export function shiftMonth(month:string,amount:number){
 calendarCells(month);
 const date=new Date(`${month}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+amount);
 return date.toISOString().slice(0,7);
}
export function monthTitle(month:string){
 calendarCells(month);
 const text=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`)).replace(/ г\.$/,'');
 return text[0].toUpperCase()+text.slice(1);
}
