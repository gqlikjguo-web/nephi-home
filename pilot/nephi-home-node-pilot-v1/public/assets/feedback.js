'use strict';
(async()=>{
 const $=id=>document.getElementById(id),form=$('feedbackForm'),token=location.pathname.split('/').pop();
 let submitting=false;
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const categories=[['cleanliness','清潔度'],['comfort','睡眠／舒適度'],['equipment','房內設備'],['arrival','入住便利性'],['noise','隔音感受']];
 function rating(host,name,label,required=false){
  const group=node('div');group.className='ratings'+(required?' overall':'');group.setAttribute('role','group');group.setAttribute('aria-label',label);
  const output=required?node('p','請選擇星級'):null;if(output){output.className='rating-selection';output.setAttribute('aria-live','polite');}
  for(let i=1;i<=5;i++){
   const l=node('label'),input=node('input'),span=node('span',required?'☆':String(i));l.className='rating-choice';input.type='radio';input.name=name;input.value=i;input.required=required;input.setAttribute('aria-label',`${label} ${i}分${i===5?' 非常滿意':''}`);span.setAttribute('aria-hidden','true');l.append(input,span);group.append(l);
  }
  if(required)group.addEventListener('change',e=>{const value=Number(e.target.value);for(const l of group.children){const filled=Number(l.querySelector('input').value)<=value;l.classList.toggle('is-filled',filled);l.querySelector('span').textContent=filled?'★':'☆';}output.textContent=value+' 分 · '+['非常不滿意','不太滿意','普通','滿意','非常滿意'][value-1];$('submitMessage').textContent='';});
  host.append(group);if(output)host.append(output);
 }
 function choices(host,name,items,type='checkbox'){for(const [key,title] of items){const label=node('label'),input=node('input');label.className='choice';if(key==='none')label.classList.add('choice-wide');input.type=type;input.name=name;input.value=key;label.append(input,node('span',title));host.append(label);}}
 rating($('overallRating'),'overall','整體住宿滿意度',true);
 for(const [key,label] of categories){const host=node('div');host.className='experience';host.append(node('div',label));rating(host,key,label);$('experienceRatings').append(host);}
 choices($('positiveChoices'),'positives',[['clean','房間乾淨'],['bed','床／睡眠舒適'],['bathroom','浴室'],['equipment','房內設備'],['arrival','入住流程'],['service','服務／溝通'],['other','其他']]);
 choices($('improvementChoices'),'improvements',[['noise','隔音'],['clean','清潔細節'],['bed','床／枕頭'],['equipment','房內設備'],['bathroom','浴室'],['instructions','入住說明'],['other','其他'],['none','沒有特別需要改善']]);
 choices($('revisitChoices'),'revisit',[['yes','願意'],['maybe','可能會'],['no','暫時不會']],'radio');
 $('improvementChoices').addEventListener('change',e=>{if(!e.target.checked)return;for(const input of form.querySelectorAll('[name=improvements]'))if(input!==e.target&&(e.target.value==='none'||input.value==='none'))input.checked=false;});
 function failure(status){return status===429?'送出次數較多，請稍候再試。':status===404?'此回饋連結無效，請向旅宿取得新連結。':status===400?'請確認評分、日期與房型後再送出。':'暫時無法完成，請稍後再試。';}
 async function request(options){let response;try{response=await fetch('/api/public/feedback/'+token,options);}catch{throw Error('網路連線不穩，請確認連線後再試一次。');}if(!response.ok)throw Error(failure(response.status));try{return await response.json();}catch{throw Error('暫時無法完成，請稍後再試。');}}
 try{const body=await request();$('feedbackTitle').textContent=body.data.propertyName+'｜住宿回饋';document.title=$('feedbackTitle').textContent;for(const room of body.data.rooms){const option=node('option',room.name);option.value=room.id;form.elements.roomId.append(option);}$('feedbackMessage').textContent='';form.hidden=false;}catch(e){$('feedbackMessage').textContent=e.message;}
 form.onsubmit=async e=>{
  e.preventDefault();if(submitting)return;
  if(!form.querySelector('[name=overall]:checked')){$('submitMessage').textContent='請先選擇整體住宿滿意度，再送出回饋。';form.querySelector('[name=overall]').focus();return;}
  if(!form.reportValidity())return;
  submitting=true;const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='送出中…';form.setAttribute('aria-busy','true');$('submitMessage').textContent='';
  const data=new FormData(form),ratings={};for(const [key] of categories)if(data.has(key))ratings[key]=Number(data.get(key));
  try{await request({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({overall:Number(data.get('overall')),ratings,positives:data.getAll('positives'),improvements:data.getAll('improvements'),revisit:data.get('revisit')||null,stayDate:data.get('stayDate')||null,roomId:data.get('roomId')||null,comment:data.get('comment')})});form.hidden=true;document.querySelector('header').hidden=true;$('feedbackComplete').hidden=false;$('feedbackComplete').focus();window.scrollTo(0,0);}
  catch(e){$('submitMessage').textContent=e.message;submitting=false;button.disabled=false;button.textContent='送出回饋';}
  finally{form.setAttribute('aria-busy','false');}
 };
})();
