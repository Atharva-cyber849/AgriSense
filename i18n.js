(function (root) {
  'use strict';
  const rows = typeof module === 'object' && module.exports ? require('./i18n-catalog.js') : root.AgriSenseTranslations;
  const names = {en: 'English', hi: 'हिन्दी', ta: 'தமிழ்'};
  const areaLanguages = {karnal: 'hi', haridwar: 'hi', agrifieldnet: 'en'};
  const key = 'agrisense-ui-language-v1';
  const dictionaries = {hi: new Map(rows.map(([en,hi])=>[en,hi])), ta: new Map(rows.map(([en,,ta])=>[en,ta]))};
  const normalize = value => value === 'auto' || Object.hasOwn(names,value) ? value : 'auto';
  const resolve = (preference, area) => normalize(preference) === 'auto' ? (Object.hasOwn(areaLanguages,area) ? areaLanguages[area] : 'en') : preference;
  function read(storage) {try {return normalize(storage.getItem(key));} catch {return 'auto';}}
  function save(storage,value) {try {storage.setItem(key,normalize(value));return true;} catch {return false;}}
  const area = root.document?.documentElement.dataset.studyArea || 'karnal';
  let preference = 'auto';
  try {preference = read(root.localStorage);} catch {}
  let language = resolve(preference,area);
  function t(text,values={}) {
    return (dictionaries[language]?.get(text) ?? String(text ?? '')).replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
  }
  function apply(container=root.document) {
    if(!container)return;
    for(const el of container.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);
    for(const attr of ['title','aria-label','placeholder'])for(const el of container.querySelectorAll(`[data-i18n-${attr}]`))el.setAttribute(attr,t(el.getAttribute(`data-i18n-${attr}`)));
  }
  function setPreference(value) {
    preference=normalize(value);language=resolve(preference,area);
    if(root.document)root.document.documentElement.lang=language;
  }
  const api={t,apply,read,save,normalize,resolve,setPreference,locale:()=>`${language}-IN`,get language(){return language;},key};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.AgriSenseI18n=api;
  if(!root.document)return;
  root.document.documentElement.lang=language;
  root.document.addEventListener('DOMContentLoaded',()=>{
    const select=root.document.getElementById('language-select');
    if(!select)return;
    select.value=preference;
    apply();
    select.addEventListener('change',()=>{
      setPreference(select.value);
      let saved=false;try{saved=save(root.localStorage,preference);}catch{}
      apply();
      root.document.getElementById('language-status').textContent=saved?'':t('Language preference could not be saved.');
      root.dispatchEvent(new Event('agrisense:languagechange'));
    });
  });
})(typeof window==='object'?window:globalThis);
