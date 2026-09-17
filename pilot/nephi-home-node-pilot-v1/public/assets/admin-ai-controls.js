"use strict";
const AiControls = (() => {
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { "content-type": "application/json" } });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || "載入失敗，請稍後重試。");
    return payload.data;
  }
  function node(host, tag, text, field) {
    const result = host.ownerDocument.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (field) result.dataset.field = field;
    return result;
  }
  function subscriptionText(data) {
    if (!data) return "方案狀態暫時無法取得";
    if (data.status === "EXPIRED") return "方案已到期，AI 自動回覆已暫停";
    if (data.status === "NOT_STARTED") return `方案將於 ${data.contractStart.split("-").join("/")} 開始，AI 自動回覆尚未啟用`;
    if (data.status === "DISABLED") return "方案已暫停，AI 自動回覆已暫停";
    if (data.status === "UNCONFIGURED") return "方案尚未設定，AI 自動回覆已暫停";
    if (data.status === "LEGACY") return "目前沿用原方案；合約期限待平台設定";
    if (data.status === "ACTIVE") return `方案有效至 ${data.contractEnd.split("-").join("/")}`;
    return "方案狀態暫時無法取得";
  }
  function summary(host, cards = false) {
    const period = node(host, "p", "", "period"), usage = node(host, cards ? "div" : "p", "", "usage"), status = node(host, "p", "", "quotaStatus");
    status.setAttribute("role", "status");
    const progress = cards ? node(host, "progress", undefined, "quotaProgress") : null;
    if (cards) usage.className = "ai-quota-cards";
    host.append(period, usage);
    if (progress) { progress.hidden = true; progress.setAttribute("aria-label", "本月訊息額度使用進度"); host.append(progress); }
    host.append(status);
    return {
      clear() { period.textContent = ""; usage.replaceChildren(); usage.textContent = ""; status.textContent = ""; if (progress) progress.hidden = true; },
      render(data, subscription) {
        period.textContent = `計費月份：${data.period}`;
        if (cards) {
          usage.replaceChildren(...[["本月已用", data.used], ["本月上限", data.monthlyLimit], ["剩餘額度", data.remaining]].map(([label, value]) => {
            const card = node(host, "div"); card.className = "ai-quota-card";
            card.append(node(host, "span", label), node(host, "strong", value === null ? "未設定" : `${value} 則`)); return card;
          }));
          progress.hidden = data.monthlyLimit === null;
          progress.max = data.monthlyLimit > 0 ? data.monthlyLimit : 1;
          progress.value = data.monthlyLimit === 0 ? 1 : Math.min(data.used, progress.max);
          progress.setAttribute("aria-valuetext", data.monthlyLimit === null ? "額度未設定" : `已用 ${data.used}／上限 ${data.monthlyLimit} 則`);
        } else usage.textContent = `本月已用 ${data.used} 則／額度 ${data.monthlyLimit === null ? "未設定" : data.monthlyLimit} 則／剩餘 ${data.remaining === null ? "未設定" : data.remaining} 則`;
        status.textContent = data.monthlyLimit === null ? "額度未設定" : data.remaining === 0 ? "額度已用完，AI 自動回覆已暫停" : data.used >= data.monthlyLimit * .9 ? "本月額度已使用 90% 以上" : data.used >= data.monthlyLimit * .8 ? "本月額度已使用 80% 以上" : "本月額度正常";
        if (cards) status.textContent = data.monthlyLimit === null ? "額度未設定" : data.remaining === 0 ? "本月額度已用完，AI 自動回覆已暫停" : `本月剩餘 ${data.remaining} 則，可正常使用${data.used >= data.monthlyLimit * .9 ? "（已使用 90% 以上）" : data.used >= data.monthlyLimit * .8 ? "（已使用 80% 以上）" : ""}`;
        if (["EXPIRED","NOT_STARTED","DISABLED","UNCONFIGURED"].includes(subscription?.status)) status.textContent = subscriptionText(subscription);
      }
    };
  }
  function createOperator(host, { getPropertyId }) {
    const heading=node(host,"div"), switchBox=node(host,"div"), enabled=node(host,"input",undefined,"aiEnabled"), label=node(host,"label","AI 自動回覆：載入中","switchLabel");
    heading.className="ai-heading"; switchBox.className="ai-switch-box";
    enabled.type="checkbox"; enabled.disabled=true; enabled.className="ai-master-toggle admin-toggle";
    enabled.setAttribute("role","switch"); enabled.setAttribute("aria-label","AI 自動回覆");
    switchBox.append(label,enabled);heading.append(node(host,"h2","AI 回覆管理"),switchBox);host.append(heading);
    const subscriptionStatus=node(host,"p","","subscriptionStatus");subscriptionStatus.setAttribute("role","status");host.append(subscriptionStatus);
    const totals=summary(host,true), usageWindow=node(host,"div","","usageWindow");usageWindow.className="ai-usage-windows";host.append(usageWindow);
    const usageNote=node(host,"p","只計算實際使用的 AI 回覆額度。");usageNote.className="ai-quota-note";host.append(usageNote);
    const refresh=node(host,"button","重新整理","refresh"),message=node(host,"p","","message");
    refresh.type="button";message.setAttribute("role","status");message.setAttribute("aria-live","polite");host.append(refresh,message);
    const layout=node(host,"div"),list=node(host,"div",undefined,"conversation"),detail=node(host,"section");
    layout.className="ai-conversation-layout";list.className="ai-conversation-list";detail.className="ai-conversation-detail";
    list.setAttribute("aria-label","客人對話列表");detail.setAttribute("aria-label","已保存對話");
    const detailHeader=node(host,"div"),title=node(host,"h3","請選擇客人對話","guestTitle"),state=node(host,"p","","guestState"),handoffNote=node(host,"p","","handoffNote"),handoff=node(host,"button","轉人工","handoff"),older=node(host,"button","載入較早訊息","older"),history=node(host,"div",undefined,"history");
    detailHeader.className="ai-detail-header";history.className="ai-history";handoff.type=older.type="button";handoff.disabled=true;handoff.hidden=true;older.hidden=true;
    detailHeader.append(title,state,handoffNote,handoff);detail.append(detailHeader,older,history);layout.append(list,detail);host.append(layout);
    let lastSubscription=null;
    let version=0,guestVersion=0,currentId=null,savedEnabled=false,items=[],selected=null,nextCursor=null,historyItems=[],busyHistory=false,writesInFlight=0;
    const current=(revision,id)=>revision===version&&id===currentId&&id===getPropertyId();
    const time=value=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}):"時間未提供";};
    const identity=guest=>guest.displayName?String(guest.displayName).slice(0,40):`客人對話（${guest.userId.slice(-8)}）`;
    function renderSwitch(){enabled.checked=savedEnabled;enabled.setAttribute("aria-checked",String(savedEnabled));label.textContent=`AI 自動回覆：${savedEnabled?"開啟":"關閉"}`;}
    function renderState(){state.textContent=selected?(selected.humanControlled?"人工接管中":"AI 回覆中"):"";handoffNote.textContent=selected?.humanControlled?"AI 已暫停回覆這位客人":"";handoffNote.hidden=!selected?.humanControlled;handoff.textContent=selected?.humanControlled?"恢復 AI 回覆":"轉人工";handoff.hidden=!selected;handoff.disabled=!selected||Boolean(selected.busy);}
    function renderList(){
      list.replaceChildren();
      if(!items.length){list.append(node(host,"p","目前沒有已保存的客人對話"));return;}
      items.forEach(guest=>{
        const row=node(host,"article"),open=node(host,"button",identity(guest),"guestOpen"),badge=node(host,"span",guest.humanControlled?"人工接管中":"AI 回覆中"),preview=node(host,"p",guest.messagePreview?String(guest.messagePreview).slice(0,80):"尚無文字訊息摘要"),at=node(host,"p",time(guest.lastMessageAt));
        row.className="ai-guest-row";row.dataset.selected=String(selected===guest);open.type="button";open.className="ai-guest-open";badge.className="ai-guest-state";at.className="ai-message-time";preview.className="ai-guest-preview";
        open.setAttribute("aria-pressed",String(selected===guest));
        open.onclick=()=>openGuest(guest);row.append(open,badge,preview,at);list.append(row);
      });
    }
    function resetDetail(){guestVersion++;selected=null;nextCursor=null;historyItems=[];busyHistory=false;title.textContent="請選擇客人對話";history.replaceChildren();older.hidden=true;older.disabled=false;renderState();}
    function clear(){version++;currentId=null;items=[];enabled.disabled=true;enabled.checked=false;enabled.setAttribute("aria-checked","false");label.textContent="AI 自動回覆：尚未載入";list.replaceChildren();totals.clear();lastSubscription=null;subscriptionStatus.textContent="";usageWindow.replaceChildren();message.textContent="";resetDetail();}
    async function load(){
      if(writesInFlight&&currentId===getPropertyId())return;
      clear();const id=getPropertyId();if(!id)return;currentId=id;const revision=version;message.textContent="載入中…";
      try{
        const query=new URLSearchParams({propertyId:id});
        const [data,conversations,usage,subscription]=await Promise.all([api(`/api/ai-controls?${query}`),api(`/api/ai-controls/conversations?${query}`),api(`/api/ai-controls/usage?${query}`),api(`/api/ai-subscription?${query}`)]);
        if(!current(revision,id))return;if(data.propertyId!==id)throw Error("旅宿已切換，請重新整理。");
        lastSubscription=subscription;subscriptionStatus.textContent=subscriptionText(subscription);
        savedEnabled=data.aiEnabled;renderSwitch();enabled.disabled=false;totals.render(data,lastSubscription);
        usageWindow.replaceChildren(...[["今日",usage.today,usage.day,"usageToday"],["本週",usage.week,`週一起 ${usage.weekStart}`,"usageWeek"],["本月",data.used,data.period,"usageMonth"]].map(([label,value,period,field])=>{
          const card=node(host,"div",undefined,field);card.className="ai-usage-card";card.append(node(host,"span",label),node(host,"strong",`${value} 則`),node(host,"small",period));return card;
        }));
        items=(conversations.items||[]).filter(g=>typeof g.channelId==="string"&&g.channelId&&typeof g.userId==="string"&&g.userId).map(g=>({...g,humanControlled:g.humanControlled===true}));renderList();message.textContent="";
      }catch(error){if(current(revision,id))message.textContent=error.message||"載入失敗，請重新整理。";}
    }
    enabled.onchange=async()=>{
      if(enabled.disabled||currentId!==getPropertyId())return;const revision=version,id=currentId,requested=enabled.checked;enabled.disabled=true;writesInFlight++;refresh.disabled=true;
      try{const data=await api(`/api/ai-controls?${new URLSearchParams({propertyId:id})}`,{method:"PUT",body:JSON.stringify({aiEnabled:requested})});
        if(!current(revision,id))return;if(data.propertyId!==id)throw Error("旅宿已切換，請重新整理。");savedEnabled=data.aiEnabled;totals.render(data,lastSubscription);message.textContent="已儲存 AI 自動回覆設定。";
      }catch(error){if(current(revision,id))message.textContent=error.message||"儲存失敗，請重試。";}
      finally{writesInFlight--;refresh.disabled=writesInFlight>0;if(current(revision,id)){renderSwitch();enabled.disabled=false;}}
    };
    function renderHistory(){
      history.replaceChildren();
      for(const item of historyItems){
        const turn=node(host,"article");turn.className="ai-turn";
        const guest=node(host,"div");guest.className="ai-bubble ai-bubble-guest";guest.append(node(host,"strong",item.recordKind==="review"?"系統覆核紀錄（關聯客人訊息）":"客人訊息"),node(host,"p",item.guestMessage||"（未保存文字內容）"),node(host,"small",time(item.createdAt)));turn.append(guest);
        if(item.replyText){const reply=node(host,"div");reply.className="ai-bubble ai-bubble-reply";reply.append(node(host,"strong",item.replyDelivered?"AI 回覆":"系統保存回覆（未確認送出）"),node(host,"p",item.replyText),node(host,"small",item.replyAt?time(item.replyAt):"回覆時間未保存"));turn.append(reply);}
        else if(item.recordKind!=="review")turn.append(node(host,"p",item.processingStatus==="processing"?"處理中":item.processingStatus==="no_reply"?"AI 未回覆":"尚無回覆內容"));
        history.append(turn);
      }
      if(!historyItems.length)history.append(node(host,"p","目前沒有已保存訊息"));older.hidden=!nextCursor;
    }
    async function openGuest(guest){
      resetDetail();selected=guest;const revision=version,id=currentId,gv=guestVersion,controlRevision=guest.controlRevision||0;title.textContent=identity(guest);state.textContent="載入中…";handoff.disabled=true;renderList();message.textContent="";
      try{const query=new URLSearchParams({propertyId:id,channelId:guest.channelId,userId:guest.userId});
        const [control,page]=await Promise.all([api(`/api/ai-controls/conversations?${query}`),api(`/api/ai-controls/history?${query}`)]);
        if(!current(revision,id)||gv!==guestVersion)return;if((guest.controlRevision||0)===controlRevision)guest.humanControlled=control.humanControlled;historyItems=page.items;nextCursor=page.nextCursor;renderState();renderList();renderHistory();
        void loadGuestName(guest,revision,id,gv);
      }catch(error){if(current(revision,id)&&gv===guestVersion){state.textContent="狀態載入失敗";message.textContent=error.message;}}
    }
    async function loadGuestName(guest,revision,id,gv){
      try{
        const data=await api(`/api/ai-controls/profile?${new URLSearchParams({propertyId:id})}`,{method:"POST",body:JSON.stringify({channelId:guest.channelId,userId:guest.userId})});
        if(!current(revision,id)||gv!==guestVersion||selected!==guest)return;
        if(!data||!Object.hasOwn(data,"displayName")||(data.displayName!==null&&typeof data.displayName!=="string"))return;
        guest.displayName=typeof data.displayName==="string"&&data.displayName?data.displayName:null;
        title.textContent=identity(guest);renderList();
      }catch{/* Optional display metadata must never block conversation controls. */}
    }
    older.onclick=async()=>{
      if(!selected||!nextCursor||busyHistory)return;const revision=version,id=currentId,gv=guestVersion,guest=selected;busyHistory=true;older.disabled=true;
      try{const query=new URLSearchParams({propertyId:id,channelId:guest.channelId,userId:guest.userId,before:nextCursor});const page=await api(`/api/ai-controls/history?${query}`);
        if(!current(revision,id)||gv!==guestVersion)return;historyItems=[...page.items,...historyItems];nextCursor=page.nextCursor;renderHistory();
      }catch(error){if(current(revision,id)&&gv===guestVersion)message.textContent=error.message;}
      finally{if(current(revision,id)&&gv===guestVersion){busyHistory=false;older.disabled=false;}}
    };
    async function toggleGuest(guest){
      const revision=version,id=currentId;if(guest.busy||!current(revision,id))return;guest.busy=true;guest.controlRevision=(guest.controlRevision||0)+1;writesInFlight++;refresh.disabled=true;renderList();renderState();
      try{const data=await api(`/api/ai-controls/conversations?${new URLSearchParams({propertyId:id})}`,{method:"PUT",body:JSON.stringify({channelId:guest.channelId,userId:guest.userId,humanControlled:!guest.humanControlled})});
        if(!current(revision,id))return;guest.humanControlled=data.humanControlled;message.textContent=guest.humanControlled?"此對話已轉人工。":"此對話已恢復 AI；仍依總開關與額度決定是否回覆。";
      }catch(error){if(current(revision,id))message.textContent=error.message||"儲存失敗，請重試。";}
      finally{writesInFlight--;refresh.disabled=writesInFlight>0;if(current(revision,id)){guest.controlRevision++;guest.busy=false;renderList();renderState();}}
    }
    handoff.onclick=()=>!handoff.disabled&&selected?toggleGuest(selected):undefined;refresh.onclick=load;
    return {load,clear};
  }
  function createPlatform(host) {
    host.append(node(host, "h2", "每月 AI 額度"));
    const property = node(host, "select", undefined, "property"), propertyLabel = node(host, "label", "選擇旅宿"); propertyLabel.append(property); host.append(propertyLabel);
    const totals = summary(host), input = node(host, "input", undefined, "monthlyLimit"), label = node(host, "label", "每月額度（留白代表未設定）"), save = node(host, "button", "儲存額度", "saveLimit"), message = node(host, "p", "", "message");
    input.type = "number"; input.min = "0"; input.step = "1"; input.disabled = true; save.type = "button"; save.disabled = true;
    label.append(input); message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite"); host.append(label, save, message);
    const contractStart=node(host,"input",undefined,"contractStart"), contractEnd=node(host,"input",undefined,"contractEnd"), subscriptionEnabled=node(host,"input",undefined,"subscriptionEnabled"), saveSubscription=node(host,"button","儲存合約／續約","saveSubscription"), subscriptionStatus=node(host,"p","","subscriptionStatus");
    contractStart.type=contractEnd.type="date"; subscriptionEnabled.type="checkbox";subscriptionEnabled.className="admin-toggle";subscriptionEnabled.setAttribute("role","switch");saveSubscription.type="button";
    for(const [caption,element] of [["合約開始日（台灣時間）",contractStart],["合約到期日（含當日）",contractEnd],["方案啟用",subscriptionEnabled]]){const row=node(host,"label",caption);row.append(element);host.append(row);}
    host.append(subscriptionStatus,saveSubscription);
    const contractDisabled=value=>{contractStart.disabled=contractEnd.disabled=subscriptionEnabled.disabled=saveSubscription.disabled=value;};contractDisabled(true);
    let version = 0, knownIds = new Set();
    property.onchange = async () => {
      const revision = ++version, id = property.value; contractDisabled(true);contractStart.value=contractEnd.value="";subscriptionStatus.textContent=""; input.disabled = true; save.disabled = true; input.value = ""; totals.clear(); message.textContent = "";
      if (!knownIds.has(id)) return;
      try {
        const [data,subscription] = await Promise.all([api(`/api/platform/ai-controls?${new URLSearchParams({ propertyId: id })}`),api(`/api/platform/ai-subscriptions?${new URLSearchParams({ propertyId: id })}`)]);
        if (revision !== version || id !== property.value) return;
        if (data.propertyId !== id) throw new Error("旅宿已切換，請重新整理。");
        totals.render(data,subscription); input.value = data.monthlyLimit === null ? "" : String(data.monthlyLimit); input.disabled = false; save.disabled = false;
        contractStart.value=subscription.contractStart||"";contractEnd.value=subscription.contractEnd||"";subscriptionEnabled.checked=subscription.configuredStatus!=="disabled";subscriptionStatus.textContent=subscriptionText(subscription);contractDisabled(false);
      } catch (error) { if (revision === version) message.textContent = error.message || "載入失敗，請重試。"; }
    };
    save.onclick = async () => {
      if (save.disabled || !knownIds.has(property.value)) return;
      const raw = input.value.trim(), monthlyLimit = raw === "" ? null : Number(raw);
      if (monthlyLimit !== null && (!Number.isSafeInteger(monthlyLimit) || monthlyLimit < 0)) { message.textContent = "請輸入 0 或正整數，或留白。"; return; }
      const revision = version, id = property.value; save.disabled = true;
      try {
        const data = await api("/api/platform/ai-controls", { method: "PUT", body: JSON.stringify({ propertyId: id, monthlyLimit }) });
        if (revision !== version || property.value !== id) return;
        if (data.propertyId !== id) throw new Error("旅宿已切換，請重新整理。");
        totals.render(data); input.value = data.monthlyLimit === null ? "" : String(data.monthlyLimit); message.textContent = "已儲存每月額度。";
      } catch (error) { if (revision === version) message.textContent = error.message || "儲存失敗，請重試。"; }
      finally { if (revision === version) save.disabled = false; }
    };
    saveSubscription.onclick=async()=>{
      if(saveSubscription.disabled||!knownIds.has(property.value))return;
      const id=property.value,revision=version,monthlyLimit=Number(input.value);
      if(!contractStart.value||!contractEnd.value||contractEnd.value<contractStart.value||!input.value.trim()||!Number.isSafeInteger(monthlyLimit)||monthlyLimit<0){message.textContent="請填寫有效的合約起訖日期與每月額度。";return;}
      contractDisabled(true);save.disabled=true;input.disabled=true;
      try{
        const subscription=await api("/api/platform/ai-subscriptions",{method:"PUT",body:JSON.stringify({propertyId:id,status:subscriptionEnabled.checked?"active":"disabled",contractStart:contractStart.value,contractEnd:contractEnd.value,monthlyLimit})});
        if(revision!==version||id!==property.value)return;
        if(subscription.propertyId!==id)throw Error("旅宿已切換，請重新整理。");
        const data=await api(`/api/platform/ai-controls?${new URLSearchParams({propertyId:id})}`);
        if(revision!==version||id!==property.value)return;
        if(data.propertyId!==id)throw Error("旅宿已切換，請重新整理。");
        totals.render(data,subscription);subscriptionStatus.textContent=subscriptionText(subscription);message.textContent="已儲存合約與每月額度。";
      }catch(error){if(revision===version)message.textContent=error.message||"儲存失敗，請重試。";}
      finally{if(revision===version){contractDisabled(false);save.disabled=false;input.disabled=false;}}
    };
    async function load() {
      const revision = ++version; contractDisabled(true); save.disabled = true; input.disabled = true;
      try {
        const data = await api("/api/admin/platform/properties"); if (revision !== version) return;
        const items = data.items || []; knownIds = new Set(items.map(item => item.propertyId));
        const empty = node(host, "option", "請選擇旅宿"); empty.value = "";
        property.replaceChildren(empty, ...items.map(item => { const option = node(host, "option", item.propertyName || item.propertyId); option.value = item.propertyId; return option; }));
        property.value = "";
      } catch (error) { if (revision === version) message.textContent = error.message || "載入失敗，請重試。"; }
    }
    return { load };
  }
  return { createOperator, createPlatform };
})();
if (typeof document !== "undefined") {
  const operatorHost = document.getElementById("aiControls");
  if (operatorHost) {
    const workspace = document.getElementById("workspace");
    const getPropertyId = () => workspace.hidden || typeof session === "undefined" ? null : session?.propertyId;
    const editor = AiControls.createOperator(operatorHost, { getPropertyId });
    let lastProperty;
    const synchronize = () => { const id = getPropertyId(); if (id !== lastProperty) { lastProperty = id; if (id) editor.load(); else editor.clear(); } };
    const observer = new MutationObserver(synchronize);
    observer.observe(workspace, { attributes: true, attributeFilter: ["hidden"] });
    observer.observe(document.getElementById("propertyLabel"), { childList: true, subtree: true });
    synchronize();
  }
  const platformHost = document.getElementById("platformAiControls");
  if (platformHost) AiControls.createPlatform(platformHost).load();
}
