import { describe, expect, it } from 'vitest';
import { checklistProgress, columnLoad, dayBounds, displayMentions, extractMentions, mentionToken, moscowDay } from './collaboration';
const person='00000000-0000-4000-8000-000000000001';
describe('collaboration',()=>{
 it('tracks checklist progress and empty lists',()=>{expect(checklistProgress([])).toEqual({done:0,total:0,percent:0});expect(checklistProgress([{id:'a',title:'a',is_done:true,position:0},{id:'b',title:'b',is_done:false,position:1}])).toEqual({done:1,total:2,percent:50});});
 it('flags column overload only above its configured limit',()=>{expect(columnLoad(3,3)).toEqual({exceeded:false,label:'3 / 3'});expect(columnLoad(4,3).exceeded).toBe(true);expect(columnLoad(999,null).exceeded).toBe(false);});
 it('keeps mention identity separate from the displayed name',()=>{const token=mentionToken(person,'Анна');expect(displayMentions(token)).toBe('@Анна');expect(extractMentions(`${token} ${token}`,[person])).toEqual([person]);expect(extractMentions(token,[])).toEqual([]);});
 it('sanitizes mention delimiters in profile names',()=>{expect(mentionToken(person,'@[Анна]')).toBe(`@[Анна](${person})`)});
 it('uses Moscow midnight even when UTC date differs',()=>{expect(moscowDay(new Date('2026-10-12T22:30:00Z'))).toBe('2026-10-13');expect(dayBounds('2026-10-13')).toEqual({start:'2026-10-12T21:00:00.000Z',end:'2026-10-13T21:00:00.000Z'});});
 it('rejects invalid calendar dates',()=>{for(const date of ['2026-02-30','2026-13-01','hello','2026-1-01'])expect(()=>dayBounds(date)).toThrow();});
});
