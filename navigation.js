export function createNavigation(initialView, onChange, closeOverlay, onRoot, initialStep=0) {
  let current=initialView,currentStep=initialStep;
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const set=(screen,replace=false,step=currentStep)=>history[replace?'replaceState':'pushState']({alias:true,screen,step:screen==='setup'?step:null},'',`#${screen}`);
  if(!history.state?.alias){
    set(standalone?'root':'home',true);
    if(standalone)set('home');
    if(['setup','game'].includes(initialView))for(let step=0;step<=initialStep;step++)set('setup',false,step);
    if(initialView==='game')set('game');
  }else set(initialView,true);
  window.addEventListener('popstate',event=>{
    if(closeOverlay()){set(current);return;}
    if(event.state?.screen==='root'){set('home');current='home';onChange('home');onRoot();return;}
    if(!event.state?.alias||!['home','setup','game'].includes(event.state.screen))return;
    current=event.state.screen;
    if(current==='setup')currentStep=Number.isInteger(event.state.step)?Math.min(4,Math.max(0,event.state.step)):0;
    onChange(current,currentStep);
  });
  let touch;
  document.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch'||event.target.closest('input,select,button,a,summary,dialog'))return;
    touch={x:event.clientX,y:event.clientY,time:Date.now()};
  },{passive:true});
  document.addEventListener('pointercancel',()=>{touch=null;});
  document.addEventListener('pointerup',event=>{
    if(!touch)return;
    const dx=event.clientX-touch.x,dy=event.clientY-touch.y;
    const valid=Date.now()-touch.time<850&&Math.abs(dx)>85&&Math.abs(dx)>Math.abs(dy)*1.8;
    const edge=dx>0?touch.x<45:touch.x>innerWidth-45;
    touch=null;if(!valid||!edge)return;
    if(dx>0){if(!closeOverlay())history.back();}else history.forward();
  },{passive:true});
  return {
    sync(view,step=0){
      if(view===current&&(view!=='setup'||step===currentStep))return;
      if(view==='game'&&current==='home')set('setup');
      currentStep=step;set(view);current=view;
    },
    back(){if(!closeOverlay())history.back();}
  };
}
