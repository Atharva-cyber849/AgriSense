(function (root) {
  'use strict';
  const rows = typeof module === 'object' && module.exports ? require('./i18n-catalog.js') : root.AgriSenseTranslations;
  const regional = typeof module === 'object' && module.exports ? require('./i18n-regional.js') : root.AgriSenseRegionalTranslations;
  const names = Object.freeze({en: 'English', hi: 'हिन्दी', bn: 'বাংলা', mr: 'मराठी', te: 'తెలుగు', ta: 'தமிழ்', gu: 'ગુજરાતી', ur: 'اردو', kn: 'ಕನ್ನಡ', or: 'ଓଡ଼ିଆ', ml: 'മലയാളം'});
  const areaLanguages = {karnal: 'hi', haridwar: 'hi', agrifieldnet: 'en', 'soil-moisture': 'en'};
  const key = 'agrisense-ui-language-v1';
  const dictionaries = {hi: new Map(rows.map(([en,hi])=>[en,hi])), ta: new Map(rows.map(([en,,ta])=>[en,ta]))};
  for(const [code,translations] of Object.entries(regional || {}))dictionaries[code]=new Map(Object.entries(translations));
  const normalize = value => value === 'auto' || Object.hasOwn(names,value) ? value : 'auto';
  const resolve = (preference, area) => normalize(preference) === 'auto' ? (Object.hasOwn(areaLanguages,area) ? areaLanguages[area] : 'en') : preference;
  function read(storage) {try {return normalize(storage.getItem(key));} catch {return 'auto';}}
  function save(storage,value) {try {storage.setItem(key,normalize(value));return true;} catch {return false;}}
  const area = root.document?.documentElement.dataset.studyArea || 'karnal';
  let preference = 'auto';
  try {preference = read(root.localStorage);} catch {}
  let language = resolve(preference,area);
  function t(text,values={}) {
    return (dictionaries[language]?.get(text) ?? String(text ?? '')).replace(/\{(\w+)\}/g,(match,name)=>{
      if(!Object.hasOwn(values,name))return match;
      const value=String(values[name]);
      // Isolate inserted identifiers/dates from surrounding Urdu punctuation.
      return language==='ur'?`\u2068${value}\u2069`:value;
    });
  }
  function apply(container=root.document) {
    if(!container)return;
    for(const el of container.querySelectorAll('[data-i18n]')){
      el.textContent=t(el.dataset.i18n);
      el.lang=language;
      el.dir=language==='ur'?'rtl':'ltr';
    }
    for(const attr of ['title','aria-label','placeholder'])for(const el of container.querySelectorAll(`[data-i18n-${attr}]`))el.setAttribute(attr,t(el.getAttribute(`data-i18n-${attr}`)));
  }
  function setPreference(value) {
    preference=normalize(value);language=resolve(preference,area);
    if(root.document)root.document.documentElement.lang=language;
  }
  const api={t,apply,read,save,normalize,resolve,setPreference,names,locale:()=>`${language}-IN`,get language(){return language;},key};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.AgriSenseI18n=api;
  if(!root.document)return;
  root.document.documentElement.lang=language;
  root.document.addEventListener('DOMContentLoaded',()=>{
    const select=root.document.getElementById('language-select');
    if(!select)return;
    // One registry keeps every study page's options and native names in sync.
    select.replaceChildren();
    const automatic=root.document.createElement('option');
    automatic.value='auto';automatic.dataset.i18n='Automatic (study area)';
    select.appendChild(automatic);
    for(const [code,name] of Object.entries(names)){
      const option=root.document.createElement('option');
      option.value=code;option.textContent=name;option.lang=code;option.dir=code==='ur'?'rtl':'ltr';
      select.appendChild(option);
    }
    select.value=preference;
    apply();
    select.addEventListener('change',()=>{
      setPreference(select.value);
      let saved=false;try{saved=save(root.localStorage,preference);}catch{}
      apply();
      const status=root.document.getElementById('language-status');
      if(status){status.textContent=saved?'':t('Language preference could not be saved.');status.lang=language;status.dir=language==='ur'?'rtl':'ltr';}
      root.dispatchEvent(new Event('agrisense:languagechange'));
    });
  });
})(typeof window==='object'?window:globalThis);
