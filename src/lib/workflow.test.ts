import {describe,it,expect} from 'vitest';
import {calendarCells,addDays,checklistLines,shiftMonth,monthTitle} from './workflow';
import {previewType} from './file-preview';
const bytes=(text:string)=>new TextEncoder().encode(text);
describe('workflow dates and templates',()=>{
 it('creates a Monday-first month grid with year boundaries',()=>{const cells=calendarCells('2026-01');expect(cells).toHaveLength(35);expect(cells[0].date).toBe('2025-12-29');expect(cells.filter(c=>c.inMonth)).toHaveLength(31)});
 it('uses only the weeks belonging to the displayed month',()=>{
  expect(calendarCells('2026-10')).toHaveLength(35);
  expect(calendarCells('2026-10').at(-1)?.date).toBe('2026-11-01');
  expect(calendarCells('2021-02')).toHaveLength(28);
  expect(calendarCells('2026-08')).toHaveLength(42);
 });
 it('keeps every day once and completes Monday to Sunday weeks',()=>{
  for(let year=2024;year<=2028;year++)for(let month=1;month<=12;month++){
   const key=`${year}-${String(month).padStart(2,'0')}`,cells=calendarCells(key);
   expect(new Date(`${cells[0].date}T12:00:00Z`).getUTCDay()).toBe(1);
   expect(new Date(`${cells.at(-1)!.date}T12:00:00Z`).getUTCDay()).toBe(0);
   expect(new Set(cells.map(c=>c.date)).size).toBe(cells.length);
   expect(cells.filter(c=>c.inMonth).length).toBe(new Date(Date.UTC(year,month,0)).getUTCDate());
  }
 });
 it('navigates month and year boundaries and formats a standalone Russian title',()=>{
  expect(shiftMonth('2026-12',1)).toBe('2027-01');
  expect(shiftMonth('2026-01',-1)).toBe('2025-12');
  expect(monthTitle('2026-10')).toBe('Октябрь 2026');
 });
 it('handles leap years and date arithmetic',()=>{expect(calendarCells('2028-02').filter(c=>c.inMonth)).toHaveLength(29);expect(addDays('2026-12-31',1)).toBe('2027-01-01')});
 it('rejects malformed months',()=>{for(const month of ['2026-13','2026-1','x'])expect(()=>calendarCells(month)).toThrow()});
 it('strips empty checklist lines',()=>{expect(checklistLines(' First \n\n Second\r\n')).toEqual(['First','Second'])});
});
describe('safe file preview types',()=>{
 it('rejects scriptable formats and renamed HTML',()=>{for(const text of ['<svg onload=alert(1)>','<!doctype html>','not a PDF',''])expect(previewType(bytes(text))).toBeNull()});
 it('recognizes PDF and raster file signatures',()=>{expect(previewType(bytes('%PDF-1.7\n'))).toBe('application/pdf');expect(previewType(bytes('GIF89a'))).toBe('image/gif');expect(previewType(bytes('RIFF1234WEBP'))).toBe('image/webp');expect(previewType(new Uint8Array([255,216,255]))).toBe('image/jpeg');expect(previewType(new Uint8Array([137,80,78,71,13,10,26,10]))).toBe('image/png')});
});
