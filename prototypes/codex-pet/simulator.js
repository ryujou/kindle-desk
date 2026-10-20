function dial(){let ticks='';for(let i=0;i<60;i++){ticks+='<line x1="150" y1="'+(i%5?14:10)+'" x2="150" y2="'+(i%5?20:26)+'" stroke="#111" stroke-width="'+(i%5?1:2)+'" transform="rotate('+i*6+' 150 150)"/>'}return '<svg class="dial" viewBox="0 0 300 300" aria-label="16点42分"><circle cx="150" cy="150" r="148" fill="none" stroke="#111" stroke-width="1.5"/>'+ticks+'<g font-family="Georgia,serif" font-size="25" text-anchor="middle"><text x="150" y="57">12</text><text x="246" y="158">3</text><text x="150" y="259">6</text><text x="55" y="158">9</text></g><path d="M150 150 L207 220" fill="none" stroke="#111" stroke-width="7" stroke-linecap="round"/><path d="M150 150 L49 183" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round"/><circle cx="150" cy="150" r="6" fill="#111"/></svg>'}
function clock(analog){return (analog?dial():'')+'<div class="time">16:42</div><div class="date">10 月 19 日 · 周一</div>'}
function metrics(off){return '<h2 class="metrics-title">电脑性能</h2>'+[['CPU',24],['RAM',29],['GPU',9]].map(([n,v])=>'<div class="metric"><span>'+n+'</span><div class="track"><div class="fill" style="width:'+(off?0:v)+'%"></div><div class="ticks">'+'<i></i>'.repeat(19)+'</div></div><strong>'+(off?'—':v+'%')+'</strong></div>').join('')+'<div class="hardware"><span>内存 '+(off?'—':'37 / 128 GB')+'</span><span>显卡 '+(off?'—':'41°C')+'</span></div>'}

var pet = new DeskPet(document.getElementById('pet'));
pet.setMode('native');
var snapshot = null, lastPaint = '', pollTimer = null, request = null, paused = false;
var idleSince = null, idleAdvance = 0, weather = null, weatherTimer = null, weatherRequest = null, weatherCoordinates = null;
var weatherNotice = '室外天气未定位', speechEngine = FuukaCompanion.create();
var care = new DeskCarePanel({pet:pet,surface:document.querySelector('.companion'),onChange:function(){
 if(!paused)showActivity(snapshot?snapshot.activity:{state:'offline'},Date.now()/1000);paintCareValues();
}});
care.restorePet();
function paintCareValues(){var value=care.state;put('care-values',value?'仿真数值 · 好感 '+Math.round(value.affection)+' · 精力 '+Math.round(value.energy)+' · 相伴 '+(Math.floor(Math.max(0,care.now()-value.firstMetAt)/86400)+1)+' 天':care.error)}
function effectiveWeather(now){
 if(!node('weather-enabled').checked)return null;
 if(node('source').value==='demo'&&node('ambient-scene').value==='rain')return {temperature:20,code:61,forecastRain:true,sampledAt:now,demo:true};
 return node('source').value==='live'&&snapshot&&snapshot.environment?snapshot.environment.weather:weather;
}
function speechContext(now){
 var logicalNow=now+idleAdvance,date=new Date(logicalNow*1000),scene=node('source').value==='demo'?node('ambient-scene').value:'auto';
 var hours={morning:8,lunch:12,evening:19,night:23,daily:15,quote:15,sitting:15,rain:15};
 var presence=snapshot&&snapshot.presence||{};
 var outdoor=effectiveWeather(now);if(outdoor&&outdoor.demo)outdoor.sampledAt=logicalNow;
 return {now:logicalNow,hour:scene in hours?hours[scene]:date.getHours(),
  day:date.getFullYear()+'-'+(date.getMonth()+1)+'-'+date.getDate(),quoteOnly:scene==='quote',
  sittingSeconds:scene==='sitting'?3000:presence.sittingSeconds||0,away:presence.away===true,
  weather:outdoor,careMood:care.mood()};
}
function showSpeech(now,force){
 var context=speechContext(now),entry=care.entry()||speechEngine.read(context,force);
 FuukaCompanion.paint(node('activity-text'),entry);
 node('activity-text').setAttribute('data-kind',entry.kind);
 node('activity-text').title='点击换一句';
}
function standby(activity, now) {
 if(!activity)return true;
 if(activity.state==='running'||activity.state==='waiting'||activity.state==='failed')return false;
 if(activity.state==='offline')return true;
 if(activity.state==='review')return !!activity.eventAt && now-activity.eventAt>=60;
 return activity.state==='idle'||activity.state==='unknown';
}
function weatherText(code){if(code===0)return '晴';if(code<=3)return '多云';if(code<=48)return '有雾';if(code<=67)return '有雨';if(code<=77)return '有雪';if(code<=82)return '阵雨';if(code<=86)return '阵雪';return '雷雨'}
function paintWeather(){var line=node('weather-line');line.hidden=!node('weather-enabled').checked;if(line.hidden)return;
 var outdoor=effectiveWeather(Date.now()/1000),demo=!outdoor&&node('source').value==='demo'&&weatherNotice==='室外天气未定位';
 put('weather-primary',outdoor?Math.round(outdoor.temperature)+'°C · '+weatherText(outdoor.code):demo?'22°C · 多云':weatherNotice);
 put('weather-meta',outdoor?(outdoor.demo?'室外 · 模拟':'室外 · Open-Meteo'):demo?'室外 · 模拟':'室外');
 var code=outdoor?outdoor.code:2,cloud='M8 24h16a5 5 0 0 0 0-10h-1a8 8 0 0 0-15 2 4 4 0 0 0 0 8Z';
 node('weather-icon').innerHTML=code===0?'<circle cx="16" cy="16" r="6"/><path d="M16 2v3m0 22v3M2 16h3m22 0h3M6 6l2 2m16 16 2 2M6 26l2-2M24 8l2-2"/>':'<path d="'+cloud+'"/>'+(code>=51?'<path d="m11 27-1 3m8-3-1 3m8-3-1 3"/>':'');
}
function showActivity(activity, now){var idle=standby(activity,now);care.context(idle);paintCareValues();document.querySelector('.companion').classList.toggle('standby',idle);node('ambient-info').hidden=!idle;
 var indoor=snapshot&&snapshot.demo?{temperature:24,humidity:65,pm25:45}:snapshot&&snapshot.environment&&snapshot.environment.indoor;
 node('ambient-indoor').hidden=!indoor;
 if(indoor){put('room-temperature',Math.round(indoor.temperature));put('room-humidity',Math.round(indoor.humidity));put('room-pm25',Math.round(indoor.pm25))}
 if(idle){if(idleSince===null)idleSince=now;put('activity-state','待机伴侣');put('task-name','陪你歇一会儿');showSpeech(now,false);node('activity-text').setAttribute('role','button');node('activity-text').setAttribute('aria-label','换一句风香对白或一言');pet.setState('idle');pet.setAmbient(true);paintWeather()}
 else{idleSince=null;if(idleAdvance)speechEngine=FuukaCompanion.create();idleAdvance=0;node('activity-text').removeAttribute('role');node('activity-text').removeAttribute('aria-label');node('activity-text').removeAttribute('data-kind');node('activity-text').removeAttribute('title');pet.setAmbient(false);var state=activity?activity.state:'offline';put('activity-state',labels[state]||'状态待确认');put('task-name',activity?activity.title:'Codex');put('activity-text',activity?publicText(activity.message||'正在执行任务，等待下一条公开进度。'):'暂时无法读取电脑数据。');pet.setState(state)}
}
var labels = {waiting:'等你操作',running:'工作中',review:'完成待查看',idle:'空闲',failed:'遇到问题',unknown:'状态待确认',offline:'电脑离线'};
function node(id){return document.getElementById(id)}
function put(id,value){if(node(id).textContent!==value){node(id).textContent=value;if(id==='activity-text')node(id).scrollTop=0}}
function publicText(value){return value.replace(/\[([^\]]+)\]\(https?:[^)]+\)/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/^[-*] /gm,'').replace(/`([^`]+)`/g,'$1')}
function localTime(stamp){var d=new Date(stamp*1000);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
var clockMinute='';
function updateClock(){var d=new Date();if(clockMinute===Math.floor(Date.now()/60000))return;clockMinute=Math.floor(Date.now()/60000);var time=localTime(Date.now()/1000),date=(d.getMonth()+1)+' 月 '+d.getDate()+' 日 · '+['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];node('clock').innerHTML=clock(true);node('clock').querySelector('.time').textContent=time;node('clock').querySelector('.date').textContent=date;var hands=node('clock').querySelectorAll('path');hands[0].setAttribute('d','M150 150 L150 60');hands[0].setAttribute('transform','rotate('+((d.getHours()%12+d.getMinutes()/60)*30)+' 150 150)');hands[1].setAttribute('d','M150 150 L150 43');hands[1].setAttribute('transform','rotate('+(d.getMinutes()*6)+' 150 150)');put('native-time',time)}
function render(data){
 snapshot=data;var model=DeskModel.derive(data,Date.now()/1000),pc=model.computer,activity=data&&data.activity,state=activity?activity.state:'offline';
 put('connection',model.computerState);put('account-plan',model.account?model.account.plan:'');put('quota-state',model.quotaState);
 if(!node('metrics').firstChild)node('metrics').innerHTML=metrics(true);
 var metricNodes=node('metrics').querySelectorAll('.metric'),values=pc?[pc.cpu,pc.ram,pc.gpu]:[null,null,null];
 for(var i=0;i<3;i++){metricNodes[i].querySelector('strong').textContent=values[i]===null?'—':Math.round(values[i])+'%';metricNodes[i].querySelector('.fill').style.width=(values[i]===null?0:values[i])+'%'}
 var notes=node('metrics').querySelectorAll('.hardware span');notes[0].textContent=pc?'内存 '+pc.used+' / '+pc.total+' GB':'内存 —';notes[1].textContent=pc?'显卡 '+pc.temperature+'°C':'显卡 —';
 showActivity(data?activity:{state:'offline',message:'暂时无法读取电脑数据。'},Date.now()/1000);
 var signature=JSON.stringify(model.rows);if(signature!==lastPaint){lastPaint=signature;var list=node('quota-list');list.textContent='';
  model.rows.forEach(function(row){var item=document.createElement('section');item.className='quota-item';var top=document.createElement('div');top.className='quota-top';var label=document.createElement('span');label.textContent=row.label;var value=document.createElement('strong');value.textContent=row.remaining===null?'—':row.remaining+'%';top.appendChild(label);top.appendChild(value);var track=document.createElement('div');track.className='quota-track';var fill=document.createElement('div');fill.className='fill';fill.style.width=(row.remaining===null?0:row.remaining)+'%';track.appendChild(fill);var reset=document.createElement('div');reset.className='quota-reset';var d=new Date(row.resetsAt*1000);reset.textContent=row.waiting?'等待新额度':row.resetsAt?(d.getMonth()+1)+'/'+d.getDate()+' '+localTime(row.resetsAt)+' 重置':'重置时间未提供';item.appendChild(top);item.appendChild(track);item.appendChild(reset);list.appendChild(item)});
  if(!model.rows.length){var empty=document.createElement('div');empty.className='quota-empty';empty.textContent=model.quotaState;list.appendChild(empty)}
 }
 put('data-label','');
 put('status',data?(data.demo?'正在播放模拟场景。':'已读取本机会话公开消息与实际额度；部分审批等待可能不在日志中。'):'电脑数据连接失败，等待恢复。');
 updateClock();
}
function load(){clearTimeout(pollTimer);if(paused||document.hidden)return;syncPet(); if(request)request.abort();var xhr=new XMLHttpRequest();request=xhr;
 var params=['source','state','plan','periods'].map(function(id){return id+'='+encodeURIComponent(node(id).value)}).join('&');
 xhr.open('GET','/snapshot?'+params,true);xhr.timeout=7000;
 function finish(data){if(request!==xhr)return;request=null;render(data);if(!paused&&!document.hidden)pollTimer=setTimeout(load,3000)}
 xhr.onload=function(){var data=null;try{if(xhr.status===200)data=JSON.parse(xhr.responseText)}catch(e){put('status','数据格式错误')}finish(data)};xhr.onerror=function(){finish(null)};xhr.ontimeout=function(){finish(null)};xhr.send();
}
function stop(title){paused=true;care.pause();pet.pause();clearTimeout(pollTimer);clearTimeout(weatherTimer);if(weatherRequest){var w=weatherRequest;weatherRequest=null;w.abort()}if(request){var x=request;request=null;x.abort()}node('paused').hidden=false;put('pause-title',title)}
node('source').onchange=function(){['state','plan','periods','ambient-scene','advance'].forEach(function(id){node(id).disabled=node('source').value==='live'});idleAdvance=0;speechEngine=FuukaCompanion.create();load()};['state','plan','periods'].forEach(function(id){node(id).onchange=load});
node('ambient-scene').onchange=function(){idleAdvance=0;speechEngine=FuukaCompanion.create();if(snapshot)showActivity(snapshot.activity,Date.now()/1000)};
node('motion').onchange=function(){pet.setMode(node('motion').value)};
node('weather-enabled').onchange=function(){paintWeather();if(idleSince!==null)showSpeech(Date.now()/1000,false)};
node('advance').onclick=function(){if(idleSince===null){put('status','切到模拟场景的待机状态后，可以测试短句轮换。');return}idleAdvance+=1200;showActivity(snapshot.activity,Date.now()/1000)};
node('next-line').onclick=function(){if(idleSince!==null)showSpeech(Date.now()/1000,true)};
node('activity-text').onclick=node('next-line').onclick;
node('activity-text').onkeydown=function(event){if(idleSince!==null&&(event.key==='Enter'||event.key===' ')){event.preventDefault();showSpeech(Date.now()/1000,true)}};
node('wave').onclick=function(){pet.wave()};
node('care-advance').onclick=function(){care.advance(Number(node('care-time').value))};
function fetchWeather(){clearTimeout(weatherTimer);if(paused||document.hidden||!weatherCoordinates)return;
 var xhr=new XMLHttpRequest();weatherRequest=xhr;xhr.open('GET','/weather?latitude='+weatherCoordinates.latitude+'&longitude='+weatherCoordinates.longitude,true);xhr.timeout=12000;
 function finish(value){if(weatherRequest!==xhr)return;weatherRequest=null;weather=value;weatherNotice=value?'':'天气读取失败';paintWeather();if(!paused&&!document.hidden)weatherTimer=setTimeout(fetchWeather,1800000)}
 xhr.onload=function(){var value=null;try{if(xhr.status===200)value=JSON.parse(xhr.responseText)}catch(e){weatherNotice='天气数据格式错误'}finish(value)};xhr.onerror=function(){finish(null)};xhr.ontimeout=function(){finish(null)};xhr.send();
}
node('locate').onclick=function(){if(!navigator.geolocation){weatherNotice='浏览器不支持定位';paintWeather();return}weatherNotice='正在读取电脑位置…';paintWeather();navigator.geolocation.getCurrentPosition(function(p){weatherCoordinates={latitude:p.coords.latitude.toFixed(3),longitude:p.coords.longitude.toFixed(3)};weatherNotice='正在保存电脑位置…';paintWeather();var save=new XMLHttpRequest();save.open('POST','/location',true);save.setRequestHeader('Content-Type','application/json');save.onload=function(){if(save.status===200){weatherNotice='正在读取当地天气…';paintWeather();fetchWeather()}else{weatherNotice='位置保存失败';paintWeather()}};save.onerror=function(){weatherNotice='位置保存失败';paintWeather()};save.send(JSON.stringify(weatherCoordinates))},function(error){weatherNotice=error.code===1?'定位未授权，请允许浏览器读取位置':'电脑位置暂不可用，请检查系统定位设置';paintWeather();put('status',weatherNotice)},{timeout:12000,maximumAge:600000})};
node('sleep').onclick=function(){stop('休眠仿真')};node('reading').onclick=function(){stop('返回阅读仿真')};node('resume').onclick=function(){paused=false;care.resume();node('paused').hidden=true;pet.resume();load();if(weatherCoordinates)fetchWeather()};node('refresh').onclick=load;
function resize(){var v=document.querySelector('.viewport'),scale=v.clientWidth/1000;node('screen').style.transform='scale('+scale+')';v.style.height=740*scale+'px'}
window.addEventListener('resize',resize);document.addEventListener('visibilitychange',function(){if(document.hidden){care.pause();pet.pause();clearTimeout(pollTimer);if(request){var x=request;request=null;x.abort()}}else if(!paused){care.resume();pet.resume();load()}});window.addEventListener('pagehide',function(){care.pause();pet.pause();clearTimeout(pollTimer)});
resize();pet.draw();pet.resume();node('source').onchange();
window.addEventListener('pagehide',function(){clearTimeout(weatherTimer);if(weatherRequest)weatherRequest.abort()});
document.addEventListener('visibilitychange',function(){if(document.hidden){clearTimeout(weatherTimer);if(weatherRequest){var x=weatherRequest;weatherRequest=null;x.abort()}}else if(!paused&&weatherCoordinates)fetchWeather()});

function syncPet(){var xhr=new XMLHttpRequest();xhr.open('GET','/pet',true);xhr.timeout=3000;xhr.onload=function(){if(xhr.status!==200)return;var value;try{value=JSON.parse(xhr.responseText)}catch(e){return}care.observePet(value);pet.setPet(value);put('pet-selection',value.state==='ready'?'跟随电脑：'+value.name+(value.assetSource==='local-installed-copy'?' · 本地素材':''):value.state==='off'?'电脑已关闭宠物':value.state==='missing_asset'?'新宠物素材尚未同步':'暂时无法读取电脑宠物选择')};xhr.send()}
