/* Visit counter, stores nothing. TASK-479 */
(function(w,d,n){if(/^(1|yes)$/.test(n.doNotTrack||w.doNotTrack)||n.globalPrivacyControl)return;
var U="/api/pulse",L=location,b=new Uint8Array(8),v="",u={},q=new URLSearchParams(L.search),a=0,s=0,A=-1,S=-1,t=d.visibilityState!="hidden"&&Date.now(),i;
w.crypto.getRandomValues(b);for(i=0;i<8;i++)v+=(b[i]+256).toString(16).slice(1);
["source","medium","campaign"].forEach(function(x){var y=q.get("utm_"+x);if(y)u[x[0]]=y});
function send(o){o.v=v;o=JSON.stringify(o);try{if(n.sendBeacon(U,o))return}catch(e){}try{fetch(U,{method:"POST",body:o,keepalive:!0})}catch(e){}}
function sc(){var h=d.documentElement.scrollHeight;s=Math.max(s,Math.min(100,h?Math.round((scrollY+innerHeight)/h*100):100))}
function hide(){if(t){a+=Date.now()-t;t=0}var x=Math.min(1800,Math.round(a/1e3));if(x>A||s>S){A=x;S=s;send({t:"leave",a:x,s:s})}}
sc();send({t:"view",p:L.pathname,r:d.referrer,u:u,w:screen.width});
w.addEventListener("scroll",sc);w.addEventListener("pagehide",hide);
d.addEventListener("visibilitychange",function(){"hidden"==d.visibilityState?hide():t||(t=Date.now())});
d.addEventListener("click",function(e){e=e.target.closest("a,button");if(!e)return;
var h=e.getAttribute("href")||"",l=e.textContent.replace(/\s+/g," ").trim(),c=" "+e.className+" ",p=e.hasAttribute("data-give-pay"),cta=/ btn /.test(c)||p,a=e.tagName=="A",k="",r,o;
try{r=new URL(h,L.href)}catch(x){}o=r&&r.host==L.host;
if(/^tel:/i.test(h))k="phone";else if(/^mailto:/i.test(h))k="email";
else if(/ ev-book /.test(c)&&!(o&&r.pathname=="/contact")||cta&&(/ticket/i.test(l)||/^\/ball/.test(L.pathname)&&/payment/i.test(l)))k="tickets";
else if(cta&&/donat/i.test(l)||p||a&&o&&/^\/donate\/?$/.test(r.pathname))k="donate";
else if(a&&r&&(e.hasAttribute("download")||/\.(pdf|docx?|xlsx?|zip|csv)$/i.test(r.pathname))){k="download";l=r.pathname.split("/").pop()}
else if(a&&r&&/^https?:$/.test(r.protocol)&&!o){k="outbound";l=r.host}
if(k)send({t:"click",k:k,l:l.slice(0,80)})},!0)})(window,document,navigator);
