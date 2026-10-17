import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {analyticsSection,trackEvent,trackPage,validMeasurementId,readConsent,CONSENT_KEY} from './analytics-client';
afterEach(()=>vi.unstubAllGlobals());
describe('analytics privacy boundary',()=>{
 beforeEach(()=>{vi.stubGlobal('window',{flowdeskGaId:'G-TEST123',gtag:vi.fn(),location:{origin:'https://flowdesk.example'}});vi.stubGlobal('localStorage',{getItem:()=> 'granted'})});
 it('accepts only GA4 measurement IDs',()=>{expect(validMeasurementId('G-TEST123')).toBe(true);for(const id of [undefined,'UA-123','G-x\" onload=alert(1)','https://example.com'])expect(validMeasurementId(id)).toBe(false)});
 it('replaces department identifiers and query content with a fixed section',()=>{expect(analyticsSection('/d/private-id/board')).toEqual({path:'/app/board',title:'FlowDesk · Канбан'});expect(analyticsSection('/d/private-id')).toEqual({path:'/app/overview',title:'FlowDesk · Обзор'});expect(analyticsSection('/secret/email@example.com')).toEqual({path:'/other',title:'FlowDesk'});trackPage('/d/private-id/board');expect(JSON.stringify(vi.mocked(window.gtag!).mock.calls)).not.toContain('private-id')});
 it('drops arbitrary parameters and categorical values containing content',()=>{trackEvent('task_created',{source:'board',title:'Secret title',email:'person@example.com',kind:'private.pdf'} as never);expect(window.gtag).toHaveBeenCalledWith('event','task_created',{source:'board'})});
 it('blocks unknown runtime event names',()=>{trackEvent('secret task title' as never);expect(window.gtag).not.toHaveBeenCalled()});
 it('sends neither pageviews nor events without consent or configured ID',()=>{vi.stubGlobal('localStorage',{getItem:()=> 'denied'});trackPage('/profile');trackEvent('message_sent');expect(window.gtag).not.toHaveBeenCalled();vi.stubGlobal('localStorage',{getItem:()=> 'granted'});window.flowdeskGaId=undefined;trackEvent('message_sent');expect(window.gtag).not.toHaveBeenCalled()});
 it('fails closed when browser storage is blocked',()=>{vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked')}});expect(readConsent()).toBeNull();trackEvent('message_sent');expect(window.gtag).not.toHaveBeenCalled()});
});
