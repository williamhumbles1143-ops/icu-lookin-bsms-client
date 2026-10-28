(function(){
  "use strict";
  const VERSION="0.28.0";
  const SESSION_KEY="icuCustomerSessionPhoneV1";
  const PUSH_PHONE_KEY="icuClientPushPhoneV1";
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
      registrationPromise=navigator.serviceWorker.register("client-sw.js?v="+VERSION,{scope:"./"}).catch(error=>{registrationPromise=null;throw error});
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

  async function subscribe(phoneValue){
    const phone=norm(phoneValue||currentPhone());
    if(phone.length!==10)throw new Error("Open your ICU client profile first.");
    if(!("Notification" in window)||!("PushManager" in window))throw new Error("Push notifications are not supported on this device.");
    if(isIOS()&&!isStandalone())throw new Error("On iPhone, add ICU Lookin to your Home Screen first, then open it from the new icon.");
    let permission=Notification.permission;
    if(permission==="default")permission=await Notification.requestPermission();
    if(permission!=="granted")throw new Error(permission==="denied"?"Notifications are turned off for ICU Lookin in your phone settings.":"Notification permission was not granted.");

    const reg=await ensureRegistration();
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      const config=await pushApi({action:"config"});
      if(!config.vapid_public_key)throw new Error("Notification key is unavailable.");
      sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(config.vapid_public_key)});
    }
    const json=sub.toJSON();
    if(!json.endpoint||!json.keys?.p256dh||!json.keys?.auth)throw new Error("The phone returned an incomplete notification subscription.");
    await pushApi({
      action:"subscribe",
      phone,
      endpoint:json.endpoint,
      p256dh:json.keys.p256dh,
      auth:json.keys.auth,
      device_label:isIOS()?"iPhone Home Screen":"Client device"
    });
    localStorage.setItem(PUSH_PHONE_KEY,phone);
    await refreshPanel();
    return true;
  }

  function injectStyles(){
    if(document.getElementById("icuClientPwaStyles"))return;
    const style=document.createElement("style");
    style.id="icuClientPwaStyles";
    style.textContent=".icu-client-push-panel{margin:12px auto 18px;max-width:1180px;padding:14px 16px;border:1px solid #d8d0c4;border-radius:14px;background:#fff;box-shadow:0 7px 24px rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-between;gap:14px}.icu-client-push-panel strong{display:block}.icu-client-push-panel small{display:block;color:#686159;margin-top:3px}.icu-client-push-panel button{min-height:44px;padding:9px 14px;border:1px solid #111;border-radius:10px;background:#111;color:#fff;font-weight:900;white-space:nowrap}.icu-client-push-panel button:disabled{opacity:.55}@media(max-width:650px){.icu-client-push-panel{margin:10px 0 16px;align-items:stretch;flex-direction:column}.icu-client-push-panel button{width:100%}}";
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
      catch(error){statusEl.textContent=error?.message||"Notifications could not be enabled.";button.disabled=false}
    });
    const main=document.querySelector("main");
    if(main)main.insertBefore(panel,main.firstChild);
    else document.body.insertBefore(panel,document.body.firstChild);
    return panel;
  }

  async function refreshPanel(){
    ensurePanel();
    const phone=currentPhone();
    if(phone.length!==10){
      if(boundPushPhone().length===10){
        statusEl.textContent="Notifications remain active on this phone. Open your client profile to manage them.";
        button.textContent="Notifications On";button.disabled=true;return;
      }
      statusEl.textContent="Open your client profile first. Then you can turn on confirmations and barber-message alerts.";
      button.textContent="Enable Notifications";button.disabled=true;return;
    }
    if(isIOS()&&!isStandalone()){
      statusEl.textContent="On iPhone, add ICU Lookin to your Home Screen, then open it from the icon to enable notifications.";
      button.textContent="Home Screen Required";button.disabled=true;return;
    }
    if(!("Notification" in window)||!("PushManager" in window)||!("serviceWorker" in navigator)){
      statusEl.textContent="This browser does not support ICU push notifications.";
      button.textContent="Not Supported";button.disabled=true;return;
    }
    if(Notification.permission==="denied"){
      statusEl.textContent="Notifications are blocked. Turn them on in your phone's notification settings for ICU Lookin.";
      button.textContent="Notifications Off";button.disabled=true;return;
    }
    let sub=null;
    try{sub=await browserSubscription()}catch(_){}
    const bound=norm(localStorage.getItem(PUSH_PHONE_KEY)||"")===phone;
    if(sub&&bound){
      statusEl.textContent="On — you’ll be notified when your barber confirms, sends a message, cancels, or changes the appointment time.";
      button.textContent="Notifications On";button.disabled=true;return;
    }
    statusEl.textContent="Get confirmations, barber messages, cancellations, and appointment-time changes on this phone.";
    button.textContent="Enable Notifications";button.disabled=false;
  }

  async function handlePushOpen(){
    const params=new URLSearchParams(location.search);
    if(params.get("push")!=="profile")return false;
    await clearBadge();
    const phone=norm(sessionStorage.getItem(SESSION_KEY)||"");
    if(phone.length===10){
      localStorage.setItem("icuLauncherPhone",phone);
      location.replace("CUSTOMER_BOOKING_APP.html#customer-profile");
      return true;
    }
    try{
      const clean=new URL(location.href);
      clean.searchParams.delete("push");
      history.replaceState(null,"",clean.pathname+clean.search+clean.hash);
    }catch(_){}
    return false;
  }

  async function boot(){
    const mode=window.__ICU_EARLY_MODE__||new URLSearchParams(location.search).get("app")||sessionStorage.getItem("icuAppMode")||"";
    if(/BSMS_APP\.html$/i.test(location.pathname)&&mode&&mode!=="customer")return;
    if(await handlePushOpen())return;
    try{await ensureRegistration();await clearBadge()}catch(_){}
    await refreshPanel();
    setTimeout(refreshPanel,1200);
    window.addEventListener("pageshow",()=>setTimeout(()=>{clearBadge();refreshPanel()},150));
    window.addEventListener("focus",()=>setTimeout(refreshPanel,150));
  }

  window.ICUClientPWA={version:VERSION,subscribe,refreshPanel,clearBadge};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();