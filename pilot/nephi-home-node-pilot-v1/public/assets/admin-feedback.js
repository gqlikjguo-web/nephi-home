'use strict';
(()=>{
 const host=document.getElementById('guestFeedback');if(!host)return;
 const labels={cleanliness:'清潔度',comfort:'睡眠／舒適度',equipment:'房內設備',arrival:'入住便利性',noise:'隔音感受'};
 const positive={clean:'房間乾淨',bed:'床／睡眠舒適',bathroom:'浴室',equipment:'房內設備',arrival:'入住流程',service:'服務／溝通',other:'其他'};
 const improvement={noise:'隔音',clean:'清潔細節',bed:'床／枕頭',equipment:'房內設備',bathroom:'浴室',instructions:'入住說明',other:'其他',none:'沒有特別需要改善'};
 const statuses={unviewed:'未查看',viewed:'已查看',needs_improvement:'待改善',improved:'已改善'},revisits={yes:'願意',maybe:'可能會',no:'暫時不會'};
 let generation=0,cursor=null,busy=false,appliedFilters=null;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const $=name=>host.querySelector('[data-feedback='+name+']');
 const number=value=>value===null||value===undefined?'—':Number(value).toFixed(1);
 const date=value=>new Date(value).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
 async function request(path,options={}){const response=await fetch('/api/feedback'+path,{...options,headers:{'content-type':'application/json'}}),body=await response.json();if(!response.ok)throw Error(body.error?.message||'暫時無法載入');return body.data;}
 function select(name,items){const s=el('select');s.dataset.feedback=name;for(const [key,title] of items){const o=el('option','',title);o.value=key;s.append(o);}return s;}
 function field(label,control){const l=el('label','feedback-field',label);l.append(control);return l;}
 function build(){
  host.replaceChildren();const header=el('div','feedback-heading');header.append(el('h2','','住客回饋'));host.append(header);
  const status=el('p','message');status.dataset.feedback='message';status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.append(status);
  const share=el('section','feedback-card feedback-share'),shareText=el('div');shareText.append(el('h3','','我的住客回饋表'),el('p','hint','固定連結，可分享給客人或列印 QR Code。'));
  const link=el('a','feedback-url');link.dataset.feedback='url';link.target='_blank';link.rel='noopener noreferrer';
  const copy=el('button','','複製連結');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(link.href);copy.textContent='已複製連結 ✓';$('message').textContent='已複製回饋表連結';}catch{$('message').textContent='請長按上方連結複製';}};
  shareText.append(link,copy);const qr=el('img');qr.dataset.feedback='qr';qr.alt='掃描填寫住宿回饋';qr.width=144;qr.height=144;share.append(shareText,qr);host.append(share);
  const metrics=el('section','feedback-metrics');metrics.dataset.feedback='metrics';metrics.setAttribute('aria-label','整體回饋狀況');host.append(metrics);
  const experiences=el('section','feedback-card');experiences.append(el('h3','','各項住宿體驗'),el('p','hint','依全部回饋計算；未填的項目不列入平均。'));const bars=el('div','feedback-experiences');bars.dataset.feedback='categories';experiences.append(bars);host.append(experiences);
  const ranks=el('div','feedback-ranks');for(const [key,title] of [['positives','值得繼續保持'],['improvements','優先看看這些問題']]){const section=el('section','feedback-card');section.append(el('h3','',title));const list=el('ol','feedback-ranking');list.dataset.feedback=key;section.append(list);ranks.append(section);}host.append(ranks);
  const history=el('section','feedback-history');history.append(el('h3','','歷史回饋'));
  const filters=el('form','feedback-filters'),statusFilter=select('status',[['all','全部'],['unviewed','未查看'],['needs_improvement','待改善'],['improved','已改善']]),period=select('period',[['month','本月'],['previous','上個月'],['custom','自訂日期']]),rating=select('rating',[['all','全部'],['5','5星'],['4','4星'],['low','3星以下']]);
  const from=el('input'),to=el('input');from.type=to.type='date';from.dataset.feedback='from';to.dataset.feedback='to';const dates=el('div','feedback-dates');dates.hidden=true;dates.append(field('開始日期',from),field('結束日期',to));period.onchange=()=>{dates.hidden=period.value!=='custom';from.required=to.required=period.value==='custom';};
  const apply=el('button','','套用篩選');filters.append(field('狀態',statusFilter),field('時間',period),field('評分',rating),dates,apply);filters.onsubmit=e=>{e.preventDefault();loadHistory(false);};history.append(filters);
  const list=el('div');list.dataset.feedback='history';history.append(list);const more=el('button','secondary','載入更多');more.type='button';more.dataset.feedback='more';more.hidden=true;more.onclick=()=>loadHistory(true);history.append(more);host.append(history);
 }
 function summary(data){const metrics=$('metrics');metrics.replaceChildren();for(const [title,value,hint] of [['整體平均評分',number(data.average),'全部回饋 · 滿分 5 分'],['本月收到',data.monthCount,'份回饋'],['尚未查看',data.unviewed,'份待查看'],['待改善',data.needsImprovement,'份待處理']]){const card=el('article','feedback-metric');card.append(el('span','',title),el('strong','',String(value)),el('small','hint',hint));metrics.append(card);}
  const bars=$('categories'),valid=Object.values(data.categories).filter(x=>x!==null),high=Math.max(...valid),low=Math.min(...valid);bars.replaceChildren();
  for(const [key,title] of Object.entries(labels)){const value=data.categories[key],row=el('div','feedback-experience'),top=el('div');top.append(el('span','',title),el('strong','',number(value)+(value!==null&&high!==low?(value===high?' · 表現最佳':value===low?' · 可留意':''):'')));const meter=el('meter');meter.min=0;meter.max=5;meter.value=value||0;meter.setAttribute('aria-label',title+'平均分');row.append(top,meter);bars.append(row);}
  for(const [key,names] of [['positives',positive],['improvements',improvement]]){const list=$(key);list.replaceChildren();if(!data[key].length){list.append(el('p','hint','還沒有相關回饋'));continue;}for(const item of data[key].slice(0,3)){const li=el('li');li.append(el('span','',names[item.key]),el('strong','',item.count+' 次'));list.append(li);}}
 }
 function card(item){
  const a=el('article','feedback-card feedback-entry'),customer=el('div','feedback-customer'),top=el('div','feedback-entry-top');
  const stars=el('strong','feedback-stars','★'.repeat(item.overall)+'☆'.repeat(5-item.overall)+' '+number(item.overall));stars.setAttribute('aria-label','整體評分 '+item.overall+' 分');
  const badge=el('span','feedback-badge',statuses[item.status]);badge.dataset.status=item.status;top.append(stars,badge);customer.append(el('h4','feedback-section-label','客人原始回饋'),top);a.append(customer);
  const identity=!item.stay_date&&!item.room_name?'匿名回饋':[item.stay_date?'入住 '+item.stay_date.replaceAll('-','/'):'',item.room_name].filter(Boolean).join(' · ');
  customer.append(el('p','feedback-entry-meta',date(item.created_at)+' ｜ '+identity));
  for(const [title,keys,names,other,kind] of [['希望改善',item.improvements,improvement,item.improvement_other_text,'improvement'],['做得好的',item.positives,positive,item.positive_other_text,'positive']]){
   const value=keys.filter(k=>k!=='other'||!other).map(k=>names[k]).join('、'),detail=keys.includes('other')&&other;
   if(value||detail){const answer=el('div','feedback-answer feedback-answer-'+kind);answer.append(el('strong','',title));if(value)answer.append(el('p','',value));if(detail)answer.append(el('p','feedback-other-text','其他：'+detail));customer.append(answer);}
  }
  if(item.comment){const answer=el('div','feedback-answer feedback-answer-comment');answer.append(el('strong','','客人留言'),el('p','',item.comment));customer.append(answer);}
  const ratings=el('div','feedback-rating-chips');for(const [key,title] of Object.entries(labels))if(item.ratings[key])ratings.append(el('span','',title+' '+item.ratings[key]));if(ratings.children.length)customer.append(ratings);
  if(revisits[item.revisit])customer.append(el('p','feedback-revisit','再次入住：'+revisits[item.revisit]));
  const edit=el('form','feedback-edit'),state=select('entryStatus',Object.entries(statuses));state.value=item.status;
  const note=el('textarea');note.rows=2;note.maxLength=1000;note.value=item.internal_note;note.placeholder='記下改善進度，例如已增加浴室置物架';
  const save=el('button','secondary','儲存處理狀態'),message=el('p','message');message.setAttribute('role','status');edit.append(el('h4','feedback-section-label','業者處理'),field('處理狀態',state),field('內部改善備註（只有業者可見）',note),save,message);
  edit.onsubmit=async e=>{e.preventDefault();if(save.disabled)return;const current=generation;save.disabled=true;save.textContent='儲存中…';try{await request('/'+item.id,{method:'PATCH',body:JSON.stringify({status:state.value,internalNote:note.value})});if(current!==generation)return;badge.textContent=statuses[state.value];badge.dataset.status=state.value;message.textContent='已儲存';const data=await request('/summary');if(current===generation)summary(data);}catch(e){message.textContent=e.message;}finally{save.disabled=false;save.textContent='儲存處理狀態';}};a.append(edit);return a;
 }
 async function loadHistory(append){if(busy)return;busy=true;const current=generation;$('more').disabled=true;$('message').textContent='載入中…';const params=new URLSearchParams({status:$('status').value,period:$('period').value,rating:$('rating').value});if(params.get('period')==='custom'){params.set('from',$('from').value);params.set('to',$('to').value);}if(append&&appliedFilters){for(const key of [...params.keys()])params.delete(key);for(const [key,value] of appliedFilters)params.set(key,value);}if(append&&cursor)params.set('cursor',cursor);
  try{const data=await request('?'+params);if(current!==generation)return;if(!append)appliedFilters=new URLSearchParams(params);const list=$('history');if(!append)list.replaceChildren();for(const item of data.items)list.append(card(item));if(!list.children.length)list.append(el('p','feedback-empty','這段時間還沒有符合條件的回饋。'));cursor=data.nextCursor;$('more').hidden=!cursor;$('message').textContent='';}catch(e){if(current===generation)$('message').textContent=e.message;}finally{if(current===generation){busy=false;$('more').disabled=false;}}
 }
 async function load(){const current=++generation;busy=false;cursor=null;appliedFilters=null;build();$('message').textContent='正在載入住客回饋…';try{const [share,data]=await Promise.all([request('/share'),request('/summary')]);if(current!==generation)return;$('url').href=share.url;$('url').textContent=share.url;$('qr').src=share.qr;summary(data);await loadHistory(false);}catch(e){if(current===generation)$('message').textContent=e.message;}}
 window.addEventListener('junzan-admin-tab',e=>{if(e.detail==='feedback')load();});
 const topButton=document.getElementById('adminBackToTop');let topFrame=0;
 function positionTop(){topFrame=0;if(!topButton)return;let obscured=false;
  if(!host.hidden&&matchMedia('(max-width:640px)').matches){
   const a=topButton.getBoundingClientRect();
   obscured=host.contains(document.activeElement)&&document.activeElement.matches('input,select,textarea');
   if(!obscured)obscured=[...host.querySelectorAll('h2,h3,.feedback-share,.feedback-metric,.feedback-experience,.feedback-ranking li,.feedback-field,.feedback-answer,.feedback-entry-top,.feedback-entry-meta,.feedback-rating-chips,.feedback-revisit,.feedback-section-label,button')].some(n=>{const b=n.getBoundingClientRect();return b.width&&b.height&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});
  }
  topButton.classList.toggle('feedback-top-obscured',obscured);
 }
 function scheduleTop(){if(!topFrame)topFrame=requestAnimationFrame(positionTop);}
 window.addEventListener('scroll',scheduleTop,{passive:true});window.addEventListener('resize',scheduleTop);window.addEventListener('junzan-admin-tab',scheduleTop);host.addEventListener('focusin',scheduleTop);host.addEventListener('focusout',scheduleTop);new ResizeObserver(scheduleTop).observe(host);
 const workspace=document.getElementById('workspace');new MutationObserver(()=>{if(workspace.hidden){generation++;host.replaceChildren();}else if(!host.hidden)load();}).observe(workspace,{attributes:true,attributeFilter:['hidden']});
})();
