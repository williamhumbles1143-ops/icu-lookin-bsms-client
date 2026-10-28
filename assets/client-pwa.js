(function(){
  "use strict";
  const VERSION="0.28.2";
  const SESSION_KEY="icuCustomerSessionPhoneV1";
  const PUSH_PHONE_KEY="icuClientPushPhoneV1";
  const LAST_NOTIFICATION_KEY="icuClientLastNotificationV1";
  const JUST_OPENED_KEY="icuClientPushJustOpenedV1";
  let registrationPromise=null;
  let panel=null;
  let statusEl=null;
  let button=null;

  const norm=v=>String(v||"").replace(/\D/g,"").slice(-10);
  const cfg=()=>window.ICU_SUPABASE_CONFIG||null;
  const isIOS=()=>/iPhone|iPad|iPod/i.test(navigator.userAgent||"");
  const isStandalone=()=>window.matchMedia?.("(display-mode: standalone)")?.matches||window.navigator.standalone===true;
  const currentPhone=()=>norm(sessionStorage.getItem(SESSION_KEY)||localStorage.getItem("icuLauncherPhone")||"");
  const boundPushPhone=()=>norm(localStorage.getItem(PUSH_PHONE_KEY)||"");

  function urlBase64ToUint8Array(base64String){
    const padding="=".repeat((4-base64String.length%4)%4);
    const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
    const raw=atob(base64);
    return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
  }

  async function pushApi(payload){
    const c=cfg();
    if(!c?.url)throw new Error("Notification service is unavailable.");
    const response=await fetch(c.url+"/functions/v1/client-push",{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify(payload),
      cache:"no-store",
      credentials:"omit"
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.error||"Notification request failed.");
    return data;
  }

  async function ensureRegistration(){
    if(!("serviceWorker" in navigator))throw new Error("This device does not support app notifications.");
    if(!registrationPromise){
      registrationPromise=navigator.serviceWorker.register("client-sw.js?v="+VERSION,{scope:"./"})
        .catch(error=>{registrationPromise=null;throw error});
    }
    return registrationPromise;
  }

  async function browserSubscription(){
    if(!("PushManager" in window))return null;
    const reg=await ensureRegistration();
    return reg.pushManager.getSubscription();
  }

  async function clearBadge(){
    try{
      const reg=await navigator.serviceWorker?.ready;
      reg?.active?.postMessage({type:"ICU_CLEAR_BADGE"});
      if(typeof navigator.clearAppBadge==="function")await navigator.clearAppBadge();
    }catch(_){}
  }

  function removePanel(){
    if(panel?.isConnected)panel.remove();
    panel=null;statusEl=null;button=null;
  }

  async function subscribe(phoneValue){
    const phone=norm(phoneValue||currentPhone());
    if(phone.length!==10)throw new Error("Open your ICU client profile first.");
    if(!("Notification" in window)||!("PushManager" in window))throw new Error("Push notifications are not supported on this device.");
    if(isIOS()&&!isStandalone())throw new Error("On iPhone, add ICU Lookin to your Home Screen first, then open it from the new icon.");

    let permission=Notification.permission;
    if(permission==="default")permission=await Notification.requestPermission();
    if(permission!=="granted"){
      throw new Error(permission==="denied"
        ?"Notifications are turned off for ICU Lookin in your phone settings."
        :"Notification permission was not granted.");
    }

    const reg=await ensureRegistration();
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      const config=await pushApi({action:"config"});
      if(!config.vapid_public_key)throw new Error("Notification key is unavailable.");
      sub=await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(config.vapid_public_key)
      });
    }

    const json=sub.toJSON();
    if(!json.endpoint||!json.keys?.p256dh||!json.keys?.auth){
      throw new Error("The phone returned an incomplete notification subscription.");
    }

    await pushApi({
      action:"subscribe",
      phone,
      endpoint:json.endpoint,
      p256dh:json.keys.p256dh,
      auth:json.keys.auth,
      device_label:isIOS()?"iPhone Home Screen":"Client device"
    });

    localStorage.setItem(PUSH_PHONE_KEY,phone);
    removePanel();
    return true;
  }

  function injectStyles(){
    if(document.getElementById("icuClientPwaStyles"))return;
    const style=document.createElement("style");
    style.id="icuClientPwaStyles";
    style.textContent=".icu-client-push-panel{margin:12px auto 18px;max-width:1180px;padding:14px 16px;border:1px solid #d8d0c4;border-radius:14px;background:#fff;box-shadow:0 7px 24px rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-between;gap:14px}.icu-client-push-panel strong{display:block}.icu-client-push-panel small{display:block;color:#686159;margin-top:3px}.icu-client-push-panel button{min-height:44px;padding:9px 14px;border:1px solid #111;border-radius:10px;background:#111;color:#fff;font-weight:900;white-space:nowrap}.icu-client-push-panel button:disabled{opacity:.55}.icu-client-notification-card{margin:0 0 18px;padding:17px 18px;border:1px solid #cfc5b7;border-left:5px solid #173f9e;border-radius:15px;background:#fff;box-shadow:0 7px 24px rgba(0,0,0,.07)}.icu-client-notification-card .icu-notification-label{margin:0 0 5px;color:#173f9e;font-size:.76rem;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.icu-client-notification-card h2{margin:0 0 7px;font-size:1.15rem}.icu-client-notification-card p{margin:0;line-height:1.5}.icu-client-notification-card small{display:block;margin-top:8px;color:#726a61}.icu-client-notification-card button{margin-top:12px;min-height:40px;padding:8px 12px;border:1px solid #111;border-radius:9px;background:#fff;color:#111;font-weight:800}@media(max-width:650px){.icu-client-push-panel{margin:10px 0 16px;align-items:stretch;flex-direction:column}.icu-client-push-panel button{width:100%}}";
    document.head.appendChild(style);
  }

  function ensurePanel(){
    if(panel?.isConnected)return panel;
    injectStyles();
    panel=document.createElement("section");
    panel.id="icuClientPushPanel";
    panel.className="icu-client-push-panel";
    panel.innerHTML='<div><strong>Appointment Notifications</strong><small data-icu-client-push-status>Sign in to your client profile to turn on notifications.</small></div><button type="button" data-icu-client-push-enable>Enable Notifications</button>';
    statusEl=panel.querySelector("[data-icu-client-push-status]");
    button=panel.querySelector("[data-icu-client-push-enable]");
    button.addEventListener("click",async()=>{
      button.disabled=true;
      statusEl.textContent="Turning on notifications…";
      try{await subscribe(currentPhone())}
      catch(error){
        statusEl.textContent=error?.message||"Notifications could not be enabled.";
        button.disabled=false;
      }
    });
    const main=document.querySelector("main");
    if(main)main.insertBefore(panel,main.firstChild);
    else document.body.insertBefore(panel,document.body.firstChild);
    return panel;
  }

  async function refreshPanel(){
    const phone=currentPhone();
    const bound=boundPushPhone();

    if("Notification" in window&&"PushManager" in window&&"serviceWorker" in navigator&&Notification.permission==="granted"&&bound.length===10){
      let sub=null;
      try{sub=await browserSubscription()}catch(_){}
      if(sub&&(!phone||phone===bound)){
        removePanel();
        return;
      }
    }

    ensurePanel();

    if(phone.length!==10){
      statusEl.textContent="Open your client profile first. Then you can turn on appointment notifications.";
      button.textContent="Enable Notifications";
      button.disabled=true;
      return;
    }

    if(isIOS()&&!isStandalone()){
      statusEl.textContent="On iPhone, add ICU Lookin to your Home Screen, then open it from the icon to enable notifications.";
      button.textContent="Home Screen Required";
      button.disabled=true;
      return;
    }

    if(!("Notification" in window)||!("PushManager" in window)||!("serviceWorker" in navigator)){
      statusEl.textContent="This browser does not support ICU push notifications.";
      button.textContent="Not Supported";
      button.disabled=true;
      return;
    }

    if(Notification.permission==="denied"){
      statusEl.textContent="Notifications are blocked. Turn them on in your phone's notification settings for ICU Lookin.";
      button.textContent="Notifications Off";
      button.disabled=true;
      return;
    }

    statusEl.textContent="Get confirmations, barber messages, cancellations, appointment changes, completed-visit thank-yous, and appointment reminders.";
    button.textContent="Enable Notifications";
    button.disabled=false;
  }

  function saveOpenedNotification(params){
    const title=String(params.get("push_title")||"").trim();
    const body=String(params.get("push_body")||"").trim();
    if(!title&&!body)return null;

    const note={
      title:title||"ICU Lookin Notification",
      body,
      type:String(params.get("push_type")||"notification"),
      tag:String(params.get("push_tag")||""),
      phone:boundPushPhone(),
      openedAt:new Date().toISOString()
    };
    localStorage.setItem(LAST_NOTIFICATION_KEY,JSON.stringify(note));
    localStorage.setItem(JUST_OPENED_KEY,note.tag||note.openedAt);
    return note;
  }

  function readLastNotification(){
    try{
      const parsed=JSON.parse(localStorage.getItem(LAST_NOTIFICATION_KEY)||"null");
      return parsed&&typeof parsed==="object"?parsed:null;
    }catch(_){return null}
  }

  function renderNotificationCard(){
    injectStyles();
    const view=document.getElementById("view-customer-profile");
    if(!view)return;

    const old=document.getElementById("icuClientNotificationCard");
    const note=readLastNotification();
    const phone=currentPhone();

    if(!note||!note.body||(note.phone&&phone&&norm(note.phone)!==phone)){
      old?.remove();
      return;
    }

    const card=old||document.createElement("section");
    card.id="icuClientNotificationCard";
    card.className="icu-client-notification-card";

    if(!old){
      const heading=view.querySelector(".page-heading");
      if(heading)heading.insertAdjacentElement("afterend",card);
      else view.prepend(card);
    }

    card.replaceChildren();
    const label=document.createElement("p");
    label.className="icu-notification-label";
    label.textContent="Latest notification";
    const title=document.createElement("h2");
    title.textContent=note.title||"ICU Lookin Notification";
    const body=document.createElement("p");
    body.textContent=note.body||"";
    const time=document.createElement("small");
    try{time.textContent="Opened "+new Date(note.openedAt).toLocaleString()}
    catch(_){time.textContent=""}
    const dismiss=document.createElement("button");
    dismiss.type="button";
    dismiss.textContent="Dismiss";
    dismiss.addEventListener("click",()=>{
      localStorage.removeItem(LAST_NOTIFICATION_KEY);
      localStorage.removeItem(JUST_OPENED_KEY);
      card.remove();
    });
    card.append(label,title,body,time,dismiss);

    if(localStorage.getItem(JUST_OPENED_KEY)){
      setTimeout(()=>{
        if(!view.classList.contains("hidden"))card.scrollIntoView({behavior:"smooth",block:"start"});
        localStorage.removeItem(JUST_OPENED_KEY);
      },350);
    }
  }

  function cleanPushQuery(){
    try{
      const clean=new URL(location.href);
      ["push","push_title","push_body","push_type","push_tag"].forEach(k=>clean.searchParams.delete(k));
      history.replaceState(null,"",clean.pathname+clean.search+clean.hash);
    }catch(_){}
  }

  async function handlePushOpen(){
    const params=new URLSearchParams(location.search);
    if(params.get("push")!=="profile")return false;

    saveOpenedNotification(params);
    await clearBadge();

    const storedPhone=norm(localStorage.getItem("icuLauncherPhone")||"");
    const sessionPhone=norm(sessionStorage.getItem(SESSION_KEY)||"");
    const bound=boundPushPhone();
    const phone=sessionPhone||storedPhone;

    if(phone.length===10&&bound.length===10&&phone===bound){
      sessionStorage.setItem(SESSION_KEY,phone);
      localStorage.setItem("icuLauncherPhone",phone);
      location.replace("CUSTOMER_BOOKING_APP.html#customer-profile");
      return true;
    }

    cleanPushQuery();
    return false;
  }

  async function boot(){
    const mode=window.__ICU_EARLY_MODE__||new URLSearchParams(location.search).get("app")||sessionStorage.getItem("icuAppMode")||"";
    if(/BSMS_APP\.html$/i.test(location.pathname)&&mode&&mode!=="customer")return;

    if(await handlePushOpen())return;

    try{await ensureRegistration();await clearBadge()}catch(_){}
    await refreshPanel();
    renderNotificationCard();

    setTimeout(()=>{refreshPanel();renderNotificationCard()},900);
    window.addEventListener("pageshow",()=>setTimeout(()=>{clearBadge();refreshPanel();renderNotificationCard()},120));
    window.addEventListener("focus",()=>setTimeout(()=>{refreshPanel();renderNotificationCard()},120));
    window.addEventListener("hashchange",()=>setTimeout(renderNotificationCard,80));
  }

  window.ICUClientPWA={version:VERSION,subscribe,refreshPanel,clearBadge,renderNotificationCard};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();