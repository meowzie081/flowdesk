'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {CONSENT_KEY,readConsent,startAnalytics,stopAnalytics,trackPage,validMeasurementId,type Consent} from '@/lib/analytics-client';
import {useI18n} from './I18nProvider';
export default function GoogleAnalytics(){
 const {t}=useI18n();
 const id=process.env.NEXT_PUBLIC_GA_ID,path=usePathname();
 const [consent,setConsent]=useState<Consent|null>(null),[ready,setReady]=useState(false),[settings,setSettings]=useState(false);
 useEffect(()=>{setConsent(readConsent());setReady(true);const sync=()=>setConsent(readConsent());window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync)},[]);
 useEffect(()=>{if(!id||!ready)return;if(consent==='granted'){startAnalytics(id);trackPage(path)}else stopAnalytics(id)},[id,ready,consent,path]);
 function choose(value:Consent){try{localStorage.setItem(CONSENT_KEY,value)}catch{setConsent('denied');setSettings(false);return}if(value==='denied'&&id)stopAnalytics(id);setConsent(value);setSettings(false)}
 if(!validMeasurementId(id)||!ready)return null;
 return <><footer className="mx-auto max-w-[1600px] px-4 py-4 text-right"><button className="text-xs text-mute underline hover:text-ink" onClick={()=>setSettings(true)}>{t('analytics.settings')}</button></footer>{(consent===null||settings)&&<section role="region" aria-label={t('analytics.settings')} className="fixed bottom-3 left-3 right-3 z-50 ml-auto max-w-lg rounded-2xl border border-line bg-white p-4 shadow-xl"><h2 className="text-sm font-semibold">{t('analytics.title')}</h2><p className="mt-2 text-xs leading-relaxed text-mute">{t('analytics.hint')}</p><div className="mt-3 flex flex-wrap gap-2"><button className="btn-solid" onClick={()=>choose('granted')}>{t('analytics.allow')}</button><button className="btn" onClick={()=>choose('denied')}>{t('analytics.deny')}</button>{settings&&consent!==null&&<button className="btn" onClick={()=>setSettings(false)}>{t('common.close')}</button>}</div></section>}</>;
}
