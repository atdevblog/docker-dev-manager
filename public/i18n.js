'use strict';
// Tiny i18n shared by the browser (window.I18N) and Node (require). Dictionaries are nested JSON:
// a leaf is a string, or a plural object {one, other} picked with Intl.PluralRules on params.count.
// Messages from the server are {key, params}; params may hold nested messages or lists.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.I18N=api;})(typeof self!=='undefined'?self:this,function(){
  const LANGS=['vi','en'],FALLBACK='vi';
  const valid=lang=>LANGS.includes(lang);
  function lookup(dict,key){return String(key).split('.').reduce((node,part)=>node&&typeof node==='object'?node[part]:undefined,dict);}
  const isPlural=v=>v&&typeof v==='object'&&typeof v.other==='string';
  function create(dicts,lang,onMissing){
    lang=valid(lang)?lang:FALLBACK;
    const rules=new Intl.PluralRules(lang);
    function t(key,params={}){
      let value=lookup(dicts[lang],key);
      if(value===undefined||(typeof value==='object'&&!isPlural(value)))value=lookup(dicts[FALLBACK],key);
      if(value===undefined||(typeof value==='object'&&!isPlural(value))){if(onMissing)onMissing(key);return key;}
      if(isPlural(value))value=value[typeof params.count==='number'?rules.select(params.count):'other']??value.other;
      return value.replace(/\{(\w+)\}/g,(match,name)=>name in params?format(params[name]):match);
    }
    // Numbers stay unformatted on purpose: ports, exit codes and PIDs must never get thousand separators.
    function format(value){
      // A list of messages reads as sentences; a list of names (possibly ending in "+N more") as a comma list.
      if(Array.isArray(value))return value.map(render).join(value.length&&value.every(v=>v&&typeof v==='object')?' ':', ');
      if(value&&Array.isArray(value.items))return value.items.map(render).join(value.sep||', ');
      if(value&&typeof value==='object')return render(value);
      return String(value??'');
    }
    // A message is a plain string (technical text such as Docker's own error, shown as is),
    // a {key, params} descriptor, or a list of either.
    function render(message){
      if(message==null)return '';
      if(typeof message==='string')return message;
      if(Array.isArray(message))return message.map(render).filter(Boolean).join(' ');
      if(typeof message.key==='string')return t(message.key,message.params||{});
      return String(message);
    }
    return {lang,t,render};
  }
  // Leaf keys of a dictionary; a plural object counts as one key.
  function keys(dict,prefix=''){
    return Object.entries(dict).flatMap(([k,v])=>typeof v==='string'||isPlural(v)?[prefix+k]:keys(v,prefix+k+'.'));
  }
  return {LANGS,FALLBACK,valid,create,keys,lookup};
});
