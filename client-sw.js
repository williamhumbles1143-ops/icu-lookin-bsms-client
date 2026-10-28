const ICU_CLIENT_SW_VERSION="0.28.0";
const DEFAULT_ICON="assets/icu-lookin-logo.jpeg";

self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));

async function setBadge(value=1){
  try{
    if(self.navigator&&typeof self.navigator.setAppBadge==="function"){
      await self.navigator.setAppBadge(Math.max(1,Number(value)||1));
      return true;
    }
  }catch(error){console.error("ICU client badge set failed",error)}
  return false;
}
async function clearBadge(){
  try{
    if(self.navigator&&typeof self.navigator.clearAppBadge==="function"){
      await self.navigator.clearAppBadge();
      return true;
    }
  }catch(error){console.error("ICU client badge clear failed",error)}
  return false;
}

self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch(_){data={body:event.data?event.data.text():"You have a new ICU Lookin update."}}
  const title=data.title||"ICU Lookin Barber Studio";
  const options={
    body:data.body||"Open the Client App to view the update.",
    icon:data.icon||DEFAULT_ICON,
    tag:data.tag||("icu-client-"+Date.now()),
    renotify:true,
    data:{url:data.url||"CLIENT_LAUNCHER.html?push=profile",type:data.type||"notification"}
  };
  event.waitUntil(Promise.all([setBadge(data.badge||1),self.registration.showNotification(title,options)]));
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    await clearBadge();
    const target=new URL(event.notification?.data?.url||"CLIENT_LAUNCHER.html?push=profile",self.registration.scope).href;
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      if("focus" in client){
        try{
          if("navigate" in client)await client.navigate(target);
          return client.focus();
        }catch(_){}
      }
    }
    if(self.clients.openWindow)return self.clients.openWindow(target);
  })());
});

self.addEventListener("message",event=>{
  if(event.data?.type==="ICU_CLEAR_BADGE")event.waitUntil(clearBadge());
});
self.addEventListener("fetch",event=>{
  if(event.request.mode==="navigate")event.waitUntil(clearBadge());
});
